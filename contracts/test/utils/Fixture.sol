// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../../src/MockUSDC.sol";
import {MockRWAToken} from "../../src/MockRWAToken.sol";
import {RWARegistry} from "../../src/RWARegistry.sol";
import {LiquidityVault} from "../../src/LiquidityVault.sol";
import {MockIssuer} from "../../src/MockIssuer.sol";
import {RedemptionBridge} from "../../src/RedemptionBridge.sol";
import {IIssuer} from "../../src/interfaces/IIssuer.sol";
import {IRWARegistry} from "../../src/interfaces/IRWARegistry.sol";
import {Pricing} from "../../src/lib/Pricing.sol";

/// @notice Deploys the full system with the spec's demo parameters.
abstract contract Fixture is Test {
    MockUSDC usdc;
    MockRWAToken tbill;
    MockRWAToken tsla;
    MockRWAToken priv;
    RWARegistry registry;
    LiquidityVault vault;
    MockIssuer issuer;
    RedemptionBridge bridge;

    address admin = makeAddr("admin");
    address treasury = makeAddr("treasury");
    address lp = makeAddr("lp");
    address holder = makeAddr("holder");
    address keeper = makeAddr("keeper");

    uint32 constant SECONDS_PER_DAY = 60;
    uint32 constant WINDOW = 120;

    function setUp() public virtual {
        vm.warp(1_700_000_000);
        usdc = new MockUSDC(admin);
        tbill = new MockRWAToken("Tokenized T-Bill", "rTBILL", admin);
        tsla = new MockRWAToken("Tokenized TSLA", "rTSLA", admin);
        priv = new MockRWAToken("Tokenized Private Credit", "rPRIV", admin);
        registry = new RWARegistry(admin, SECONDS_PER_DAY);
        vault = new LiquidityVault(IERC20(address(usdc)), admin, 9_500);
        issuer = new MockIssuer(registry, IERC20(address(usdc)), admin);
        bridge = new RedemptionBridge(
            registry,
            vault,
            IERC20(address(usdc)),
            IIssuer(address(issuer)),
            treasury,
            admin,
            2_500,
            Pricing.Curve({kinkBps: 8_000, slope1Bps: 20, slope2Bps: 200}),
            SECONDS_PER_DAY
        );

        vm.startPrank(admin);
        issuer.setBridge(address(bridge));
        vault.grantRole(vault.BRIDGE_ROLE(), address(bridge));
        registry.grantRole(registry.NAV_UPDATER_ROLE(), admin);
        tbill.grantRole(tbill.ISSUER_ROLE(), address(issuer));
        tsla.grantRole(tsla.ISSUER_ROLE(), address(issuer));
        priv.grantRole(priv.ISSUER_ROLE(), address(issuer));
        registry.registerAsset(
            address(tbill), address(issuer), 1.04e18, WINDOW, 3, 1, 0, 10_000, IRWARegistry.AssetClass.Treasury, true
        );
        registry.registerAsset(
            address(tsla), address(issuer), 248.5e18, WINDOW, 15, 180, 0, 10_000, IRWARegistry.AssetClass.Equity, true
        );
        registry.registerAsset(
            address(priv), address(issuer), 1e18, 600, 50, 30, 0, 10_000, IRWARegistry.AssetClass.PrivateCredit, false
        );

        usdc.mint(lp, 1_000_000e6);
        usdc.mint(admin, 500_000e6);
        usdc.approve(address(issuer), type(uint256).max);
        issuer.fund(500_000e6);
        tbill.mint(holder, 10_000e18);
        tsla.mint(holder, 10_000e18);
        priv.mint(holder, 10_000e18);
        vm.stopPrank();

        vm.startPrank(lp);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(100_000e6, lp);
        vm.stopPrank();

        vm.startPrank(holder);
        tbill.approve(address(bridge), type(uint256).max);
        tsla.approve(address(bridge), type(uint256).max);
        priv.approve(address(bridge), type(uint256).max);
        vm.stopPrank();
    }
}
