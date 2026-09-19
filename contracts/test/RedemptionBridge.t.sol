// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Fixture} from "./utils/Fixture.sol";
import {RedemptionBridge} from "../src/RedemptionBridge.sol";
import {LiquidityVault} from "../src/LiquidityVault.sol";
import {Pricing} from "../src/lib/Pricing.sol";

contract RedemptionBridgeTest is Fixture {
    function test_quoteDecomposition_tbill() public view {
        RedemptionBridge.Quote memory q = bridge.quote(address(tbill), 1_000e18);
        assertEq(q.navValueWad, 1_040e18);
        assertEq(q.navValueUsdc, 1_040e6);
        // projected utilisation: 1,040 / 100,000 = 1.04% = 104 bps
        assertEq(q.utilisationBps, 104);
        assertEq(q.baseBps, 3);
        // slope1 20 * 104 / 8000 = 0 (floor)
        assertEq(q.utilTermBps, 0);
        // 1 bps * sqrt(2 days) = 1
        assertEq(q.timeRiskBps, 1);
        assertEq(q.spreadBps, 4);
        assertEq(q.payout, 1_039_584_000);
    }

    function test_quote_tslaHasWiderSpread() public view {
        RedemptionBridge.Quote memory q = bridge.quote(address(tsla), 100e18);
        assertEq(q.navValueUsdc, 24_850e6);
        assertEq(q.baseBps, 15);
        assertEq(q.timeRiskBps, 254);
        assertGt(q.spreadBps, 250);
    }

    function test_redeemHappyPath() public {
        uint256 holderUsdcBefore = usdc.balanceOf(holder);
        vm.expectEmit(true, true, true, true);
        emit RedemptionBridge.ReceivableOpened(
            1, address(tbill), holder, 1_000e18, 1.04e18, 1_039_584_000, 4, uint64(block.timestamp + WINDOW)
        );
        vm.prank(holder);
        uint256 id = bridge.redeem(address(tbill), 1_000e18, 1_039e6);

        assertEq(id, 1);
        assertEq(usdc.balanceOf(holder) - holderUsdcBefore, 1_039_584_000);
        assertEq(tbill.balanceOf(holder), 9_000e18);
        assertEq(tbill.balanceOf(address(issuer)), 1_000e18);
        assertEq(vault.outstanding(), 1_039_584_000);
        assertEq(vault.idle(), 100_000e6 - 1_039_584_000);

        RedemptionBridge.Receivable memory r = bridge.getReceivable(1);
        assertEq(r.holder, holder);
        assertEq(r.advanced, 1_039_584_000);
        assertEq(r.expected, 1_040e6);
        assertEq(r.settleAfter, block.timestamp + WINDOW);
        assertEq(uint8(r.status), uint8(RedemptionBridge.Status.Open));
        assertEq(bridge.openReceivableIds().length, 1);
        assertEq(bridge.openReceivableIds()[0], 1);
    }

    function test_redeemIneligibleReverts() public {
        vm.expectRevert(abi.encodeWithSelector(RedemptionBridge.NotEligibleRedeemer.selector, address(priv)));
        vm.prank(holder);
        bridge.redeem(address(priv), 1e18, 0);
    }

    function test_redeemDisabledReverts() public {
        vm.prank(admin);
        registry.setEnabled(address(tbill), false);
        vm.expectRevert(abi.encodeWithSelector(RedemptionBridge.AssetDisabled.selector, address(tbill)));
        vm.prank(holder);
        bridge.redeem(address(tbill), 1e18, 0);
    }

    function test_redeemSlippageReverts() public {
        vm.expectRevert(
            abi.encodeWithSelector(RedemptionBridge.SlippageExceeded.selector, 1_039_584_000, 1_040e6)
        );
        vm.prank(holder);
        bridge.redeem(address(tbill), 1_000e18, 1_040e6);
    }

    function test_redeemZeroAmountReverts() public {
        vm.expectRevert(RedemptionBridge.ZeroAmount.selector);
        vm.prank(holder);
        bridge.redeem(address(tbill), 0, 0);
    }

    function test_redeemBeyondVaultCapacityReverts() public {
        // 10,000 rTSLA = $2.485M against a $100k vault
        RedemptionBridge.Quote memory q = bridge.quote(address(tsla), 10_000e18);
        vm.expectRevert(abi.encodeWithSelector(RedemptionBridge.InsufficientCapacity.selector, q.payout, q.capacityUsdc));
        vm.prank(holder);
        bridge.redeem(address(tsla), 10_000e18, 0);
    }

    function test_capacityUsdcReflectsUtilisationCap() public {
        // 95% of 100,000e6, nothing outstanding
        assertEq(bridge.quote(address(tbill), 1e18).capacityUsdc, 95_000e6);
        vm.prank(holder);
        bridge.redeem(address(tbill), 1_000e18, 0);
        assertLt(bridge.quote(address(tbill), 1e18).capacityUsdc, 95_000e6);
    }

    function test_maxRedeemableIsConservative() public {
        uint256 maxAmt = bridge.maxRedeemable(address(tsla));
        assertGt(maxAmt, 0);
        vm.prank(holder);
        bridge.redeem(address(tsla), maxAmt, 0);
    }

    function test_dustRedeemRevertsPayoutTooSmall() public {
        vm.expectRevert(abi.encodeWithSelector(RedemptionBridge.PayoutTooSmall.selector, 1));
        vm.prank(holder);
        bridge.redeem(address(tbill), 1, 0);
    }

    function test_settleBeforeWindowRevertsForNonAdmin() public {
        vm.prank(holder);
        bridge.redeem(address(tbill), 1_000e18, 0);
        vm.expectRevert(
            abi.encodeWithSelector(
                RedemptionBridge.SettlementWindowNotElapsed.selector, 1, uint64(block.timestamp + WINDOW)
            )
        );
        vm.prank(keeper);
        bridge.settle(1);
    }

    function test_settleAfterWindowSplitsProfit() public {
        vm.prank(holder);
        bridge.redeem(address(tbill), 1_000e18, 0);
        vm.warp(block.timestamp + WINDOW);

        // proceeds 1,040e6; advanced 1,039.584e6; profit 416_000; fee 25% = 104_000
        vm.expectEmit(true, true, true, true);
        emit RedemptionBridge.ReceivableSettled(1, 1_040e6, 104_000, int256(312_000));
        vm.prank(keeper);
        uint256 proceeds = bridge.settle(1);

        assertEq(proceeds, 1_040e6);
        assertEq(usdc.balanceOf(treasury), 104_000);
        assertEq(usdc.balanceOf(address(bridge)), 0);
        assertEq(vault.outstanding(), 0);
        assertEq(vault.idle(), 100_000e6 + 312_000);
        assertEq(vault.totalAssets(), 100_000_312_000);
        assertEq(bridge.openReceivableIds().length, 0);
        assertEq(uint8(bridge.getReceivable(1).status), uint8(RedemptionBridge.Status.Settled));
        assertEq(tbill.balanceOf(address(issuer)), 0);
    }

    function test_settleTwiceReverts() public {
        vm.prank(holder);
        bridge.redeem(address(tbill), 1_000e18, 0);
        vm.warp(block.timestamp + WINDOW);
        vm.prank(keeper);
        bridge.settle(1);
        vm.expectRevert(abi.encodeWithSelector(RedemptionBridge.ReceivableNotOpen.selector, 1));
        vm.prank(keeper);
        bridge.settle(1);
    }

    function test_demoAdminCanSettleEarlyAndEmitsOverride() public {
        // NOTE: hoist the role out of the pranked call — an external getter passed as an
        // argument consumes vm.prank before grantRole runs.
        bytes32 demoRole = bridge.DEMO_ADMIN_ROLE();
        vm.prank(admin);
        bridge.grantRole(demoRole, admin);
        vm.prank(holder);
        bridge.redeem(address(tbill), 1_000e18, 0);

        vm.expectEmit(true, true, true, true);
        emit RedemptionBridge.DemoOverride(1, admin);
        vm.prank(admin);
        bridge.settle(1);
        assertEq(vault.outstanding(), 0);
    }

    function test_navDropCausesLpLossAndNoFee() public {
        vm.prank(holder);
        bridge.redeem(address(tsla), 100e18, 0);
        uint256 advanced = bridge.getReceivable(1).advanced;
        // TSLA gaps down 8% over the weekend
        vm.prank(admin);
        registry.setNav(address(tsla), 228.62e18);
        vm.warp(block.timestamp + WINDOW);

        vm.expectEmit(true, true, true, true);
        emit LiquidityVault.LossRealised(advanced, 22_862e6, advanced - 22_862e6);
        vm.prank(keeper);
        bridge.settle(1);

        assertEq(usdc.balanceOf(treasury), 0);
        assertLt(vault.totalAssets(), 100_000e6);
        assertEq(vault.totalAssets(), 100_000e6 - advanced + 22_862e6);
    }

    function test_utilisationTermRisesWithBookSize() public {
        RedemptionBridge.Quote memory q0 = bridge.quote(address(tsla), 100e18);
        vm.prank(holder);
        bridge.redeem(address(tsla), 200e18, 0); // ~$49.7k of a $100k vault
        RedemptionBridge.Quote memory q1 = bridge.quote(address(tsla), 100e18);
        assertGt(q1.utilisationBps, q0.utilisationBps);
        assertGt(q1.utilTermBps, q0.utilTermBps);
        assertGt(q1.spreadBps, q0.spreadBps);
    }

    function test_pausedBlocksRedeem() public {
        vm.prank(admin);
        bridge.pause();
        vm.expectRevert();
        vm.prank(holder);
        bridge.redeem(address(tbill), 1e18, 0);
    }

    function test_openIdsSwapPopKeepsOthers() public {
        vm.startPrank(holder);
        bridge.redeem(address(tbill), 100e18, 0);
        bridge.redeem(address(tbill), 100e18, 0);
        bridge.redeem(address(tbill), 100e18, 0);
        vm.stopPrank();
        vm.warp(block.timestamp + WINDOW);
        vm.prank(keeper);
        bridge.settle(2);
        uint256[] memory open = bridge.openReceivableIds();
        assertEq(open.length, 2);
        assertTrue((open[0] == 1 && open[1] == 3) || (open[0] == 3 && open[1] == 1));
    }

    function test_adminSettersEmitAndApply() public {
        vm.startPrank(admin);
        bridge.setProtocolFee(1_000);
        assertEq(bridge.protocolFeeBps(), 1_000);
        bridge.setTreasury(keeper);
        assertEq(bridge.treasury(), keeper);
        bridge.setCurve(Pricing.Curve({kinkBps: 9_000, slope1Bps: 10, slope2Bps: 100}));
        (uint16 k,,) = bridge.curve();
        assertEq(k, 9_000);
        vm.expectRevert(RedemptionBridge.InvalidFee.selector);
        bridge.setProtocolFee(10_001);
        vm.expectRevert(RedemptionBridge.InvalidCurve.selector);
        bridge.setCurve(Pricing.Curve({kinkBps: 0, slope1Bps: 10, slope2Bps: 100}));
        vm.stopPrank();
    }

    // ---------- exposure cap ----------

    function test_exposureCapBlocksConcentration() public {
        // Cap rTBILL at 5% of the vault, then try to exceed it in one redemption.
        vm.prank(admin);
        registry.setMaxExposure(address(tbill), 500); // 5% of 100k = 5,000 USDC
        uint256 cap = bridge.assetExposureCapUsdc(address(tbill));
        assertEq(cap, 5_000e6);

        // ~9,984 USDC of NAV value at 1.04 is well over the cap.
        vm.startPrank(holder);
        vm.expectPartialRevert(RedemptionBridge.ExposureCapExceeded.selector);
        bridge.redeem(address(tbill), 9_600e18, 0);
        vm.stopPrank();
    }

    function test_exposureCapAllowsUpToTheLimit() public {
        vm.prank(admin);
        registry.setMaxExposure(address(tbill), 500);
        vm.startPrank(holder);
        // ~1,039.584 USDC payout, comfortably inside a 5,000 cap.
        bridge.redeem(address(tbill), 1_000e18, 0);
        vm.stopPrank();
        assertGt(bridge.exposureUsdc(address(tbill)), 0);
        assertLe(bridge.exposureUsdc(address(tbill)), 5_000e6);
    }

    function test_exposureFreesUpOnSettlement() public {
        vm.prank(holder);
        bridge.redeem(address(tbill), 1_000e18, 0);
        assertGt(bridge.exposureUsdc(address(tbill)), 0);

        vm.warp(block.timestamp + WINDOW + 1);
        bridge.settle(1);
        assertEq(bridge.exposureUsdc(address(tbill)), 0);
    }

    // ---------- impairment ----------

    function test_cannotImpairBeforeGracePeriod() public {
        vm.prank(holder);
        bridge.redeem(address(tbill), 1_000e18, 0);

        vm.prank(admin);
        vm.expectPartialRevert(RedemptionBridge.NotYetImpairable.selector);
        bridge.markImpaired(1);

        // Still not impairable exactly at the end of the grace period.
        uint32 impairAfter = bridge.impairAfter();
        vm.warp(block.timestamp + WINDOW + impairAfter);
        vm.prank(admin);
        vm.expectPartialRevert(RedemptionBridge.NotYetImpairable.selector);
        bridge.markImpaired(1);
    }

    function test_impairWritesDownAndRemovesFromOpenBook() public {
        vm.prank(holder);
        bridge.redeem(address(tbill), 1_000e18, 0);
        uint256 advanced = bridge.getReceivable(1).advanced;
        uint256 totalBefore = vault.totalAssets();
        uint32 impairAfter = bridge.impairAfter();

        vm.warp(block.timestamp + WINDOW + impairAfter + 1);
        vm.prank(admin);
        bridge.markImpaired(1);

        assertEq(uint8(bridge.getReceivable(1).status), uint8(RedemptionBridge.Status.Impaired));
        assertEq(bridge.openReceivableIds().length, 0);
        assertEq(vault.totalAssets(), totalBefore - advanced);
        assertEq(bridge.exposureUsdc(address(tbill)), 0);
    }

    function test_impairedReceivableCannotBeSettled() public {
        vm.prank(holder);
        bridge.redeem(address(tbill), 1_000e18, 0);
        uint32 impairAfter = bridge.impairAfter();
        vm.warp(block.timestamp + WINDOW + impairAfter + 1);
        vm.prank(admin);
        bridge.markImpaired(1);

        vm.expectRevert(abi.encodeWithSelector(RedemptionBridge.ReceivableNotOpen.selector, 1));
        bridge.settle(1);
    }

    function test_impairOnlyRiskAdmin() public {
        vm.prank(holder);
        bridge.redeem(address(tbill), 1_000e18, 0);
        uint32 impairAfter = bridge.impairAfter();
        vm.warp(block.timestamp + WINDOW + impairAfter + 1);
        vm.expectRevert();
        bridge.markImpaired(1);
    }

    function test_recoveryOnAnImpairedReceivableReturnsCapital() public {
        vm.prank(holder);
        bridge.redeem(address(tbill), 1_000e18, 0);
        uint256 advanced = bridge.getReceivable(1).advanced;
        uint32 impairAfter = bridge.impairAfter();

        vm.warp(block.timestamp + WINDOW + impairAfter + 1);
        vm.prank(admin);
        bridge.markImpaired(1);
        uint256 afterImpair = vault.totalAssets();

        // A workout recovers 60% of the advance; the admin funds the bridge and books it.
        uint256 recovered = (advanced * 60) / 100;
        vm.prank(admin);
        usdc.mint(admin, recovered);
        vm.startPrank(admin);
        usdc.approve(address(bridge), type(uint256).max);
        bridge.recoverImpaired(1, recovered);
        vm.stopPrank();

        assertEq(vault.totalAssets(), afterImpair + recovered);
        assertEq(uint8(bridge.getReceivable(1).status), uint8(RedemptionBridge.Status.Settled));
    }

    function test_cannotRecoverAReceivableThatIsNotImpaired() public {
        vm.prank(holder);
        bridge.redeem(address(tbill), 1_000e18, 0);
        vm.prank(admin);
        vm.expectPartialRevert(RedemptionBridge.NotImpaired.selector);
        bridge.recoverImpaired(1, 1e6);
    }

    // ---------- zero-value-id hazard ----------
    // `Status.Open` is the enum's ZERO value, so a receivable id that was never created reads back
    // as {id: 0, status: Open, settleAfter: 0} — which passes a naive `status == Open` check and,
    // because settleAfter is 0, also passes any elapsed-time gate. Both settle() and markImpaired()
    // must therefore reject on `r.id == 0`. This became reachable when `Impaired` was appended to
    // the enum; without these tests the guard could be removed in a refactor and nothing would fail.

    function test_settleUnknownIdReverts() public {
        vm.expectRevert(abi.encodeWithSelector(RedemptionBridge.ReceivableNotOpen.selector, 999));
        bridge.settle(999);
    }

    function test_markImpairedUnknownIdReverts() public {
        vm.warp(block.timestamp + 100_000);
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(RedemptionBridge.ReceivableNotOpen.selector, 999));
        bridge.markImpaired(999);
    }

    function test_unknownIdCannotMoveTheVault() public {
        uint256 before = vault.totalAssets();
        vm.warp(block.timestamp + 100_000);
        vm.prank(admin);
        try bridge.markImpaired(999) {} catch {}
        assertEq(vault.totalAssets(), before, "vault moved on a nonexistent receivable");
    }
}
