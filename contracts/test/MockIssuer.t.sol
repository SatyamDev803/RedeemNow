// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockRWAToken} from "../src/MockRWAToken.sol";
import {RWARegistry} from "../src/RWARegistry.sol";
import {MockIssuer} from "../src/MockIssuer.sol";
import {IRWARegistry} from "../src/interfaces/IRWARegistry.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract MockIssuerTest is Test {
    MockUSDC usdc;
    MockRWAToken rwa;
    RWARegistry registry;
    MockIssuer issuer;
    address admin = makeAddr("admin");
    address bridge = makeAddr("bridge");
    address funder = makeAddr("funder");

    function setUp() public {
        usdc = new MockUSDC(admin);
        rwa = new MockRWAToken("Tokenized T-Bill", "rTBILL", admin);
        registry = new RWARegistry(admin, 60);
        issuer = new MockIssuer(registry, IERC20(address(usdc)), admin);
        vm.startPrank(admin);
        issuer.setBridge(bridge);
        rwa.grantRole(rwa.ISSUER_ROLE(), address(issuer));
        registry.registerAsset(
            address(rwa), address(issuer), 1.04e18, 120, 3, 1, 0, 10_000, IRWARegistry.AssetClass.Treasury, true
        );
        usdc.mint(funder, 1_000_000e6);
        rwa.mint(address(issuer), 1_000e18); // simulate bridge having pushed tokens in
        vm.stopPrank();
        vm.prank(funder);
        usdc.approve(address(issuer), type(uint256).max);
    }

    function test_setBridgeOnlyOnce() public {
        vm.expectRevert(MockIssuer.BridgeAlreadySet.selector);
        vm.prank(admin);
        issuer.setBridge(makeAddr("other"));
    }

    function test_onlyBridgeCanRequest() public {
        vm.expectRevert(MockIssuer.OnlyBridge.selector);
        issuer.requestRedemption(1, address(rwa), 1e18);
    }

    function test_settlePaysCurrentNavAndBurns() public {
        vm.prank(funder);
        issuer.fund(10_000e6);
        vm.prank(bridge);
        issuer.requestRedemption(1, address(rwa), 1_000e18);
        // NAV moved up before settlement
        // NOTE: hoist the role out of the pranked call. `registry.NAV_UPDATER_ROLE()` is an
        // external staticcall and would otherwise consume the vm.prank, so grantRole would
        // execute as the test contract (which lacks DEFAULT_ADMIN_ROLE) and revert.
        bytes32 navRole = registry.NAV_UPDATER_ROLE();
        vm.prank(admin);
        registry.grantRole(navRole, admin);
        vm.prank(admin);
        registry.setNav(address(rwa), 1.05e18);

        vm.prank(bridge);
        uint256 proceeds = issuer.settle(1);
        assertEq(proceeds, 1_050e6);
        assertEq(usdc.balanceOf(bridge), 1_050e6);
        assertEq(rwa.balanceOf(address(issuer)), 0);
        assertTrue(issuer.getRequest(1).settled);
    }

    function test_settleTwiceReverts() public {
        vm.prank(funder);
        issuer.fund(10_000e6);
        vm.startPrank(bridge);
        issuer.requestRedemption(1, address(rwa), 1_000e18);
        issuer.settle(1);
        vm.expectRevert(abi.encodeWithSelector(MockIssuer.AlreadySettled.selector, 1));
        issuer.settle(1);
        vm.stopPrank();
    }

    function test_settleUnknownReverts() public {
        vm.expectRevert(abi.encodeWithSelector(MockIssuer.UnknownRequest.selector, 42));
        vm.prank(bridge);
        issuer.settle(42);
    }

    function test_underfundedRevertsWithAmounts() public {
        vm.prank(funder);
        issuer.fund(100e6);
        vm.prank(bridge);
        issuer.requestRedemption(1, address(rwa), 1_000e18);
        vm.expectRevert(abi.encodeWithSelector(MockIssuer.InsufficientIssuerFunds.selector, 1_040e6, 100e6));
        vm.prank(bridge);
        issuer.settle(1);
    }
}
