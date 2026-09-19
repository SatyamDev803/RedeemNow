// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIssuer} from "./interfaces/IIssuer.sol";
import {IRWARegistry} from "./interfaces/IRWARegistry.sol";
import {MockRWAToken} from "./MockRWAToken.sol";
import {Pricing} from "./lib/Pricing.sol";

/// @notice Simulates an RWA issuer: accepts tokens for redemption and pays NAV in USDC on settlement.
/// @dev Must be prefunded with USDC via `fund`. Must hold ISSUER_ROLE on each RWA token.
contract MockIssuer is IIssuer, AccessControl {
    using SafeERC20 for IERC20;

    struct Request {
        address token;
        uint256 amount;
        bool settled;
        bool exists;
    }

    IRWARegistry public immutable registry;
    IERC20 public immutable usdc;
    address public bridge;
    mapping(uint256 => Request) private _requests;

    error OnlyBridge();
    error BridgeAlreadySet();
    error ZeroAddress();
    error UnknownRequest(uint256 id);
    error AlreadySettled(uint256 id);
    error DuplicateRequest(uint256 id);
    error InsufficientIssuerFunds(uint256 needed, uint256 available);

    event BridgeSet(address indexed bridge);
    event RedemptionRequested(uint256 indexed id, address indexed token, uint256 amount);
    event RedemptionSettled(uint256 indexed id, address indexed token, uint256 amount, uint256 proceeds);
    event Funded(address indexed from, uint256 amount);

    modifier onlyBridge() {
        if (msg.sender != bridge) revert OnlyBridge();
        _;
    }

    constructor(IRWARegistry registry_, IERC20 usdc_, address admin) {
        if (admin == address(0)) revert ZeroAddress();
        registry = registry_;
        usdc = usdc_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setBridge(address bridge_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bridge != address(0)) revert BridgeAlreadySet();
        if (bridge_ == address(0)) revert ZeroAddress();
        bridge = bridge_;
        emit BridgeSet(bridge_);
    }

    /// @notice Anyone may top up the issuer's USDC so it can honour settlements.
    function fund(uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    function requestRedemption(uint256 id, address token, uint256 amount) external onlyBridge {
        if (_requests[id].exists) revert DuplicateRequest(id);
        _requests[id] = Request({token: token, amount: amount, settled: false, exists: true});
        emit RedemptionRequested(id, token, amount);
    }

    function settle(uint256 id) external onlyBridge returns (uint256 proceedsUsdc) {
        Request storage r = _requests[id];
        if (!r.exists) revert UnknownRequest(id);
        if (r.settled) revert AlreadySettled(id);

        uint256 nav = registry.getAsset(r.token).navPerToken;
        proceedsUsdc = Pricing.wadToUsdc(Pricing.navValueWad(r.amount, nav));
        uint256 available = usdc.balanceOf(address(this));
        if (available < proceedsUsdc) revert InsufficientIssuerFunds(proceedsUsdc, available);

        r.settled = true;
        MockRWAToken(r.token).burnFrom(address(this), r.amount);
        usdc.safeTransfer(msg.sender, proceedsUsdc);
        emit RedemptionSettled(id, r.token, r.amount, proceedsUsdc);
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }
}
