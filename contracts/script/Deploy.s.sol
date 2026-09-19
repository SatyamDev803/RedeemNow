// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockRWAToken} from "../src/MockRWAToken.sol";
import {RWARegistry} from "../src/RWARegistry.sol";
import {LiquidityVault} from "../src/LiquidityVault.sol";
import {MockIssuer} from "../src/MockIssuer.sol";
import {RedemptionBridge} from "../src/RedemptionBridge.sol";
import {IIssuer} from "../src/interfaces/IIssuer.sol";
import {IRWARegistry} from "../src/interfaces/IRWARegistry.sol";
import {Pricing} from "../src/lib/Pricing.sol";

/// @notice Deploys, wires, seeds, and writes deployments/<chainId>.json.
/// Usage: forge script script/Deploy.s.sol --rpc-url <anvil|monad_testnet> --broadcast
///
/// Asset mix leads with private credit (Design Ruling 5): rCREDIT is the headline leg, Treasuries
/// are the tight-spread contrast. `creditBps` calibration (Dune x RWA.xyz 2025 unless noted):
///   - rCREDIT 380 bps <- Maple's $47M defaulted against $1.23B active loans = 3.8% realised default.
///   - rJAAA     15 bps <- AAA-rated CLO tranche; JAAA is $756M with a 0.40% management fee.
///   - rTBILL     2 bps <- sovereign; JTRSY is rated AA+.
///   - rTSLA     25 bps <- broker-dealer settlement risk, not issuer credit.
///   - rPRIV    500 bps <- unrated, and ineligible regardless.
/// `maxExposureBps` falls as credit risk rises (Design Ruling 2): the cap constrains how much
/// exposure the vault takes per asset, not just what it charges. rCREDIT's 800 bps (8%) is sized so
/// the cap actually binds within the 10,000-token mintable supply (~10,850 USDC notional): at 8,000
/// USDC against a 100,000 USDC vault deposit, the cap trips at ~7,700 tokens redeemed, which is
/// inside the demo's reach. A higher cap (e.g. 4,000 bps / 40,000 USDC) could never trigger against
/// that supply, and 8% is also the more defensible number — you would not put 40% of a vault into a
/// single private-credit issuer carrying a 3.8% realised default rate.
///
/// @dev Split into helpers, each operating on the `Deployed` struct in storage/memory, so `run()`
///      itself doesn't accumulate enough locals to hit "stack too deep" on plain `forge build`
///      (no `via_ir` — see foundry.toml).
contract Deploy is Script {
    uint32 constant SECONDS_PER_DAY = 60;
    uint32 constant IMPAIR_AFTER = 60;

    /// @dev The treasury must NOT be the deployer. The dashboard shows accrued protocol fees as
    ///      `usdc.balanceOf(treasury)`, which is only true if that address holds fees and nothing
    ///      else. With treasury == deployer it was reporting the deployer's entire mint balance —
    ///      979,881 USDC next to a 97,929 USDC vault. Anvil account #1 is the default here because
    ///      it is a real, funded, distinct local account; set TREASURY explicitly for any deploy
    ///      to a public chain.
    address constant DEFAULT_TREASURY = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    struct Tokens {
        MockRWAToken tbill;
        MockRWAToken jaaa;
        MockRWAToken credit;
        MockRWAToken tsla;
        MockRWAToken priv;
    }

    struct Core {
        MockUSDC usdc;
        RWARegistry registry;
        LiquidityVault vault;
        MockIssuer issuer;
        RedemptionBridge bridge;
    }

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("TREASURY", DEFAULT_TREASURY);

        vm.startBroadcast(pk);

        Tokens memory t = _deployTokens(deployer);
        Core memory c = _deployCore(deployer, treasury, t);
        _wire(c, t, deployer);
        _registerAssets(c, t);
        _seed(c, t, deployer);

        vm.stopBroadcast();

        _writeJson(c, t, deployer, treasury);
    }

    function _deployTokens(address deployer) internal returns (Tokens memory t) {
        t.tbill = new MockRWAToken("Tokenized T-Bill Fund", "rTBILL", deployer);
        t.jaaa = new MockRWAToken("Tokenized AAA CLO", "rJAAA", deployer);
        t.credit = new MockRWAToken("Tokenized Private Credit Pool", "rCREDIT", deployer);
        t.tsla = new MockRWAToken("Tokenized TSLA", "rTSLA", deployer);
        t.priv = new MockRWAToken("Tokenized Private Credit", "rPRIV", deployer);
    }

    function _deployCore(address deployer, address treasury, Tokens memory) internal returns (Core memory c) {
        c.usdc = new MockUSDC(deployer);
        c.registry = new RWARegistry(deployer, SECONDS_PER_DAY);
        c.vault = new LiquidityVault(IERC20(address(c.usdc)), deployer, 9_500);
        c.issuer = new MockIssuer(c.registry, IERC20(address(c.usdc)), deployer);
        c.bridge = new RedemptionBridge(
            c.registry,
            c.vault,
            IERC20(address(c.usdc)),
            IIssuer(address(c.issuer)),
            treasury,
            deployer,
            2_500,
            Pricing.Curve({kinkBps: 8_000, slope1Bps: 20, slope2Bps: 200}),
            IMPAIR_AFTER
        );
    }

    function _wire(Core memory c, Tokens memory t, address deployer) internal {
        c.issuer.setBridge(address(c.bridge));
        c.vault.grantRole(c.vault.BRIDGE_ROLE(), address(c.bridge));
        c.registry.grantRole(c.registry.NAV_UPDATER_ROLE(), deployer);
        c.bridge.grantRole(c.bridge.DEMO_ADMIN_ROLE(), deployer);
        // RISK_ADMIN_ROLE is already granted to `deployer` (the constructor's `admin`) — no-op here.
        t.tbill.grantRole(t.tbill.ISSUER_ROLE(), address(c.issuer));
        t.jaaa.grantRole(t.jaaa.ISSUER_ROLE(), address(c.issuer));
        t.credit.grantRole(t.credit.ISSUER_ROLE(), address(c.issuer));
        t.tsla.grantRole(t.tsla.ISSUER_ROLE(), address(c.issuer));
        t.priv.grantRole(t.priv.ISSUER_ROLE(), address(c.issuer));
    }

    /// @dev token, issuer, navPerToken, settlementWindow, baseSpreadBps, dailyVolBps,
    ///      creditBps, maxExposureBps, assetClass, eligible
    function _registerAssets(Core memory c, Tokens memory t) internal {
        c.registry.registerAsset(
            address(t.tbill),
            address(c.issuer),
            1.0432e18,
            120,
            3,
            1,
            2,
            10_000,
            IRWARegistry.AssetClass.Treasury,
            true
        );
        c.registry.registerAsset(
            address(t.jaaa),
            address(c.issuer),
            1.0e18,
            120,
            5,
            8,
            15,
            5_000,
            IRWARegistry.AssetClass.InstitutionalFund,
            true
        );
        c.registry.registerAsset(
            address(t.credit),
            address(c.issuer),
            1.085e18,
            600,
            15,
            25,
            380,
            800,
            IRWARegistry.AssetClass.PrivateCredit,
            true
        );
        c.registry.registerAsset(
            address(t.tsla),
            address(c.issuer),
            248.5e18,
            120,
            15,
            180,
            25,
            8_000,
            IRWARegistry.AssetClass.Equity,
            true
        );
        c.registry.registerAsset(
            address(t.priv),
            address(c.issuer),
            1.0e18,
            1_800,
            50,
            30,
            500,
            500,
            IRWARegistry.AssetClass.PrivateCredit,
            false
        );
    }

    function _seed(Core memory c, Tokens memory t, address deployer) internal {
        c.usdc.mint(deployer, 1_500_000e6);
        c.usdc.approve(address(c.issuer), 500_000e6);
        c.issuer.fund(500_000e6);
        t.tbill.mint(deployer, 10_000e18);
        t.jaaa.mint(deployer, 10_000e18);
        t.credit.mint(deployer, 10_000e18);
        t.tsla.mint(deployer, 10_000e18);
        t.priv.mint(deployer, 10_000e18);
    }

    function _writeJson(Core memory c, Tokens memory t, address deployer, address treasury) internal {
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "deployer", deployer);
        vm.serializeAddress(obj, "treasury", treasury);
        vm.serializeAddress(obj, "usdc", address(c.usdc));
        vm.serializeAddress(obj, "rTBILL", address(t.tbill));
        vm.serializeAddress(obj, "rJAAA", address(t.jaaa));
        vm.serializeAddress(obj, "rCREDIT", address(t.credit));
        vm.serializeAddress(obj, "rTSLA", address(t.tsla));
        vm.serializeAddress(obj, "rPRIV", address(t.priv));
        vm.serializeAddress(obj, "registry", address(c.registry));
        vm.serializeAddress(obj, "vault", address(c.vault));
        vm.serializeAddress(obj, "issuer", address(c.issuer));
        string memory json = vm.serializeAddress(obj, "bridge", address(c.bridge));
        vm.createDir("deployments", true);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }
}
