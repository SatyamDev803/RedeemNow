// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice ERC-4626 USDC vault that funds redemption advances.
/// @dev totalAssets = idle + outstanding. Only tracked balances count, so donations cannot
///      inflate share price and the classic first-depositor attack has no lever.
contract LiquidityVault is ERC4626, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 private constant BPS = 10_000;

    /// @notice USDC held and available for withdrawals or advances.
    uint256 public idle;
    /// @notice USDC advanced to holders and not yet settled, at face value.
    uint256 public outstanding;
    uint16 public maxUtilisationBps;

    error InsufficientIdle(uint256 requested, uint256 idle);
    error UtilisationTooHigh(uint256 projectedBps, uint256 maxBps);
    error InvalidBps();
    error ZeroAddress();
    error EmptyVault();
    error LossExceedsOutstanding(uint256 loss, uint256 outstanding);

    event Advanced(address indexed to, uint256 amount, uint256 utilisationBps);
    event ReceivableSettled(uint256 advanced, uint256 proceeds);
    event LossRealised(uint256 advanced, uint256 proceeds, uint256 loss);
    event MaxUtilisationSet(uint16 bps);
    event LossAbsorbed(uint256 advanced, uint256 totalAssetsAfter);
    event LossRecovered(uint256 recovered);

    constructor(IERC20 usdc, address admin, uint16 maxUtilisationBps_)
        ERC4626(usdc)
        ERC20("RedeemNow USDC", "rnUSDC")
    {
        if (admin == address(0)) revert ZeroAddress();
        if (maxUtilisationBps_ == 0 || maxUtilisationBps_ > BPS) revert InvalidBps();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        maxUtilisationBps = maxUtilisationBps_;
        emit MaxUtilisationSet(maxUtilisationBps_);
    }

    // ---------- ERC-4626 accounting ----------

    function totalAssets() public view override returns (uint256) {
        return idle + outstanding;
    }

    function utilisationBps() public view returns (uint256) {
        uint256 total = totalAssets();
        if (total == 0) return 0;
        return outstanding * BPS / total;
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 byShares = super.maxWithdraw(owner);
        return byShares < idle ? byShares : idle;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 byShares = super.maxRedeem(owner);
        uint256 byIdle = _convertToShares(idle, Math.Rounding.Floor);
        return byShares < byIdle ? byShares : byIdle;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
        nonReentrant
    {
        super._deposit(caller, receiver, assets, shares);
        idle += assets;
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
        nonReentrant
    {
        if (assets > idle) revert InsufficientIdle(assets, idle);
        idle -= assets;
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    // ---------- bridge surface ----------

    /// @notice Advance `amount` USDC to `to` against a pending redemption.
    function advance(address to, uint256 amount) external onlyRole(BRIDGE_ROLE) whenNotPaused nonReentrant {
        if (amount > idle) revert InsufficientIdle(amount, idle);
        uint256 total = totalAssets();
        if (total == 0) revert EmptyVault();
        uint256 projected = (outstanding + amount) * BPS / total;
        if (projected > maxUtilisationBps) revert UtilisationTooHigh(projected, maxUtilisationBps);
        idle -= amount;
        outstanding += amount;
        IERC20(asset()).safeTransfer(to, amount);
        emit Advanced(to, amount, projected);
    }

    /// @notice Largest single advance the vault can fund right now, in USDC.
    /// @dev Bounded by both idle liquidity and the max-utilisation cap.
    function capacityUsdc() public view returns (uint256) {
        uint256 total = totalAssets();
        if (total == 0) return 0;
        uint256 maxOutstanding = total * maxUtilisationBps / BPS;
        if (outstanding >= maxOutstanding) return 0;
        uint256 byUtilisation = maxOutstanding - outstanding;
        return byUtilisation < idle ? byUtilisation : idle;
    }

    /// @notice Close a receivable: pulls `proceeds` USDC from the bridge and retires `advanced`.
    function settleReceivable(uint256 advanced, uint256 proceeds) external onlyRole(BRIDGE_ROLE) nonReentrant {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), proceeds);
        outstanding -= advanced;
        idle += proceeds;
        if (proceeds < advanced) emit LossRealised(advanced, proceeds, advanced - proceeds);
        emit ReceivableSettled(advanced, proceeds);
    }

    /// @notice Write `advanced` USDC off the book permanently.
    /// @dev `outstanding` falls with no matching rise in `idle`, so `totalAssets` falls and the
    ///      share price drops for EVERY holder in the same transaction. That is the point: leaving
    ///      an unpayable receivable at face value would let the first LP out exit at a fictitious
    ///      price and leave the whole loss with the last, which is a bank-run incentive.
    function absorbLoss(uint256 advanced) external onlyRole(BRIDGE_ROLE) nonReentrant {
        if (advanced > outstanding) revert LossExceedsOutstanding(advanced, outstanding);
        outstanding -= advanced;
        emit LossAbsorbed(advanced, totalAssets());
    }

    /// @notice Credit a recovery on a previously written-down receivable back to idle capital.
    /// @dev Pulls USDC from the bridge, which must hold the recovered amount.
    function recoverLoss(uint256 recovered) external onlyRole(BRIDGE_ROLE) nonReentrant {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), recovered);
        idle += recovered;
        emit LossRecovered(recovered);
    }

    // ---------- admin ----------

    function setMaxUtilisation(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps == 0 || bps > BPS) revert InvalidBps();
        maxUtilisationBps = bps;
        emit MaxUtilisationSet(bps);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
