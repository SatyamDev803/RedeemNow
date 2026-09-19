// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {LiquidityVault} from "../src/LiquidityVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

contract LiquidityVaultTest is Test {
    MockUSDC usdc;
    LiquidityVault vault;
    address admin = makeAddr("admin");
    address lp = makeAddr("lp");
    address lp2 = makeAddr("lp2");
    address holder = makeAddr("holder");
    address bridge = makeAddr("bridge");

    function setUp() public {
        usdc = new MockUSDC(admin);
        vault = new LiquidityVault(IERC20(address(usdc)), admin, 9_500);
        vm.startPrank(admin);
        vault.grantRole(vault.BRIDGE_ROLE(), bridge);
        usdc.mint(lp, 1_000_000e6);
        usdc.mint(lp2, 1_000_000e6);
        usdc.mint(bridge, 2_000_000e6); // enough to cover fuzzed proceeds up to 2x a 95% advance
        vm.stopPrank();
        vm.prank(lp);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(lp2);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bridge);
        usdc.approve(address(vault), type(uint256).max);
    }

    function _deposit(address who, uint256 amount) internal returns (uint256 shares) {
        vm.prank(who);
        shares = vault.deposit(amount, who);
    }

    function test_depositTracksIdleAndMintsOneToOne() public {
        uint256 shares = _deposit(lp, 100_000e6);
        assertEq(shares, 100_000e6);
        assertEq(vault.idle(), 100_000e6);
        assertEq(vault.outstanding(), 0);
        assertEq(vault.totalAssets(), 100_000e6);
        assertEq(vault.utilisationBps(), 0);
    }

    function test_advanceMovesIdleToOutstanding() public {
        _deposit(lp, 100_000e6);
        vm.prank(bridge);
        vault.advance(holder, 40_000e6);
        assertEq(usdc.balanceOf(holder), 40_000e6);
        assertEq(vault.idle(), 60_000e6);
        assertEq(vault.outstanding(), 40_000e6);
        assertEq(vault.totalAssets(), 100_000e6);
        assertEq(vault.utilisationBps(), 4_000);
    }

    function test_advanceRevertsAboveMaxUtilisation() public {
        _deposit(lp, 100_000e6);
        vm.expectRevert(abi.encodeWithSelector(LiquidityVault.UtilisationTooHigh.selector, 9_600, 9_500));
        vm.prank(bridge);
        vault.advance(holder, 96_000e6);
    }

    function test_advanceRevertsAboveIdle() public {
        _deposit(lp, 100_000e6);
        vm.expectRevert(abi.encodeWithSelector(LiquidityVault.InsufficientIdle.selector, 100_001e6, 100_000e6));
        vm.prank(bridge);
        vault.advance(holder, 100_001e6);
    }

    function test_capacityUsdcOnEmptyVault() public {
        assertEq(vault.capacityUsdc(), 0);
    }

    function test_advanceOnEmptyVaultRevertsEmptyVault() public {
        vm.expectRevert(LiquidityVault.EmptyVault.selector);
        vm.prank(bridge);
        vault.advance(holder, 0);
    }

    function test_nonBridgeCannotAdvance() public {
        _deposit(lp, 100_000e6);
        vm.expectRevert();
        vm.prank(lp);
        vault.advance(lp, 1e6);
    }

    function test_profitableSettlementRaisesSharePrice() public {
        _deposit(lp, 100_000e6);
        vm.prank(bridge);
        vault.advance(holder, 40_000e6);
        // issuer paid 40,100; bridge passes it all to the vault
        vm.prank(bridge);
        vault.settleReceivable(40_000e6, 40_100e6);
        assertEq(vault.outstanding(), 0);
        assertEq(vault.idle(), 100_100e6);
        assertEq(vault.totalAssets(), 100_100e6);
        // ERC-4626 applies an unconditional virtual +1 asset / +1 share offset (OZ inflation-attack
        // protection), independent of _decimalsOffset(), so the redeemable value lands 1 wei under
        // the nominal 100_100e6. Assert the intent, not the rounding artifact.
        assertGt(vault.convertToAssets(100_000e6), 100_000e6);
        assertApproxEqAbs(vault.convertToAssets(100_000e6), 100_100e6, 1);
    }

    function test_shortfallSettlementLowersSharePriceAndEmits() public {
        _deposit(lp, 100_000e6);
        vm.prank(bridge);
        vault.advance(holder, 40_000e6);
        vm.expectEmit(true, true, true, true);
        emit LiquidityVault.LossRealised(40_000e6, 39_000e6, 1_000e6);
        vm.prank(bridge);
        vault.settleReceivable(40_000e6, 39_000e6);
        assertEq(vault.totalAssets(), 99_000e6);
        assertEq(vault.convertToAssets(100_000e6), 99_000e6);
    }

    function test_withdrawLimitedToIdle() public {
        _deposit(lp, 100_000e6);
        vm.prank(bridge);
        vault.advance(holder, 40_000e6);
        assertEq(vault.maxWithdraw(lp), 60_000e6);
        vm.expectRevert(
            abi.encodeWithSelector(ERC4626.ERC4626ExceededMaxWithdraw.selector, lp, 60_001e6, 60_000e6)
        );
        vm.prank(lp);
        vault.withdraw(60_001e6, lp, lp);
        vm.prank(lp);
        vault.withdraw(60_000e6, lp, lp);
        assertEq(vault.idle(), 0);
    }

    function test_pausedBlocksDepositAndAdvance() public {
        _deposit(lp, 100_000e6);
        vm.prank(admin);
        vault.pause();
        vm.expectRevert();
        _deposit(lp, 1e6);
        vm.expectRevert();
        vm.prank(bridge);
        vault.advance(holder, 1e6);
        vm.prank(admin);
        vault.unpause();
        _deposit(lp, 1e6);
    }

    function testFuzz_totalAssetsInvariant(uint96 dep, uint96 adv, uint96 proceeds) public {
        dep = uint96(bound(dep, 1e6, 1_000_000e6));
        adv = uint96(bound(adv, 0, uint256(dep) * 95 / 100));
        proceeds = uint96(bound(proceeds, 0, uint256(adv) * 2));
        _deposit(lp, dep);
        if (adv > 0) {
            vm.prank(bridge);
            vault.advance(holder, adv);
            assertEq(vault.totalAssets(), dep);
            vm.prank(bridge);
            vault.settleReceivable(adv, proceeds);
        }
        assertEq(vault.totalAssets(), vault.idle() + vault.outstanding());
        assertEq(usdc.balanceOf(address(vault)), vault.idle());
    }

    function test_absorbLossDropsTotalAssetsAndSharePrice() public {
        // 100k deposited, 40k advanced, then the whole advance is written off.
        _deposit(lp, 100_000e6);
        uint256 priceBefore = vault.convertToAssets(1_000_000);
        vm.prank(bridge);
        vault.advance(holder, 40_000e6);
        // An advance moves capital but must not move share price.
        assertEq(vault.convertToAssets(1_000_000), priceBefore);

        vm.prank(bridge);
        vault.absorbLoss(40_000e6);

        assertEq(vault.outstanding(), 0);
        assertEq(vault.totalAssets(), 60_000e6);
        assertLt(vault.convertToAssets(1_000_000), priceBefore);
    }

    function test_absorbLossHitsEveryLpEquallyAndAtOnce() public {
        // THE property that removes the bank-run incentive: two LPs in at the same price must
        // suffer the same loss, and neither can exit ahead of it at the old price.
        _deposit(lp, 100_000e6);
        _deposit(lp2, 100_000e6);

        uint256 v1Before = vault.convertToAssets(vault.balanceOf(lp));
        uint256 v2Before = vault.convertToAssets(vault.balanceOf(lp2));
        assertApproxEqAbs(v1Before, v2Before, 1);

        vm.prank(bridge);
        vault.advance(holder, 50_000e6);
        vm.prank(bridge);
        vault.absorbLoss(50_000e6);

        uint256 v1After = vault.convertToAssets(vault.balanceOf(lp));
        uint256 v2After = vault.convertToAssets(vault.balanceOf(lp2));
        // Both lost, and by the same proportion.
        assertLt(v1After, v1Before);
        assertLt(v2After, v2Before);
        assertApproxEqAbs(v1Before - v1After, v2Before - v2After, 2);
    }

    function test_absorbLossOnlyBridge() public {
        _deposit(lp, 100_000e6);
        vm.expectRevert();
        vault.absorbLoss(1e6);
    }

    function test_recoverLossReturnsCapitalToIdle() public {
        _deposit(lp, 100_000e6);
        vm.prank(bridge);
        vault.advance(holder, 40_000e6);
        vm.prank(bridge);
        vault.absorbLoss(40_000e6);
        uint256 afterLoss = vault.totalAssets();

        // The bridge forwards whatever it clawed back (already funded and approved in setUp).
        vm.prank(bridge);
        vault.recoverLoss(10_000e6);

        assertEq(vault.totalAssets(), afterLoss + 10_000e6);
        assertEq(vault.idle(), 60_000e6 + 10_000e6);
    }

    function test_absorbLossCannotExceedOutstanding() public {
        _deposit(lp, 100_000e6);
        vm.prank(bridge);
        vault.advance(holder, 10_000e6);
        vm.prank(bridge);
        vm.expectRevert();
        vault.absorbLoss(20_000e6);
    }
}
