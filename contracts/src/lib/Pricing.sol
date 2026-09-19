// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Pure spread and payout math for redemption bridging.
/// @dev spreadBps = base + utilisationTerm(u) + dailyVol * sqrt(horizonDays)
library Pricing {
    uint256 internal constant BPS = 10_000;
    uint256 internal constant WAD = 1e18;
    /// @dev 1e18 (wad) -> 1e6 (USDC)
    uint256 internal constant USDC_SCALE = 1e12;

    struct Curve {
        uint16 kinkBps; // utilisation where slope changes, e.g. 8_000
        uint16 slope1Bps; // spread added at the kink, e.g. 20
        uint16 slope2Bps; // additional spread added from kink to 100%, e.g. 200
    }

    /// @param uBps utilisation in bps; values above 10_000 are treated as 10_000.
    function utilisationTermBps(uint256 uBps, Curve memory c) internal pure returns (uint256) {
        if (uBps > BPS) uBps = BPS;
        if (uBps <= c.kinkBps) {
            return uint256(c.slope1Bps) * uBps / c.kinkBps;
        }
        return uint256(c.slope1Bps) + uint256(c.slope2Bps) * (uBps - c.kinkBps) / (BPS - c.kinkBps);
    }

    /// @param horizonDaysWad settlement horizon in days, 1e18 fixed point
    function timeRiskBps(uint256 dailyVolBps, uint256 horizonDaysWad) internal pure returns (uint256) {
        // sqrt(h * 1e18) where h is already 1e18-scaled yields sqrt(h) at 1e18 scale
        uint256 sqrtDaysWad = Math.sqrt(horizonDaysWad * WAD);
        return dailyVolBps * sqrtDaysWad / WAD;
    }

    /// @notice Expected loss on a redemption already in flight, in bps.
    /// @dev Deliberately NOT scaled by the settlement horizon. Pro-rating an annual default
    ///      probability across a two-day window yields ~2 bps on a 3.8% observed default rate,
    ///      which is arithmetically defensible and economically wrong for this product: the
    ///      exposure is binary settlement risk on one redemption — does the issuer honour it at
    ///      all — which is dominated by counterparty and operational failure, not by term
    ///      structure, at horizons measured in days.
    ///
    ///      This is an identity function today and exists as a named seam, not as a placeholder:
    ///      it gives the term one place to become a real PD x LGD model, and it makes `quote()`
    ///      report credit as its own line instead of folding it into the base spread.
    ///
    ///      Calibration reference (Dune x RWA.xyz 2025): Maple Finance carried $47M of defaulted
    ///      loans against $1.23B of active loans, a 3.8% realised default rate, at a 9.39%
    ///      average base APY. Sovereign and AAA-CLO exposures are set far lower.
    function creditTermBps(uint256 creditBps) internal pure returns (uint256) {
        return creditBps;
    }

    /// @param amount RWA tokens, 1e18
    /// @param navPerToken USD per token, 1e18
    /// @return USD value, 1e18
    function navValueWad(uint256 amount, uint256 navPerToken) internal pure returns (uint256) {
        return amount * navPerToken / WAD;
    }

    function wadToUsdc(uint256 wad) internal pure returns (uint256) {
        return wad / USDC_SCALE;
    }

    /// @notice Utilisation the vault would have if `proposedUsdc` were advanced in full.
    /// @dev Returns 10_000 for an empty vault. May exceed 10_000; callers must reject that.
    function projectedUtilisationBps(uint256 idle, uint256 outstanding, uint256 proposedUsdc)
        internal
        pure
        returns (uint256)
    {
        uint256 total = idle + outstanding;
        if (total == 0) return BPS;
        return (outstanding + proposedUsdc) * BPS / total;
    }

    /// @param navValueWad_ USD value at NAV, 1e18
    /// @return payout in USDC (6 decimals), floored
    function payoutUsdc(uint256 navValueWad_, uint256 spreadBps) internal pure returns (uint256) {
        if (spreadBps >= BPS) return 0;
        return wadToUsdc(navValueWad_ * (BPS - spreadBps) / BPS);
    }
}
