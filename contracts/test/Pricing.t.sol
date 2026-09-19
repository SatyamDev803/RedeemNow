// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Pricing} from "../src/lib/Pricing.sol";

contract PricingHarness {
    function utilisationTermBps(uint256 u, Pricing.Curve memory c) external pure returns (uint256) {
        return Pricing.utilisationTermBps(u, c);
    }
    function timeRiskBps(uint256 vol, uint256 h) external pure returns (uint256) {
        return Pricing.timeRiskBps(vol, h);
    }
    function navValueWad(uint256 a, uint256 n) external pure returns (uint256) {
        return Pricing.navValueWad(a, n);
    }
    function wadToUsdc(uint256 w) external pure returns (uint256) {
        return Pricing.wadToUsdc(w);
    }
    function projectedUtilisationBps(uint256 i, uint256 o, uint256 p) external pure returns (uint256) {
        return Pricing.projectedUtilisationBps(i, o, p);
    }
    function payoutUsdc(uint256 nv, uint256 s) external pure returns (uint256) {
        return Pricing.payoutUsdc(nv, s);
    }
}

contract PricingTest is Test {
    PricingHarness h;
    Pricing.Curve curve = Pricing.Curve({kinkBps: 8_000, slope1Bps: 20, slope2Bps: 200});

    function setUp() public {
        h = new PricingHarness();
    }

    function test_utilisationTermAtZeroIsZero() public view {
        assertEq(h.utilisationTermBps(0, curve), 0);
    }

    function test_utilisationTermAtKinkIsSlope1() public view {
        assertEq(h.utilisationTermBps(8_000, curve), 20);
    }

    function test_utilisationTermAtFullIsSlope1PlusSlope2() public view {
        assertEq(h.utilisationTermBps(10_000, curve), 220);
    }

    function test_utilisationTermAboveFullIsCapped() public view {
        assertEq(h.utilisationTermBps(15_000, curve), 220);
    }

    function testFuzz_utilisationTermMonotonic(uint256 a, uint256 b) public view {
        a = bound(a, 0, 10_000);
        b = bound(b, a, 10_000);
        assertLe(h.utilisationTermBps(a, curve), h.utilisationTermBps(b, curve));
    }

    function test_timeRiskSqrtScaling() public view {
        // 180 bps/day over 4 days = 360 bps
        assertEq(h.timeRiskBps(180, 4e18), 360);
        // 180 bps/day over 2 days = 180 * 1.41421356 = 254 (floor)
        assertEq(h.timeRiskBps(180, 2e18), 254);
        // 1 bps/day over 2 days floors to 1
        assertEq(h.timeRiskBps(1, 2e18), 1);
        assertEq(h.timeRiskBps(180, 0), 0);
    }

    function testFuzz_timeRiskMonotonicInHorizon(uint256 vol, uint256 a, uint256 b) public view {
        vol = bound(vol, 0, 5_000);
        a = bound(a, 0, 3_650e18);
        b = bound(b, a, 3_650e18);
        assertLe(h.timeRiskBps(vol, a), h.timeRiskBps(vol, b));
    }

    function test_navValueAndUsdcScaling() public view {
        // 1,000 tokens at $1.04 = $1,040 = 1_040e18 wad = 1_040e6 usdc
        uint256 wad = h.navValueWad(1_000e18, 1.04e18);
        assertEq(wad, 1_040e18);
        assertEq(h.wadToUsdc(wad), 1_040e6);
    }

    function test_projectedUtilisation() public view {
        // idle 900, outstanding 100, propose 100 -> (100+100)/1000 = 20%
        assertEq(h.projectedUtilisationBps(900e6, 100e6, 100e6), 2_000);
        // empty vault -> 100%
        assertEq(h.projectedUtilisationBps(0, 0, 1), 10_000);
        // proposing more than the vault holds -> above 100% (caller must reject)
        assertGt(h.projectedUtilisationBps(100e6, 0, 200e6), 10_000);
    }

    function test_payout() public view {
        // $1,040 at 4 bps spread = 1040 * 0.9996 = 1039.584 -> 1_039_584_000 (6 dec)
        assertEq(h.payoutUsdc(1_040e18, 4), 1_039_584_000);
        assertEq(h.payoutUsdc(1_040e18, 0), 1_040e6);
        assertEq(h.payoutUsdc(1_040e18, 10_000), 0);
    }

    function testFuzz_payoutNeverExceedsNav(uint256 navWad, uint256 spread) public view {
        navWad = bound(navWad, 0, 1e30);
        spread = bound(spread, 0, 10_000);
        assertLe(h.payoutUsdc(navWad, spread), h.wadToUsdc(navWad));
    }

    function test_creditTermIsTheCreditPremium() public pure {
        assertEq(Pricing.creditTermBps(0), 0);
        assertEq(Pricing.creditTermBps(2), 2);
        assertEq(Pricing.creditTermBps(380), 380);
    }

    function test_spreadIsTheSumOfFourTerms() public pure {
        Pricing.Curve memory c = Pricing.Curve({kinkBps: 8_000, slope1Bps: 20, slope2Bps: 200});
        uint256 base = 15;
        uint256 util = Pricing.utilisationTermBps(4_000, c);
        uint256 time = Pricing.timeRiskBps(25, 10e18);
        uint256 credit = Pricing.creditTermBps(380);
        // 4000 bps utilisation is half the kink, so util = 10
        assertEq(util, 10);
        // 25 bps/day over sqrt(10) days = 25 * 3.162... = 79
        assertEq(time, 79);
        assertEq(credit, 380);
        assertEq(base + util + time + credit, 484);
    }

    function test_creditDominatesSpreadForPrivateCredit() public pure {
        // The pitch claim: for private credit, credit risk is the largest single term, not
        // utilisation. If this ever stops being true the demo narrative is wrong.
        Pricing.Curve memory c = Pricing.Curve({kinkBps: 8_000, slope1Bps: 20, slope2Bps: 200});
        uint256 util = Pricing.utilisationTermBps(4_000, c);
        uint256 time = Pricing.timeRiskBps(25, 10e18);
        uint256 credit = Pricing.creditTermBps(380);
        assertGt(credit, util);
        assertGt(credit, time);
        assertGt(credit, 15);
    }

    function test_creditIsNegligibleForSovereign() public pure {
        // And the contrast: a T-bill's credit term is a rounding error.
        assertEq(Pricing.creditTermBps(2), 2);
    }
}
