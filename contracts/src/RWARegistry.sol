// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IRWARegistry} from "./interfaces/IRWARegistry.sol";

/// @notice Per-asset configuration and NAV feed for redeemable RWA tokens.
contract RWARegistry is IRWARegistry, AccessControl {
    bytes32 public constant NAV_UPDATER_ROLE = keccak256("NAV_UPDATER_ROLE");
    uint256 private constant BPS = 10_000;

    /// @dev 86_400 in production; 60 in the demo so a 120 s window prices as a 2-day horizon.
    uint32 public secondsPerDay;

    address[] public tokens;
    mapping(address => Asset) private _assets;

    error AssetNotRegistered(address token);
    error AssetAlreadyRegistered(address token);
    error InvalidNav();
    error InvalidWindow();
    error InvalidSecondsPerDay();
    error InvalidBps();
    error ZeroAddress();

    event AssetRegistered(
        address indexed token,
        address indexed issuer,
        uint256 navPerToken,
        uint32 settlementWindow,
        uint16 baseSpreadBps,
        uint16 dailyVolBps,
        uint16 creditBps,
        uint16 maxExposureBps,
        AssetClass assetClass,
        bool eligible
    );
    event NavUpdated(address indexed token, uint256 navPerToken, uint64 timestamp);
    event EligibilitySet(address indexed token, bool eligible);
    event EnabledSet(address indexed token, bool enabled);
    event SettlementWindowSet(address indexed token, uint32 settlementWindow);
    event SecondsPerDaySet(uint32 secondsPerDay);
    event CreditSet(address indexed token, uint16 creditBps);
    event MaxExposureSet(address indexed token, uint16 bps);

    constructor(address admin, uint32 secondsPerDay_) {
        if (admin == address(0)) revert ZeroAddress();
        if (secondsPerDay_ == 0) revert InvalidSecondsPerDay();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        secondsPerDay = secondsPerDay_;
        emit SecondsPerDaySet(secondsPerDay_);
    }

    // ---------- admin ----------

    function registerAsset(
        address token,
        address issuer,
        uint256 navPerToken,
        uint32 settlementWindow,
        uint16 baseSpreadBps,
        uint16 dailyVolBps,
        uint16 creditBps,
        uint16 maxExposureBps,
        AssetClass assetClass,
        bool eligible
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0) || issuer == address(0)) revert ZeroAddress();
        if (_assets[token].token != address(0)) revert AssetAlreadyRegistered(token);
        if (navPerToken == 0) revert InvalidNav();
        if (settlementWindow == 0) revert InvalidWindow();
        if (creditBps >= BPS) revert InvalidBps();
        if (maxExposureBps == 0 || maxExposureBps > BPS) revert InvalidBps();

        _assets[token] = Asset({
            token: token,
            issuer: issuer,
            navPerToken: navPerToken,
            navUpdatedAt: uint64(block.timestamp),
            settlementWindow: settlementWindow,
            baseSpreadBps: baseSpreadBps,
            dailyVolBps: dailyVolBps,
            creditBps: creditBps,
            maxExposureBps: maxExposureBps,
            assetClass: assetClass,
            eligible: eligible,
            enabled: true
        });
        tokens.push(token);
        emit AssetRegistered(
            token, issuer, navPerToken, settlementWindow, baseSpreadBps, dailyVolBps, creditBps, maxExposureBps, assetClass, eligible
        );
    }

    function setCredit(address token, uint16 creditBps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireRegistered(token);
        if (creditBps >= BPS) revert InvalidBps();
        _assets[token].creditBps = creditBps;
        emit CreditSet(token, creditBps);
    }

    function setMaxExposure(address token, uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireRegistered(token);
        if (bps == 0 || bps > BPS) revert InvalidBps();
        _assets[token].maxExposureBps = bps;
        emit MaxExposureSet(token, bps);
    }

    function setEligible(address token, bool eligible) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireRegistered(token);
        _assets[token].eligible = eligible;
        emit EligibilitySet(token, eligible);
    }

    function setEnabled(address token, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireRegistered(token);
        _assets[token].enabled = enabled;
        emit EnabledSet(token, enabled);
    }

    function setSettlementWindow(address token, uint32 settlementWindow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireRegistered(token);
        if (settlementWindow == 0) revert InvalidWindow();
        _assets[token].settlementWindow = settlementWindow;
        emit SettlementWindowSet(token, settlementWindow);
    }

    function setSecondsPerDay(uint32 secondsPerDay_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (secondsPerDay_ == 0) revert InvalidSecondsPerDay();
        secondsPerDay = secondsPerDay_;
        emit SecondsPerDaySet(secondsPerDay_);
    }

    // ---------- NAV feed ----------

    function setNav(address token, uint256 navPerToken) external onlyRole(NAV_UPDATER_ROLE) {
        _requireRegistered(token);
        if (navPerToken == 0) revert InvalidNav();
        Asset storage a = _assets[token];
        a.navPerToken = navPerToken;
        a.navUpdatedAt = uint64(block.timestamp);
        emit NavUpdated(token, navPerToken, uint64(block.timestamp));
    }

    // ---------- views ----------

    function getAsset(address token) external view returns (Asset memory) {
        _requireRegistered(token);
        return _assets[token];
    }

    function isRegistered(address token) public view returns (bool) {
        return _assets[token].token != address(0);
    }

    /// @return days in 1e18 fixed point: settlementWindow / secondsPerDay
    function horizonDays(address token) external view returns (uint256) {
        _requireRegistered(token);
        return uint256(_assets[token].settlementWindow) * 1e18 / secondsPerDay;
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function _requireRegistered(address token) internal view {
        if (!isRegistered(token)) revert AssetNotRegistered(token);
    }
}
