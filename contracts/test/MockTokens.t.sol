// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockRWAToken} from "../src/MockRWAToken.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

contract MockTokensTest is Test {
    MockUSDC usdc;
    MockRWAToken rwa;
    address admin = makeAddr("admin");
    address issuer = makeAddr("issuer");
    address alice = makeAddr("alice");

    function setUp() public {
        usdc = new MockUSDC(admin);
        rwa = new MockRWAToken("Tokenized T-Bill", "rTBILL", admin);
    }

    function test_usdcHasSixDecimals() public view {
        assertEq(usdc.decimals(), 6);
    }

    function test_rwaHasEighteenDecimals() public view {
        assertEq(rwa.decimals(), 18);
    }

    function test_adminCanMintUsdc() public {
        vm.prank(admin);
        usdc.mint(alice, 1_000e6);
        assertEq(usdc.balanceOf(alice), 1_000e6);
    }

    function test_nonMinterCannotMintUsdc() public {
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, usdc.MINTER_ROLE())
        );
        vm.prank(alice);
        usdc.mint(alice, 1);
    }

    function test_issuerRoleCanBurnRwa() public {
        vm.startPrank(admin);
        rwa.mint(issuer, 10e18);
        rwa.grantRole(rwa.ISSUER_ROLE(), issuer);
        vm.stopPrank();

        vm.prank(issuer);
        rwa.burnFrom(issuer, 4e18);
        assertEq(rwa.balanceOf(issuer), 6e18);
    }

    function test_nonIssuerCannotBurnRwa() public {
        vm.prank(admin);
        rwa.mint(alice, 10e18);
        vm.expectRevert(
            abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, alice, rwa.ISSUER_ROLE())
        );
        vm.prank(alice);
        rwa.burnFrom(alice, 1e18);
    }
}
