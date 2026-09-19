// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRWARegistry} from "./interfaces/IRWARegistry.sol";
import {IIssuer} from "./interfaces/IIssuer.sol";
import {LiquidityVault} from "./LiquidityVault.sol";
import {Pricing} from "./lib/Pricing.sol";

/// @title RedemptionBridge
/// @notice Instant NAV-minus-spread exits for redeemable RWA tokens, funded by the LiquidityVault
///         and repaid when the issuer settles the redemption.
contract RedemptionBridge is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant DEMO_ADMIN_ROLE = keccak256("DEMO_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    bytes32 public constant RISK_ADMIN_ROLE = keccak256("RISK_ADMIN_ROLE");
    uint256 public constant MAX_SPREAD_BPS = 5_000;
    uint256 private constant BPS = 10_000;

    // Impaired is APPENDED as the third variant. Open must stay 0 and Settled must stay 1: the
    // keeper reads this enum off-chain, and reordering would silently reinterpret every stored
    // receivable.
    enum Status {
        Open,
        Settled,
        Impaired
    }

    struct Receivable {
        uint256 id;
        address token;
        address holder;
        uint256 amount; // RWA tokens, 1e18
        uint256 navAtFront; // 1e18
        uint256 advanced; // USDC paid to holder
        uint256 expected; // USDC at NAV when opened (display)
        uint64 openedAt;
        uint64 settleAfter;
        Status status;
    }

    struct Quote {
        uint256 navValueWad;
        uint256 navValueUsdc;
        uint256 utilisationBps; // projected, if full NAV value were advanced
        uint256 baseBps;
        uint256 utilTermBps;
        uint256 timeRiskBps;
        uint256 spreadBps;
        uint256 payout; // USDC
        uint256 capacityUsdc; // largest payout the vault can fund right now
        uint256 creditBps;
    }

    IRWARegistry public immutable registry;
    LiquidityVault public immutable vault;
    IERC20 public immutable usdc;
    IIssuer public immutable issuer;

    address public treasury;
    uint16 public protocolFeeBps; // share of realised profit
    Pricing.Curve public curve;
    uint32 public impairAfter; // grace period past settleAfter before a receivable is impairable

    uint256 public nextId = 1;
    mapping(uint256 => Receivable) private _receivables;
    uint256[] private _openIds;
    mapping(uint256 => uint256) private _openIndex; // id => index+1 (0 = not open)
    mapping(address => uint256) public exposureUsdc; // outstanding advanced per asset

    error ZeroAddress();
    error ZeroAmount();
    error InvalidFee();
    error InvalidCurve();
    error AssetDisabled(address token);
    error NotEligibleRedeemer(address token);
    error SpreadTooHigh(uint256 spreadBps);
    error SlippageExceeded(uint256 payout, uint256 minPayout);
    error ReceivableNotOpen(uint256 id);
    error SettlementWindowNotElapsed(uint256 id, uint64 settleAfter);
    error InsufficientCapacity(uint256 payout, uint256 capacity);
    error PayoutTooSmall(uint256 amount);
    error ExposureCapExceeded(address token, uint256 projected, uint256 cap);
    error NotYetImpairable(uint256 id, uint64 impairableAt);
    error NotImpaired(uint256 id);

    event ReceivableOpened(
        uint256 indexed id,
        address indexed token,
        address indexed holder,
        uint256 amount,
        uint256 navAtFront,
        uint256 advanced,
        uint256 spreadBps,
        uint64 settleAfter
    );
    event ReceivableSettled(uint256 indexed id, uint256 proceeds, uint256 fee, int256 pnl);
    event DemoOverride(uint256 indexed id, address indexed caller);
    event TreasurySet(address indexed treasury);
    event ProtocolFeeSet(uint16 bps);
    event CurveSet(uint16 kinkBps, uint16 slope1Bps, uint16 slope2Bps);
    event ReceivableImpaired(uint256 indexed id, address indexed token, uint256 advanced);
    event ReceivableRecovered(uint256 indexed id, uint256 recovered, int256 pnl);
    event ImpairAfterSet(uint32 seconds_);

    constructor(
        IRWARegistry registry_,
        LiquidityVault vault_,
        IERC20 usdc_,
        IIssuer issuer_,
        address treasury_,
        address admin,
        uint16 protocolFeeBps_,
        Pricing.Curve memory curve_,
        uint32 impairAfter_
    ) {
        if (
            address(registry_) == address(0) || address(vault_) == address(0) || address(usdc_) == address(0)
                || address(issuer_) == address(0) || treasury_ == address(0) || admin == address(0)
        ) revert ZeroAddress();
        registry = registry_;
        vault = vault_;
        usdc = usdc_;
        issuer = issuer_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _grantRole(RISK_ADMIN_ROLE, admin);
        _setTreasury(treasury_);
        _setProtocolFee(protocolFeeBps_);
        _setCurve(curve_);
        impairAfter = impairAfter_;
        emit ImpairAfterSet(impairAfter_);
        // vault pulls proceeds from us on settlement
        usdc_.forceApprove(address(vault_), type(uint256).max);
    }

    // ---------- pricing ----------

    function quote(address token, uint256 amount) public view returns (Quote memory q) {
        IRWARegistry.Asset memory a = registry.getAsset(token);
        q.navValueWad = Pricing.navValueWad(amount, a.navPerToken);
        q.navValueUsdc = Pricing.wadToUsdc(q.navValueWad);
        q.utilisationBps = Pricing.projectedUtilisationBps(vault.idle(), vault.outstanding(), q.navValueUsdc);
        q.baseBps = a.baseSpreadBps;
        q.utilTermBps = Pricing.utilisationTermBps(q.utilisationBps, curve);
        q.timeRiskBps = Pricing.timeRiskBps(a.dailyVolBps, registry.horizonDays(token));
        q.creditBps = Pricing.creditTermBps(a.creditBps);
        q.spreadBps = q.baseBps + q.utilTermBps + q.timeRiskBps + q.creditBps;
        q.payout = Pricing.payoutUsdc(q.navValueWad, q.spreadBps);
        q.capacityUsdc = vault.capacityUsdc();
    }

    /// @notice Conservative upper bound on redeemable token amount, given current vault capacity.
    /// @dev Sized off NAV value rather than the post-spread payout, so it slightly UNDER-states the
    ///      true maximum. Callers may safely redeem this amount; the exact ceiling is marginally higher.
    function maxRedeemable(address token) external view returns (uint256) {
        uint256 nav = registry.getAsset(token).navPerToken;
        if (nav == 0) return 0;
        return vault.capacityUsdc() * Pricing.USDC_SCALE * Pricing.WAD / nav;
    }

    /// @notice The most USDC that may be outstanding against `token` at once, in USDC.
    /// @dev Measured against the vault's current totalAssets, not a fixed number, so it scales
    ///      with LP capital automatically.
    function assetExposureCapUsdc(address token) public view returns (uint256) {
        return vault.totalAssets() * registry.getAsset(token).maxExposureBps / BPS;
    }

    // ---------- holder ----------

    /// @notice Deposit `amount` of `token`, receive USDC now at NAV minus spread.
    function redeem(address token, uint256 amount, uint256 minPayout)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        if (amount == 0) revert ZeroAmount();
        IRWARegistry.Asset memory a = registry.getAsset(token);
        if (!a.enabled) revert AssetDisabled(token);
        if (!a.eligible) revert NotEligibleRedeemer(token);

        Quote memory q = quote(token, amount);
        if (q.spreadBps > MAX_SPREAD_BPS) revert SpreadTooHigh(q.spreadBps);
        if (q.payout < minPayout) revert SlippageExceeded(q.payout, minPayout);
        if (q.payout == 0) revert PayoutTooSmall(amount);
        if (q.payout > q.capacityUsdc) revert InsufficientCapacity(q.payout, q.capacityUsdc);

        uint256 projectedExposure = exposureUsdc[token] + q.payout;
        uint256 cap = assetExposureCapUsdc(token);
        if (projectedExposure > cap) revert ExposureCapExceeded(token, projectedExposure, cap);

        id = nextId++;
        uint64 settleAfter = uint64(block.timestamp + a.settlementWindow);

        _receivables[id] = Receivable({
            id: id,
            token: token,
            holder: msg.sender,
            amount: amount,
            navAtFront: a.navPerToken,
            advanced: q.payout,
            expected: q.navValueUsdc,
            openedAt: uint64(block.timestamp),
            settleAfter: settleAfter,
            status: Status.Open
        });
        _openIds.push(id);
        _openIndex[id] = _openIds.length;
        exposureUsdc[token] = projectedExposure;

        IERC20(token).safeTransferFrom(msg.sender, address(issuer), amount);
        issuer.requestRedemption(id, token, amount);
        vault.advance(msg.sender, q.payout);

        emit ReceivableOpened(id, token, msg.sender, amount, a.navPerToken, q.payout, q.spreadBps, settleAfter);
    }

    // ---------- keeper ----------

    /// @notice Collect issuer proceeds for `id` and return capital plus yield to the vault.
    /// @dev Permissionless once the settlement window has elapsed. DEMO_ADMIN_ROLE may settle early.
    function settle(uint256 id) external nonReentrant returns (uint256 proceeds) {
        Receivable storage r = _receivables[id];
        if (r.id == 0 || r.status != Status.Open) revert ReceivableNotOpen(id);
        if (block.timestamp < r.settleAfter) {
            if (!hasRole(DEMO_ADMIN_ROLE, msg.sender)) revert SettlementWindowNotElapsed(id, r.settleAfter);
            emit DemoOverride(id, msg.sender);
        }

        r.status = Status.Settled;
        _removeOpen(id);
        // Guard against underflow: a rounding mismatch here must never brick settlement.
        uint256 exposure = exposureUsdc[r.token];
        exposureUsdc[r.token] = exposure > r.advanced ? exposure - r.advanced : 0;

        proceeds = issuer.settle(id);

        uint256 fee;
        uint256 toVault = proceeds;
        if (proceeds > r.advanced) {
            fee = (proceeds - r.advanced) * protocolFeeBps / BPS;
            toVault = proceeds - fee;
            if (fee > 0) usdc.safeTransfer(treasury, fee);
        }
        vault.settleReceivable(r.advanced, toVault);

        emit ReceivableSettled(id, proceeds, fee, int256(toVault) - int256(r.advanced));
    }

    // ---------- risk admin ----------

    /// @notice Write down a receivable that the issuer has failed to settle well past its window.
    /// @dev Permissioned and time-gated on purpose: a permissionless write-down would be an attack
    ///      vector, since anyone could impair a merely-late receivable and buy vault shares at the
    ///      artificially depressed price. This gate is an honest centralised judgement call; a
    ///      production version needs an issuer attestation or an oracle in place of RISK_ADMIN_ROLE.
    function markImpaired(uint256 id) external onlyRole(RISK_ADMIN_ROLE) nonReentrant {
        Receivable storage r = _receivables[id];
        if (r.id == 0 || r.status != Status.Open) revert ReceivableNotOpen(id);
        uint64 impairableAt = r.settleAfter + impairAfter;
        if (block.timestamp <= impairableAt) revert NotYetImpairable(id, impairableAt);

        // Effects before interactions, matching the pattern in settle().
        r.status = Status.Impaired;
        _removeOpen(id);
        uint256 advanced = r.advanced;
        uint256 exposure = exposureUsdc[r.token];
        exposureUsdc[r.token] = exposure > advanced ? exposure - advanced : 0;

        vault.absorbLoss(advanced);
        emit ReceivableImpaired(id, r.token, advanced);
    }

    /// @notice Book a workout recovery on a previously impaired receivable.
    /// @dev Pulls `recoveredUsdc` from the caller and forwards it to the vault.
    function recoverImpaired(uint256 id, uint256 recoveredUsdc) external onlyRole(RISK_ADMIN_ROLE) nonReentrant {
        Receivable storage r = _receivables[id];
        if (r.status != Status.Impaired) revert NotImpaired(id);

        r.status = Status.Settled;

        usdc.safeTransferFrom(msg.sender, address(this), recoveredUsdc);
        usdc.forceApprove(address(vault), recoveredUsdc);
        vault.recoverLoss(recoveredUsdc);

        emit ReceivableRecovered(id, recoveredUsdc, int256(recoveredUsdc) - int256(r.advanced));
    }

    // ---------- views ----------

    function openReceivableIds() external view returns (uint256[] memory) {
        return _openIds;
    }

    function getReceivable(uint256 id) external view returns (Receivable memory) {
        return _receivables[id];
    }

    // ---------- admin ----------

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setTreasury(treasury_);
    }

    function setProtocolFee(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setProtocolFee(bps);
    }

    function setCurve(Pricing.Curve memory c) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setCurve(c);
    }

    function setImpairAfter(uint32 seconds_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        impairAfter = seconds_;
        emit ImpairAfterSet(seconds_);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------- internals ----------

    function _setTreasury(address treasury_) internal {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function _setProtocolFee(uint16 bps) internal {
        if (bps > BPS) revert InvalidFee();
        protocolFeeBps = bps;
        emit ProtocolFeeSet(bps);
    }

    function _setCurve(Pricing.Curve memory c) internal {
        if (c.kinkBps == 0 || c.kinkBps >= BPS) revert InvalidCurve();
        curve = c;
        emit CurveSet(c.kinkBps, c.slope1Bps, c.slope2Bps);
    }

    function _removeOpen(uint256 id) internal {
        uint256 idx = _openIndex[id];
        if (idx == 0) return;
        uint256 last = _openIds[_openIds.length - 1];
        _openIds[idx - 1] = last;
        _openIndex[last] = idx;
        _openIds.pop();
        delete _openIndex[id];
    }
}
