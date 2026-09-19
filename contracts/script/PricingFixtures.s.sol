// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {Pricing} from "../src/lib/Pricing.sol";

/// @notice Writes fixtures/pricing.json so the TypeScript pricing mirror can be tested to the wei.
/// Usage: forge script script/PricingFixtures.s.sol
///
/// Sweeps 9 utilisations x 4 vols x 4 horizons x 3 NAVs x 4 credits = 1,728 records.
///
/// Each record also emits the *inputs* to navValueWad, horizonDaysWad (mirrored off-chain; there is
/// no standalone Solidity function of that name, so this script and RWARegistry.horizonDays both
/// compute `settlementWindow * 1e18 / secondsPerDay` independently) and projectedUtilisationBps —
/// `amount`/`navPerToken`, `settlementWindow`/`secondsPerDay`, and `idle`/`outstanding`/`proposedUsdc`
/// — so the TypeScript parity test must derive `navWad`, `horizonWad` and `uBps` itself instead of
/// trusting the pre-computed values. That takes the guarded surface from 4 functions to 7.
contract PricingFixtures is Script {
    struct Rec {
        // pre-computed, same names/order as before this change
        uint256 uBps;
        uint256 utilTerm;
        uint256 vol;
        uint256 horizonWad;
        uint256 timeRisk;
        uint256 navWad;
        uint256 spread;
        uint256 payout;
        // inputs to navValueWad / horizonDaysWad / projectedUtilisationBps, so the TS test can
        // derive the three pre-computed fields above and compare them against Solidity's output.
        uint256 amount;
        uint256 navPerToken;
        uint256 settlementWindow;
        uint256 secondsPerDay;
        uint256 idle;
        uint256 outstanding;
        uint256 proposedUsdc;
        // appended last per the brief: keep existing field names/order, append credit.
        uint256 credit;
    }

    uint256 constant AMOUNT = 1e18; // fixed "1 token" scale; navPerToken sweeps the NAV magnitude
    uint256 constant SECONDS_PER_DAY = 60;
    uint256 constant IDLE = 10_000; // with outstanding=0, proposedUsdc reproduces uBpsTarget exactly
    uint256 constant FIXTURE_BASE_BPS = 3;

    function run() external {
        Pricing.Curve memory c = Pricing.Curve({kinkBps: 8_000, slope1Bps: 20, slope2Bps: 200});
        uint256[9] memory us = [uint256(0), 104, 1_000, 4_999, 8_000, 8_001, 9_500, 10_000, 12_000];
        uint256[4] memory vols = [uint256(0), 1, 30, 180];
        // settlementWindow values that, at SECONDS_PER_DAY = 60, reproduce the old horizonWad sweep
        // [0, 1e18, 2e18, 4e18] exactly: 0, 60, 120, 240 seconds -> 0, 1, 2, 4 days.
        uint256[4] memory windows = [uint256(0), 60, 120, 240];
        uint256[3] memory navPerTokens = [uint256(1_040e18), 24_850e18, 1];
        uint256[4] memory credits = [uint256(0), 2, 15, 380];

        // Written record-by-record via vm.writeLine rather than accumulated into one growing
        // in-memory string: concatenating onto a single `string memory` for ~1,728 records copies
        // the whole (ever-larger) buffer on every iteration, an O(n^2) cost that overflows the
        // script's EVM memory (MemoryOOG) well before the end of the sweep. vm.writeLine is a
        // cheatcode file append, so each call's cost is independent of how much has been written.
        vm.createDir("fixtures", true);
        string memory path = "fixtures/pricing.json";
        vm.writeFile(path, "[\n");
        bool first = true;
        for (uint256 i = 0; i < us.length; i++) {
            for (uint256 j = 0; j < vols.length; j++) {
                for (uint256 k = 0; k < windows.length; k++) {
                    for (uint256 m = 0; m < navPerTokens.length; m++) {
                        for (uint256 n = 0; n < credits.length; n++) {
                            string memory rec =
                                _buildRecord(c, us[i], vols[j], windows[k], navPerTokens[m], credits[n]);
                            vm.writeLine(path, first ? rec : string.concat(",", rec));
                            first = false;
                        }
                    }
                }
            }
        }
        vm.writeLine(path, "]");
    }

    /// @dev Isolates the per-record math and string-building in their own frames so the five-deep
    ///      loop in `run` doesn't accumulate enough locals to overflow the stack.
    function _buildRecord(
        Pricing.Curve memory c,
        uint256 uBpsTarget,
        uint256 vol,
        uint256 settlementWindow,
        uint256 navPerToken,
        uint256 credit
    ) internal pure returns (string memory) {
        Rec memory r;
        r.amount = AMOUNT;
        r.navPerToken = navPerToken;
        r.settlementWindow = settlementWindow;
        r.secondsPerDay = SECONDS_PER_DAY;
        r.idle = IDLE;
        r.outstanding = 0;
        r.proposedUsdc = uBpsTarget;
        r.credit = credit;

        r.uBps = Pricing.projectedUtilisationBps(r.idle, r.outstanding, r.proposedUsdc);
        r.vol = vol;
        r.horizonWad = r.settlementWindow * 1e18 / r.secondsPerDay;
        r.navWad = Pricing.navValueWad(r.amount, r.navPerToken);
        r.utilTerm = Pricing.utilisationTermBps(r.uBps, c);
        r.timeRisk = Pricing.timeRiskBps(r.vol, r.horizonWad);
        r.spread = FIXTURE_BASE_BPS + r.utilTerm + r.timeRisk + Pricing.creditTermBps(r.credit);
        r.payout = Pricing.payoutUsdc(r.navWad, r.spread);
        return _encode(r);
    }

    function _encode(Rec memory r) internal pure returns (string memory) {
        return string.concat(_encodeComputed(r), ",", _encodeInputs(r), "}");
    }

    function _encodeComputed(Rec memory r) internal pure returns (string memory) {
        return string.concat(
            "{\"uBps\":",
            vm.toString(r.uBps),
            ",\"kink\":8000,\"slope1\":20,\"slope2\":200",
            ",\"utilTerm\":",
            vm.toString(r.utilTerm),
            ",\"vol\":",
            vm.toString(r.vol),
            ",\"horizonWad\":\"",
            vm.toString(r.horizonWad),
            "\"",
            ",\"timeRisk\":",
            vm.toString(r.timeRisk),
            ",\"navWad\":\"",
            vm.toString(r.navWad),
            "\"",
            ",\"spread\":",
            vm.toString(r.spread),
            ",\"payout\":\"",
            vm.toString(r.payout),
            "\""
        );
    }

    function _encodeInputs(Rec memory r) internal pure returns (string memory) {
        return string.concat(
            "\"amount\":\"",
            vm.toString(r.amount),
            "\"",
            ",\"navPerToken\":\"",
            vm.toString(r.navPerToken),
            "\"",
            ",\"settlementWindow\":",
            vm.toString(r.settlementWindow),
            ",\"secondsPerDay\":",
            vm.toString(r.secondsPerDay),
            ",\"idle\":\"",
            vm.toString(r.idle),
            "\"",
            ",\"outstanding\":\"",
            vm.toString(r.outstanding),
            "\"",
            ",\"proposedUsdc\":\"",
            vm.toString(r.proposedUsdc),
            "\"",
            ",\"credit\":",
            vm.toString(r.credit)
        );
    }
}
