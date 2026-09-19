// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IIssuer {
    /// @notice Record that `amount` of `token` has been delivered for redemption under `id`.
    function requestRedemption(uint256 id, address token, uint256 amount) external;

    /// @notice Burn the delivered tokens and pay current NAV in USDC to the caller.
    /// @return proceedsUsdc USDC (6 decimals) transferred to the caller
    function settle(uint256 id) external returns (uint256 proceedsUsdc);
}
