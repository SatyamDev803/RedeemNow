// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RWARegistry} from "../src/RWARegistry.sol";
import {IRWARegistry} from "../src/interfaces/IRWARegistry.sol";

contract RWARegistryTest is Test {
    RWARegistry registry;
    address admin = makeAddr("admin");
    address updater = makeAddr("updater");
    address token = makeAddr("rTBILL");
    address issuer = makeAddr("issuer");

    function setUp() public {
        registry = new RWARegistry(admin, 60);
        bytes32 navUpdaterRole = registry.NAV_UPDATER_ROLE();
        vm.prank(admin);
        registry.grantRole(navUpdaterRole, updater);
    }

    function _register() internal {
        vm.prank(admin);
        registry.registerAsset(
            token, issuer, 1.04e18, 120, 3, 1, 380, 4_000, IRWARegistry.AssetClass.PrivateCredit, true
        );
    }

    function test_registerStoresAsset() public {
        _register();
        IRWARegistry.Asset memory a = registry.getAsset(token);
        assertEq(a.token, token);
        assertEq(a.issuer, issuer);
        assertEq(a.navPerToken, 1.04e18);
        assertEq(a.settlementWindow, 120);
        assertEq(a.baseSpreadBps, 3);
        assertEq(a.dailyVolBps, 1);
        assertTrue(a.eligible);
        assertTrue(a.enabled);
        assertEq(registry.tokenCount(), 1);
        assertEq(registry.tokens(0), token);
    }

    function test_registerTwiceReverts() public {
        _register();
        vm.expectRevert(abi.encodeWithSelector(RWARegistry.AssetAlreadyRegistered.selector, token));
        _register();
    }

    function test_getUnregisteredReverts() public {
        vm.expectRevert(abi.encodeWithSelector(RWARegistry.AssetNotRegistered.selector, token));
        registry.getAsset(token);
    }

    function test_updaterCanSetNav() public {
        _register();
        vm.warp(1_000);
        vm.prank(updater);
        registry.setNav(token, 1.05e18);
        IRWARegistry.Asset memory a = registry.getAsset(token);
        assertEq(a.navPerToken, 1.05e18);
        assertEq(a.navUpdatedAt, 1_000);
    }

    function test_setNavZeroReverts() public {
        _register();
        vm.expectRevert(RWARegistry.InvalidNav.selector);
        vm.prank(updater);
        registry.setNav(token, 0);
    }

    function test_adminCannotSetNavWithoutRole() public {
        _register();
        vm.expectRevert();
        vm.prank(admin);
        registry.setNav(token, 1e18);
    }

    function test_horizonDaysUsesSecondsPerDay() public {
        _register();
        // 120 s window / 60 s per day = 2 days
        assertEq(registry.horizonDays(token), 2e18);
        vm.prank(admin);
        registry.setSecondsPerDay(86_400);
        // 120 / 86400 days
        assertEq(registry.horizonDays(token), uint256(120) * 1e18 / 86_400);
    }

    function test_setEligibleAndEnabled() public {
        _register();
        vm.startPrank(admin);
        registry.setEligible(token, false);
        registry.setEnabled(token, false);
        vm.stopPrank();
        IRWARegistry.Asset memory a = registry.getAsset(token);
        assertFalse(a.eligible);
        assertFalse(a.enabled);
    }

    function test_setSecondsPerDayZeroReverts() public {
        vm.expectRevert(RWARegistry.InvalidSecondsPerDay.selector);
        vm.prank(admin);
        registry.setSecondsPerDay(0);
    }

    function test_registerStoresCreditClassAndExposure() public {
        _register();
        IRWARegistry.Asset memory a = registry.getAsset(token);
        assertEq(a.creditBps, 380);
        assertEq(a.maxExposureBps, 4_000);
        assertEq(uint8(a.assetClass), uint8(IRWARegistry.AssetClass.PrivateCredit));
    }

    function test_setCredit() public {
        _register();
        vm.prank(admin);
        registry.setCredit(token, 500);
        assertEq(registry.getAsset(token).creditBps, 500);
    }

    function test_setCreditEmits() public {
        _register();
        vm.expectEmit(true, false, false, true, address(registry));
        emit RWARegistry.CreditSet(token, 500);
        vm.prank(admin);
        registry.setCredit(token, 500);
    }

    function test_setCreditRejectsAbsurdPremium() public {
        _register();
        // A credit premium at or above 100% would make payout zero and is certainly a typo.
        vm.prank(admin);
        vm.expectRevert(RWARegistry.InvalidBps.selector);
        registry.setCredit(token, 10_000);
    }

    function test_setCreditOnlyAdmin() public {
        _register();
        vm.expectRevert();
        registry.setCredit(token, 500);
    }

    function test_setMaxExposure() public {
        _register();
        vm.prank(admin);
        registry.setMaxExposure(token, 2_500);
        assertEq(registry.getAsset(token).maxExposureBps, 2_500);
    }

    function test_setMaxExposureRejectsZeroAndOverfull() public {
        _register();
        vm.startPrank(admin);
        vm.expectRevert(RWARegistry.InvalidBps.selector);
        registry.setMaxExposure(token, 0);
        vm.expectRevert(RWARegistry.InvalidBps.selector);
        registry.setMaxExposure(token, 10_001);
        vm.stopPrank();
    }

    function test_setCreditUnregisteredReverts() public {
        address ghost = makeAddr("ghost");
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(RWARegistry.AssetNotRegistered.selector, ghost));
        registry.setCredit(ghost, 100);
    }
}
