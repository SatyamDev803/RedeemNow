# RedeemNow Contracts Implementation Plan (Plan 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the RedeemNow protocol core (registry, vault, bridge, mock issuer, mock tokens) as a tested Foundry project, deployed to Monad testnet with a machine-readable addresses file that the keeper (Plan 2) and dashboard (Plan 3) consume.

**Architecture:** Six Solidity contracts plus one pure pricing library. `RedemptionBridge` is the only contract that moves funds between the others: it pulls an RWA token from the holder, pushes it to `MockIssuer`, has `LiquidityVault` advance USDC to the holder, and later collects issuer proceeds and returns them to the vault with a protocol fee skimmed. `RWARegistry` is read-only config plus a NAV feed. Every settable parameter has an event; every failure is a custom error.

**Tech Stack:** Foundry (forge, anvil, cast) stable release; Solidity `0.8.28`, `evm_version = "cancun"`; OpenZeppelin Contracts v5; forge-std. pnpm workspace root created here so Plans 2 and 3 slot in.

**Spec:** `docs/superpowers/specs/2026-09-18-redeemnow-design.md`

## Global Constraints

- Solidity `pragma solidity 0.8.28;` in every file; `evm_version = "cancun"` (Monad supports opcodes through Cancun).
- OpenZeppelin v5 only (`lib/openzeppelin-contracts`, tag `v5.x`); remapping `@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/`.
- USDC is 6 decimals; RWA tokens and NAV are 18 decimals; bps denominator is `10_000`.
- Monad testnet: chain ID `10143`, RPC `https://testnet-rpc.monad.xyz`, currency `MON`, faucet `https://faucet.monad.xyz`, explorer `https://testnet.monadvision.com`.
- Local dev chain: Anvil, chain ID `31337`.
- Demo parameters (from spec §8): `secondsPerDay = 60`; rTBILL window `120`, base `3`, vol `1`; rTSLA window `120`, base `15`, vol `180`; rPRIV window `600`, base `50`, vol `30`, `eligible = false`; curve `kink 8000 / slope1 20 / slope2 200`; `protocolFeeBps 2500`; `maxUtilisationBps 9500`; max spread `5000`.
- Test discipline (owner's global rule): run one test file at a time with `forge test --match-path`, never a bare `forge test` unless the user asks.
- Never commit `.env`; keys come from `.env` or a Foundry keystore.
- Commit after every task with the trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

---

## File Structure

```
Monad-Metropolis/                       (repo root, already git-initialised)
  package.json                          workspace root, scripts only
  pnpm-workspace.yaml                   packages: contracts, keeper, web, packages/*
  .gitignore                            (exists) + lib/ handled as submodules
  contracts/
    foundry.toml
    .env.example
    remappings.txt
    src/
      interfaces/IRWARegistry.sol       Asset struct + registry read/write surface
      interfaces/IIssuer.sol            requestRedemption / settle
      lib/Pricing.sol                   pure spread + payout math
      MockUSDC.sol                      6-dec ERC20, MINTER_ROLE
      MockRWAToken.sol                  18-dec ERC20, MINTER_ROLE, ISSUER_ROLE burn
      RWARegistry.sol                   asset config + NAV feed
      LiquidityVault.sol                ERC-4626 with idle/outstanding accounting
      MockIssuer.sol                    holds redeemed tokens, pays NAV on settle
      RedemptionBridge.sol              product contract
    test/
      MockTokens.t.sol
      RWARegistry.t.sol
      Pricing.t.sol
      LiquidityVault.t.sol
      MockIssuer.t.sol
      RedemptionBridge.t.sol
      utils/Fixture.sol                 full-system deployment helper for tests
    script/
      Deploy.s.sol                      deploy + wire + seed + write deployments JSON
      PricingFixtures.s.sol             emit JSON fixtures for the TS pricing mirror (Plan 2)
    deployments/                        <chainId>.json written by Deploy.s.sol (committed)
    fixtures/                           pricing.json written by PricingFixtures.s.sol (committed)
```

Responsibility boundaries: the bridge never touches ERC-4626 share logic; the vault never knows what a receivable is beyond `advanced`/`proceeds`; the issuer never prices anything; the registry never moves tokens.

---

### Task 0: Toolchain and workspace scaffold

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `contracts/foundry.toml`, `contracts/remappings.txt`, `contracts/.env.example`
- Modify: `.gitignore`

**Interfaces:**
- Produces: a `contracts/` Foundry project where `forge build` and `forge test` run with OpenZeppelin v5 available at `@openzeppelin/contracts/`.

- [ ] **Step 1: Install Foundry and pnpm**

```bash
curl -L https://foundry.paradigm.xyz | bash
# open a new shell or: source ~/.zshenv
foundryup
forge --version        # expect: forge 1.x
corepack enable
corepack prepare pnpm@latest --activate
pnpm --version         # expect: 10.x
```

- [ ] **Step 2: Create workspace root files**

`package.json`:
```json
{
  "name": "redeemnow",
  "private": true,
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "build:contracts": "pnpm --filter contracts build",
    "test:contracts": "pnpm --filter contracts test"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - contracts
  - keeper
  - web
  - packages/*
```

Append to `.gitignore`:
```
contracts/lib/
contracts/.env
```

- [ ] **Step 3: Initialise the Foundry project**

```bash
cd contracts 2>/dev/null || (mkdir contracts && cd contracts)
forge init --no-git --no-commit .
rm -f src/Counter.sol test/Counter.t.sol script/Counter.s.sol
forge install OpenZeppelin/openzeppelin-contracts --no-git
```

Because the repo root is the git repo and `contracts/lib/` is git-ignored, OpenZeppelin is a plain download, not a submodule. Anyone cloning re-runs `forge install`.

- [ ] **Step 4: Write foundry.toml, remappings, .env.example, package.json**

`contracts/foundry.toml`:
```toml
[profile.default]
src = "src"
out = "out"
libs = ["lib"]
test = "test"
script = "script"
solc_version = "0.8.28"
evm_version = "cancun"
optimizer = true
optimizer_runs = 200
via_ir = false
fs_permissions = [
  { access = "read-write", path = "./deployments" },
  { access = "read-write", path = "./fixtures" }
]

[fuzz]
runs = 256

[rpc_endpoints]
anvil = "http://127.0.0.1:8545"
monad_testnet = "https://testnet-rpc.monad.xyz"

[fmt]
line_length = 110
```

`contracts/remappings.txt`:
```
@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/
forge-std/=lib/forge-std/src/
```

`contracts/.env.example`:
```
# Deployer key for Anvil (well-known Anvil account 0, safe to publish)
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
# For Monad testnet, replace with a fresh key funded from https://faucet.monad.xyz
```

`contracts/package.json`:
```json
{
  "name": "contracts",
  "private": true,
  "scripts": {
    "build": "forge build",
    "test": "echo 'Run a single file: forge test --match-path test/<File>.t.sol' && exit 1",
    "anvil": "anvil --chain-id 31337 --block-time 1"
  }
}
```

- [ ] **Step 5: Verify the toolchain builds an empty project**

Run: `cd contracts && forge build`
Expected: `Compiler run successful` (no sources yet beyond forge-std is fine).

- [ ] **Step 6: Commit**

```bash
cd ..
git config user.name "Satyam Sharma"
git config user.email "sharmasatyam1603@gmail.com"
git add package.json pnpm-workspace.yaml .gitignore contracts/foundry.toml contracts/remappings.txt contracts/.env.example contracts/package.json contracts/README.md
git commit -m "chore: scaffold pnpm workspace and Foundry project

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 1: Mock tokens (MockUSDC, MockRWAToken)

**Files:**
- Create: `contracts/src/MockUSDC.sol`, `contracts/src/MockRWAToken.sol`
- Test: `contracts/test/MockTokens.t.sol`

**Interfaces:**
- Produces:
  - `MockUSDC(address admin)`; `decimals() == 6`; `mint(address to, uint256 amount)` guarded by `MINTER_ROLE`.
  - `MockRWAToken(string name, string symbol, address admin)`; `decimals() == 18`; `mint(address,uint256)` guarded by `MINTER_ROLE`; `burnFrom(address from, uint256 amount)` guarded by `ISSUER_ROLE`.
  - Both expose `MINTER_ROLE()`; RWA token exposes `ISSUER_ROLE()`; admin holds `DEFAULT_ADMIN_ROLE` and `MINTER_ROLE`.

- [ ] **Step 1: Write the failing tests**

`contracts/test/MockTokens.t.sol`:
```solidity
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd contracts && forge test --match-path test/MockTokens.t.sol -vv`
Expected: compilation error, `MockUSDC.sol` not found.

- [ ] **Step 3: Implement the tokens**

`contracts/src/MockUSDC.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Six-decimal stablecoin stand-in for the demo. Not for production.
contract MockUSDC is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    constructor(address admin) ERC20("Mock USD Coin", "USDC") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }
}
```

`contracts/src/MockRWAToken.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @notice Eighteen-decimal tokenized RWA stand-in. The issuer burns on redemption settlement.
contract MockRWAToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant ISSUER_ROLE = keccak256("ISSUER_ROLE");

    constructor(string memory name_, string memory symbol_, address admin) ERC20(name_, symbol_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, admin);
    }

    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) {
        _mint(to, amount);
    }

    /// @dev The issuer burns tokens it already holds after paying NAV.
    function burnFrom(address from, uint256 amount) external onlyRole(ISSUER_ROLE) {
        _burn(from, amount);
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `forge test --match-path test/MockTokens.t.sol -vv`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/MockUSDC.sol contracts/src/MockRWAToken.sol contracts/test/MockTokens.t.sol
git commit -m "feat(contracts): mock USDC and RWA tokens

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: RWARegistry

**Files:**
- Create: `contracts/src/interfaces/IRWARegistry.sol`, `contracts/src/RWARegistry.sol`
- Test: `contracts/test/RWARegistry.t.sol`

**Interfaces:**
- Produces `IRWARegistry`:
  ```solidity
  struct Asset { address token; address issuer; uint256 navPerToken; uint64 navUpdatedAt; uint32 settlementWindow; uint16 baseSpreadBps; uint16 dailyVolBps; bool eligible; bool enabled; }
  function getAsset(address token) external view returns (Asset memory);   // reverts AssetNotRegistered
  function isRegistered(address token) external view returns (bool);
  function horizonDays(address token) external view returns (uint256);     // 1e18 fixed point
  function secondsPerDay() external view returns (uint32);
  function tokenCount() external view returns (uint256);
  function tokens(uint256 i) external view returns (address);
  ```
- Roles: `DEFAULT_ADMIN_ROLE` (register, setEligible, setEnabled, setSettlementWindow, setSecondsPerDay), `NAV_UPDATER_ROLE` (setNav).

- [ ] **Step 1: Write the failing tests**

`contracts/test/RWARegistry.t.sol`:
```solidity
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
        vm.prank(admin);
        registry.grantRole(registry.NAV_UPDATER_ROLE(), updater);
    }

    function _register() internal {
        vm.prank(admin);
        registry.registerAsset(token, issuer, 1.04e18, 120, 3, 1, true);
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
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `forge test --match-path test/RWARegistry.t.sol -vv`
Expected: compilation error, `RWARegistry.sol` not found.

- [ ] **Step 3: Implement interface and registry**

`contracts/src/interfaces/IRWARegistry.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IRWARegistry {
    struct Asset {
        address token;
        address issuer;
        uint256 navPerToken; // USD per token, 1e18
        uint64 navUpdatedAt;
        uint32 settlementWindow; // seconds
        uint16 baseSpreadBps;
        uint16 dailyVolBps; // one-day NAV volatility, bps
        bool eligible; // bridge entity is an eligible redeemer with this issuer
        bool enabled;
    }

    function getAsset(address token) external view returns (Asset memory);
    function isRegistered(address token) external view returns (bool);
    function horizonDays(address token) external view returns (uint256);
    function secondsPerDay() external view returns (uint32);
    function tokenCount() external view returns (uint256);
    function tokens(uint256 index) external view returns (address);
}
```

`contracts/src/RWARegistry.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IRWARegistry} from "./interfaces/IRWARegistry.sol";

/// @notice Per-asset configuration and NAV feed for redeemable RWA tokens.
contract RWARegistry is IRWARegistry, AccessControl {
    bytes32 public constant NAV_UPDATER_ROLE = keccak256("NAV_UPDATER_ROLE");

    /// @dev 86_400 in production; 60 in the demo so a 120 s window prices as a 2-day horizon.
    uint32 public secondsPerDay;

    address[] public tokens;
    mapping(address => Asset) private _assets;

    error AssetNotRegistered(address token);
    error AssetAlreadyRegistered(address token);
    error InvalidNav();
    error InvalidWindow();
    error InvalidSecondsPerDay();
    error ZeroAddress();

    event AssetRegistered(
        address indexed token,
        address indexed issuer,
        uint256 navPerToken,
        uint32 settlementWindow,
        uint16 baseSpreadBps,
        uint16 dailyVolBps,
        bool eligible
    );
    event NavUpdated(address indexed token, uint256 navPerToken, uint64 timestamp);
    event EligibilitySet(address indexed token, bool eligible);
    event EnabledSet(address indexed token, bool enabled);
    event SettlementWindowSet(address indexed token, uint32 settlementWindow);
    event SecondsPerDaySet(uint32 secondsPerDay);

    constructor(address admin, uint32 secondsPerDay_) {
        if (admin == address(0)) revert ZeroAddress();
        if (secondsPerDay_ == 0) revert InvalidSecondsPerDay();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        secondsPerDay = secondsPerDay_;
        emit SecondsPerDaySet(secondsPerDay_);
    }

    // ---------- admin ----------

    function registerAsset(
        address token,
        address issuer,
        uint256 navPerToken,
        uint32 settlementWindow,
        uint16 baseSpreadBps,
        uint16 dailyVolBps,
        bool eligible
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (token == address(0) || issuer == address(0)) revert ZeroAddress();
        if (_assets[token].token != address(0)) revert AssetAlreadyRegistered(token);
        if (navPerToken == 0) revert InvalidNav();
        if (settlementWindow == 0) revert InvalidWindow();

        _assets[token] = Asset({
            token: token,
            issuer: issuer,
            navPerToken: navPerToken,
            navUpdatedAt: uint64(block.timestamp),
            settlementWindow: settlementWindow,
            baseSpreadBps: baseSpreadBps,
            dailyVolBps: dailyVolBps,
            eligible: eligible,
            enabled: true
        });
        tokens.push(token);
        emit AssetRegistered(token, issuer, navPerToken, settlementWindow, baseSpreadBps, dailyVolBps, eligible);
    }

    function setEligible(address token, bool eligible) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireRegistered(token);
        _assets[token].eligible = eligible;
        emit EligibilitySet(token, eligible);
    }

    function setEnabled(address token, bool enabled) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireRegistered(token);
        _assets[token].enabled = enabled;
        emit EnabledSet(token, enabled);
    }

    function setSettlementWindow(address token, uint32 settlementWindow) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _requireRegistered(token);
        if (settlementWindow == 0) revert InvalidWindow();
        _assets[token].settlementWindow = settlementWindow;
        emit SettlementWindowSet(token, settlementWindow);
    }

    function setSecondsPerDay(uint32 secondsPerDay_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (secondsPerDay_ == 0) revert InvalidSecondsPerDay();
        secondsPerDay = secondsPerDay_;
        emit SecondsPerDaySet(secondsPerDay_);
    }

    // ---------- NAV feed ----------

    function setNav(address token, uint256 navPerToken) external onlyRole(NAV_UPDATER_ROLE) {
        _requireRegistered(token);
        if (navPerToken == 0) revert InvalidNav();
        Asset storage a = _assets[token];
        a.navPerToken = navPerToken;
        a.navUpdatedAt = uint64(block.timestamp);
        emit NavUpdated(token, navPerToken, uint64(block.timestamp));
    }

    // ---------- views ----------

    function getAsset(address token) external view returns (Asset memory) {
        _requireRegistered(token);
        return _assets[token];
    }

    function isRegistered(address token) public view returns (bool) {
        return _assets[token].token != address(0);
    }

    /// @return days in 1e18 fixed point: settlementWindow / secondsPerDay
    function horizonDays(address token) external view returns (uint256) {
        _requireRegistered(token);
        return uint256(_assets[token].settlementWindow) * 1e18 / secondsPerDay;
    }

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function _requireRegistered(address token) internal view {
        if (!isRegistered(token)) revert AssetNotRegistered(token);
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `forge test --match-path test/RWARegistry.t.sol -vv`
Expected: 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/interfaces/IRWARegistry.sol contracts/src/RWARegistry.sol contracts/test/RWARegistry.t.sol
git commit -m "feat(contracts): RWA registry with NAV feed and demo clock

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Pricing library

**Files:**
- Create: `contracts/src/lib/Pricing.sol`
- Test: `contracts/test/Pricing.t.sol`

**Interfaces:**
- Produces `library Pricing` (all `internal pure`):
  ```solidity
  uint256 constant BPS = 10_000; uint256 constant WAD = 1e18; uint256 constant USDC_SCALE = 1e12;
  struct Curve { uint16 kinkBps; uint16 slope1Bps; uint16 slope2Bps; }
  function utilisationTermBps(uint256 uBps, Curve memory c) returns (uint256);
  function timeRiskBps(uint256 dailyVolBps, uint256 horizonDaysWad) returns (uint256);
  function navValueWad(uint256 amount, uint256 navPerToken) returns (uint256);
  function wadToUsdc(uint256 wad) returns (uint256);
  function projectedUtilisationBps(uint256 idle, uint256 outstanding, uint256 proposedUsdc) returns (uint256);
  function payoutUsdc(uint256 navValueWad_, uint256 spreadBps) returns (uint256);
  ```

- [ ] **Step 1: Write the failing tests**

`contracts/test/Pricing.t.sol`:
```solidity
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
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `forge test --match-path test/Pricing.t.sol -vv`
Expected: compilation error, `Pricing.sol` not found.

- [ ] **Step 3: Implement the library**

`contracts/src/lib/Pricing.sol`:
```solidity
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `forge test --match-path test/Pricing.t.sol -vv`
Expected: 11 tests pass (fuzz tests report 256 runs each).

- [ ] **Step 5: Commit**

```bash
git add contracts/src/lib/Pricing.sol contracts/test/Pricing.t.sol
git commit -m "feat(contracts): pricing library with kinked utilisation curve and sqrt time risk

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: LiquidityVault (ERC-4626)

**Files:**
- Create: `contracts/src/LiquidityVault.sol`
- Test: `contracts/test/LiquidityVault.t.sol`

**Interfaces:**
- Consumes: `MockUSDC` (Task 1).
- Produces:
  ```solidity
  contract LiquidityVault is ERC4626, AccessControl, Pausable, ReentrancyGuard
  constructor(IERC20 usdc, address admin, uint16 maxUtilisationBps_)
  bytes32 BRIDGE_ROLE; bytes32 PAUSER_ROLE;
  uint256 idle(); uint256 outstanding(); uint16 maxUtilisationBps();
  function utilisationBps() view returns (uint256);
  function advance(address to, uint256 amount) external;                       // BRIDGE_ROLE
  function settleReceivable(uint256 advanced, uint256 proceeds) external;      // BRIDGE_ROLE; pulls `proceeds` USDC from msg.sender
  function setMaxUtilisation(uint16 bps) external;                             // admin
  function pause()/unpause();                                                  // PAUSER_ROLE
  ```
  Standard ERC-4626 `deposit/mint/withdraw/redeem` work; withdrawals limited to `idle`.

- [ ] **Step 1: Write the failing tests**

`contracts/test/LiquidityVault.t.sol`:
```solidity
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
        assertEq(vault.convertToAssets(100_000e6), 100_100e6);
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
}
```

- [ ] **Step 2: Run to verify it fails**

Run: `forge test --match-path test/LiquidityVault.t.sol -vv`
Expected: compilation error, `LiquidityVault.sol` not found.

- [ ] **Step 3: Implement the vault**

`contracts/src/LiquidityVault.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice ERC-4626 USDC vault that funds redemption advances.
/// @dev totalAssets = idle + outstanding. Only tracked balances count, so donations cannot
///      inflate share price and the classic first-depositor attack has no lever.
contract LiquidityVault is ERC4626, AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant BRIDGE_ROLE = keccak256("BRIDGE_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 private constant BPS = 10_000;

    /// @notice USDC held and available for withdrawals or advances.
    uint256 public idle;
    /// @notice USDC advanced to holders and not yet settled, at face value.
    uint256 public outstanding;
    uint16 public maxUtilisationBps;

    error InsufficientIdle(uint256 requested, uint256 idle);
    error UtilisationTooHigh(uint256 projectedBps, uint256 maxBps);
    error InvalidBps();
    error ZeroAddress();

    event Advanced(address indexed to, uint256 amount, uint256 utilisationBps);
    event ReceivableSettled(uint256 advanced, uint256 proceeds);
    event LossRealised(uint256 advanced, uint256 proceeds, uint256 loss);
    event MaxUtilisationSet(uint16 bps);

    constructor(IERC20 usdc, address admin, uint16 maxUtilisationBps_)
        ERC4626(usdc)
        ERC20("RedeemNow USDC", "rnUSDC")
    {
        if (admin == address(0)) revert ZeroAddress();
        if (maxUtilisationBps_ == 0 || maxUtilisationBps_ > BPS) revert InvalidBps();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        maxUtilisationBps = maxUtilisationBps_;
        emit MaxUtilisationSet(maxUtilisationBps_);
    }

    // ---------- ERC-4626 accounting ----------

    function totalAssets() public view override returns (uint256) {
        return idle + outstanding;
    }

    function utilisationBps() public view returns (uint256) {
        uint256 total = totalAssets();
        if (total == 0) return 0;
        return outstanding * BPS / total;
    }

    function maxWithdraw(address owner) public view override returns (uint256) {
        uint256 byShares = super.maxWithdraw(owner);
        return byShares < idle ? byShares : idle;
    }

    function maxRedeem(address owner) public view override returns (uint256) {
        uint256 byShares = super.maxRedeem(owner);
        uint256 byIdle = _convertToShares(idle, Math.Rounding.Floor);
        return byShares < byIdle ? byShares : byIdle;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
        nonReentrant
    {
        super._deposit(caller, receiver, assets, shares);
        idle += assets;
    }

    function _withdraw(address caller, address receiver, address owner, uint256 assets, uint256 shares)
        internal
        override
        whenNotPaused
        nonReentrant
    {
        if (assets > idle) revert InsufficientIdle(assets, idle);
        idle -= assets;
        super._withdraw(caller, receiver, owner, assets, shares);
    }

    // ---------- bridge surface ----------

    /// @notice Advance `amount` USDC to `to` against a pending redemption.
    function advance(address to, uint256 amount) external onlyRole(BRIDGE_ROLE) whenNotPaused nonReentrant {
        if (amount > idle) revert InsufficientIdle(amount, idle);
        uint256 projected = (outstanding + amount) * BPS / totalAssets();
        if (projected > maxUtilisationBps) revert UtilisationTooHigh(projected, maxUtilisationBps);
        idle -= amount;
        outstanding += amount;
        IERC20(asset()).safeTransfer(to, amount);
        emit Advanced(to, amount, projected);
    }

    /// @notice Close a receivable: pulls `proceeds` USDC from the bridge and retires `advanced`.
    function settleReceivable(uint256 advanced, uint256 proceeds) external onlyRole(BRIDGE_ROLE) nonReentrant {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), proceeds);
        outstanding -= advanced;
        idle += proceeds;
        if (proceeds < advanced) emit LossRealised(advanced, proceeds, advanced - proceeds);
        emit ReceivableSettled(advanced, proceeds);
    }

    // ---------- admin ----------

    function setMaxUtilisation(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps == 0 || bps > BPS) revert InvalidBps();
        maxUtilisationBps = bps;
        emit MaxUtilisationSet(bps);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `forge test --match-path test/LiquidityVault.t.sol -vv`
Expected: 10 tests pass. If `maxWithdraw`/`maxRedeem` override signatures fail to compile, check the installed OpenZeppelin version's `ERC4626.sol`; v5 declares both `public view virtual`.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/LiquidityVault.sol contracts/test/LiquidityVault.t.sol
git commit -m "feat(contracts): ERC-4626 liquidity vault with advance/settle accounting

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: MockIssuer

**Files:**
- Create: `contracts/src/interfaces/IIssuer.sol`, `contracts/src/MockIssuer.sol`
- Test: `contracts/test/MockIssuer.t.sol`

**Interfaces:**
- Consumes: `IRWARegistry.getAsset` (Task 2), `MockRWAToken.burnFrom` (Task 1).
- Produces `IIssuer`:
  ```solidity
  function requestRedemption(uint256 id, address token, uint256 amount) external;   // bridge only
  function settle(uint256 id) external returns (uint256 proceedsUsdc);              // bridge only; transfers USDC to bridge
  ```
  Plus on `MockIssuer`: `setBridge(address)` (admin, once), `fund(uint256)` (anyone; pulls USDC), `getRequest(uint256)`.

- [ ] **Step 1: Write the failing tests**

`contracts/test/MockIssuer.t.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDC} from "../src/MockUSDC.sol";
import {MockRWAToken} from "../src/MockRWAToken.sol";
import {RWARegistry} from "../src/RWARegistry.sol";
import {MockIssuer} from "../src/MockIssuer.sol";
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
        registry.registerAsset(address(rwa), address(issuer), 1.04e18, 120, 3, 1, true);
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
        vm.prank(admin);
        registry.grantRole(registry.NAV_UPDATER_ROLE(), admin);
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `forge test --match-path test/MockIssuer.t.sol -vv`
Expected: compilation error, `MockIssuer.sol` not found.

- [ ] **Step 3: Implement interface and issuer**

`contracts/src/interfaces/IIssuer.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IIssuer {
    /// @notice Record that `amount` of `token` has been delivered for redemption under `id`.
    function requestRedemption(uint256 id, address token, uint256 amount) external;

    /// @notice Burn the delivered tokens and pay current NAV in USDC to the caller.
    /// @return proceedsUsdc USDC (6 decimals) transferred to the caller
    function settle(uint256 id) external returns (uint256 proceedsUsdc);
}
```

`contracts/src/MockIssuer.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIssuer} from "./interfaces/IIssuer.sol";
import {IRWARegistry} from "./interfaces/IRWARegistry.sol";
import {MockRWAToken} from "./MockRWAToken.sol";
import {Pricing} from "./lib/Pricing.sol";

/// @notice Simulates an RWA issuer: accepts tokens for redemption and pays NAV in USDC on settlement.
/// @dev Must be prefunded with USDC via `fund`. Must hold ISSUER_ROLE on each RWA token.
contract MockIssuer is IIssuer, AccessControl {
    using SafeERC20 for IERC20;

    struct Request {
        address token;
        uint256 amount;
        bool settled;
        bool exists;
    }

    IRWARegistry public immutable registry;
    IERC20 public immutable usdc;
    address public bridge;
    mapping(uint256 => Request) private _requests;

    error OnlyBridge();
    error BridgeAlreadySet();
    error ZeroAddress();
    error UnknownRequest(uint256 id);
    error AlreadySettled(uint256 id);
    error DuplicateRequest(uint256 id);
    error InsufficientIssuerFunds(uint256 needed, uint256 available);

    event BridgeSet(address indexed bridge);
    event RedemptionRequested(uint256 indexed id, address indexed token, uint256 amount);
    event RedemptionSettled(uint256 indexed id, address indexed token, uint256 amount, uint256 proceeds);
    event Funded(address indexed from, uint256 amount);

    modifier onlyBridge() {
        if (msg.sender != bridge) revert OnlyBridge();
        _;
    }

    constructor(IRWARegistry registry_, IERC20 usdc_, address admin) {
        if (admin == address(0)) revert ZeroAddress();
        registry = registry_;
        usdc = usdc_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function setBridge(address bridge_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bridge != address(0)) revert BridgeAlreadySet();
        if (bridge_ == address(0)) revert ZeroAddress();
        bridge = bridge_;
        emit BridgeSet(bridge_);
    }

    /// @notice Anyone may top up the issuer's USDC so it can honour settlements.
    function fund(uint256 amount) external {
        usdc.safeTransferFrom(msg.sender, address(this), amount);
        emit Funded(msg.sender, amount);
    }

    function requestRedemption(uint256 id, address token, uint256 amount) external onlyBridge {
        if (_requests[id].exists) revert DuplicateRequest(id);
        _requests[id] = Request({token: token, amount: amount, settled: false, exists: true});
        emit RedemptionRequested(id, token, amount);
    }

    function settle(uint256 id) external onlyBridge returns (uint256 proceedsUsdc) {
        Request storage r = _requests[id];
        if (!r.exists) revert UnknownRequest(id);
        if (r.settled) revert AlreadySettled(id);

        uint256 nav = registry.getAsset(r.token).navPerToken;
        proceedsUsdc = Pricing.wadToUsdc(Pricing.navValueWad(r.amount, nav));
        uint256 available = usdc.balanceOf(address(this));
        if (available < proceedsUsdc) revert InsufficientIssuerFunds(proceedsUsdc, available);

        r.settled = true;
        MockRWAToken(r.token).burnFrom(address(this), r.amount);
        usdc.safeTransfer(msg.sender, proceedsUsdc);
        emit RedemptionSettled(id, r.token, r.amount, proceedsUsdc);
    }

    function getRequest(uint256 id) external view returns (Request memory) {
        return _requests[id];
    }
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `forge test --match-path test/MockIssuer.t.sol -vv`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add contracts/src/interfaces/IIssuer.sol contracts/src/MockIssuer.sol contracts/test/MockIssuer.t.sol
git commit -m "feat(contracts): mock issuer paying NAV on settlement

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 6: RedemptionBridge

**Files:**
- Create: `contracts/src/RedemptionBridge.sol`, `contracts/test/utils/Fixture.sol`
- Test: `contracts/test/RedemptionBridge.t.sol`

**Interfaces:**
- Consumes: `IRWARegistry` (Task 2), `Pricing` (Task 3), `LiquidityVault.advance/settleReceivable/idle/outstanding` (Task 4), `IIssuer` (Task 5).
- Produces:
  ```solidity
  enum Status { Open, Settled }
  struct Receivable { uint256 id; address token; address holder; uint256 amount; uint256 navAtFront; uint256 advanced; uint256 expected; uint64 openedAt; uint64 settleAfter; Status status; }
  struct Quote { uint256 navValueWad; uint256 navValueUsdc; uint256 utilisationBps; uint256 baseBps; uint256 utilTermBps; uint256 timeRiskBps; uint256 spreadBps; uint256 payout; }
  constructor(IRWARegistry registry, LiquidityVault vault, IERC20 usdc, IIssuer issuer, address treasury, address admin, uint16 protocolFeeBps, Pricing.Curve memory curve)
  function quote(address token, uint256 amount) public view returns (Quote memory);
  function redeem(address token, uint256 amount, uint256 minPayout) external returns (uint256 id);
  function settle(uint256 id) external returns (uint256 proceeds);
  function openReceivableIds() external view returns (uint256[] memory);
  function getReceivable(uint256 id) external view returns (Receivable memory);
  function nextId() external view returns (uint256);
  function curve() external view returns (uint16 kinkBps, uint16 slope1Bps, uint16 slope2Bps);
  function protocolFeeBps() external view returns (uint16); function treasury() external view returns (address);
  function setTreasury(address); setProtocolFee(uint16); setCurve(Pricing.Curve memory); pause(); unpause();
  ```
  Events: `ReceivableOpened(uint256 indexed id, address indexed token, address indexed holder, uint256 amount, uint256 navAtFront, uint256 advanced, uint256 spreadBps, uint64 settleAfter)`, `ReceivableSettled(uint256 indexed id, uint256 proceeds, uint256 fee, int256 pnl)`, `DemoOverride(uint256 indexed id, address indexed caller)`.
  Roles: `DEFAULT_ADMIN_ROLE`, `DEMO_ADMIN_ROLE`, `PAUSER_ROLE`.

- [ ] **Step 1: Write the fixture**

`contracts/test/utils/Fixture.sol`:
```solidity
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
            Pricing.Curve({kinkBps: 8_000, slope1Bps: 20, slope2Bps: 200})
        );

        vm.startPrank(admin);
        issuer.setBridge(address(bridge));
        vault.grantRole(vault.BRIDGE_ROLE(), address(bridge));
        registry.grantRole(registry.NAV_UPDATER_ROLE(), admin);
        tbill.grantRole(tbill.ISSUER_ROLE(), address(issuer));
        tsla.grantRole(tsla.ISSUER_ROLE(), address(issuer));
        priv.grantRole(priv.ISSUER_ROLE(), address(issuer));
        registry.registerAsset(address(tbill), address(issuer), 1.04e18, WINDOW, 3, 1, true);
        registry.registerAsset(address(tsla), address(issuer), 248.5e18, WINDOW, 15, 180, true);
        registry.registerAsset(address(priv), address(issuer), 1e18, 600, 50, 30, false);

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
```

- [ ] **Step 2: Write the failing tests**

`contracts/test/RedemptionBridge.t.sol`:
```solidity
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
        vm.expectRevert();
        vm.prank(holder);
        bridge.redeem(address(tsla), 10_000e18, 0);
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
        vm.prank(admin);
        bridge.grantRole(bridge.DEMO_ADMIN_ROLE(), admin);
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
}
```

- [ ] **Step 3: Run to verify it fails**

Run: `forge test --match-path test/RedemptionBridge.t.sol -vv`
Expected: compilation error, `RedemptionBridge.sol` not found.

- [ ] **Step 4: Implement the bridge**

`contracts/src/RedemptionBridge.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IRWARegistry} from "./interfaces/IRWARegistry.sol";
import {IIssuer} from "./interfaces/IIssuer.sol";
import {LiquidityVault} from "./LiquidityVault.sol";
import {Pricing} from "./lib/Pricing.sol";

/// @title RedemptionBridge
/// @notice Instant NAV-minus-spread exits for redeemable RWA tokens, funded by the LiquidityVault
///         and repaid when the issuer settles the redemption.
contract RedemptionBridge is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    bytes32 public constant DEMO_ADMIN_ROLE = keccak256("DEMO_ADMIN_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");
    uint256 public constant MAX_SPREAD_BPS = 5_000;
    uint256 private constant BPS = 10_000;

    enum Status {
        Open,
        Settled
    }

    struct Receivable {
        uint256 id;
        address token;
        address holder;
        uint256 amount; // RWA tokens, 1e18
        uint256 navAtFront; // 1e18
        uint256 advanced; // USDC paid to holder
        uint256 expected; // USDC at NAV when opened (display)
        uint64 openedAt;
        uint64 settleAfter;
        Status status;
    }

    struct Quote {
        uint256 navValueWad;
        uint256 navValueUsdc;
        uint256 utilisationBps; // projected, if full NAV value were advanced
        uint256 baseBps;
        uint256 utilTermBps;
        uint256 timeRiskBps;
        uint256 spreadBps;
        uint256 payout; // USDC
    }

    IRWARegistry public immutable registry;
    LiquidityVault public immutable vault;
    IERC20 public immutable usdc;
    IIssuer public immutable issuer;

    address public treasury;
    uint16 public protocolFeeBps; // share of realised profit
    Pricing.Curve public curve;

    uint256 public nextId = 1;
    mapping(uint256 => Receivable) private _receivables;
    uint256[] private _openIds;
    mapping(uint256 => uint256) private _openIndex; // id => index+1 (0 = not open)

    error ZeroAddress();
    error ZeroAmount();
    error InvalidFee();
    error InvalidCurve();
    error AssetDisabled(address token);
    error NotEligibleRedeemer(address token);
    error SpreadTooHigh(uint256 spreadBps);
    error SlippageExceeded(uint256 payout, uint256 minPayout);
    error ReceivableNotOpen(uint256 id);
    error SettlementWindowNotElapsed(uint256 id, uint64 settleAfter);

    event ReceivableOpened(
        uint256 indexed id,
        address indexed token,
        address indexed holder,
        uint256 amount,
        uint256 navAtFront,
        uint256 advanced,
        uint256 spreadBps,
        uint64 settleAfter
    );
    event ReceivableSettled(uint256 indexed id, uint256 proceeds, uint256 fee, int256 pnl);
    event DemoOverride(uint256 indexed id, address indexed caller);
    event TreasurySet(address indexed treasury);
    event ProtocolFeeSet(uint16 bps);
    event CurveSet(uint16 kinkBps, uint16 slope1Bps, uint16 slope2Bps);

    constructor(
        IRWARegistry registry_,
        LiquidityVault vault_,
        IERC20 usdc_,
        IIssuer issuer_,
        address treasury_,
        address admin,
        uint16 protocolFeeBps_,
        Pricing.Curve memory curve_
    ) {
        if (
            address(registry_) == address(0) || address(vault_) == address(0) || address(usdc_) == address(0)
                || address(issuer_) == address(0) || treasury_ == address(0) || admin == address(0)
        ) revert ZeroAddress();
        registry = registry_;
        vault = vault_;
        usdc = usdc_;
        issuer = issuer_;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE, admin);
        _setTreasury(treasury_);
        _setProtocolFee(protocolFeeBps_);
        _setCurve(curve_);
        // vault pulls proceeds from us on settlement
        usdc_.forceApprove(address(vault_), type(uint256).max);
    }

    // ---------- pricing ----------

    function quote(address token, uint256 amount) public view returns (Quote memory q) {
        IRWARegistry.Asset memory a = registry.getAsset(token);
        q.navValueWad = Pricing.navValueWad(amount, a.navPerToken);
        q.navValueUsdc = Pricing.wadToUsdc(q.navValueWad);
        q.utilisationBps = Pricing.projectedUtilisationBps(vault.idle(), vault.outstanding(), q.navValueUsdc);
        q.baseBps = a.baseSpreadBps;
        q.utilTermBps = Pricing.utilisationTermBps(q.utilisationBps, curve);
        q.timeRiskBps = Pricing.timeRiskBps(a.dailyVolBps, registry.horizonDays(token));
        q.spreadBps = q.baseBps + q.utilTermBps + q.timeRiskBps;
        q.payout = Pricing.payoutUsdc(q.navValueWad, q.spreadBps);
    }

    // ---------- holder ----------

    /// @notice Deposit `amount` of `token`, receive USDC now at NAV minus spread.
    function redeem(address token, uint256 amount, uint256 minPayout)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 id)
    {
        if (amount == 0) revert ZeroAmount();
        IRWARegistry.Asset memory a = registry.getAsset(token);
        if (!a.enabled) revert AssetDisabled(token);
        if (!a.eligible) revert NotEligibleRedeemer(token);

        Quote memory q = quote(token, amount);
        if (q.spreadBps > MAX_SPREAD_BPS) revert SpreadTooHigh(q.spreadBps);
        if (q.payout < minPayout) revert SlippageExceeded(q.payout, minPayout);
        if (q.payout == 0) revert ZeroAmount();

        id = nextId++;
        uint64 settleAfter = uint64(block.timestamp + a.settlementWindow);

        _receivables[id] = Receivable({
            id: id,
            token: token,
            holder: msg.sender,
            amount: amount,
            navAtFront: a.navPerToken,
            advanced: q.payout,
            expected: q.navValueUsdc,
            openedAt: uint64(block.timestamp),
            settleAfter: settleAfter,
            status: Status.Open
        });
        _openIds.push(id);
        _openIndex[id] = _openIds.length;

        IERC20(token).safeTransferFrom(msg.sender, address(issuer), amount);
        issuer.requestRedemption(id, token, amount);
        vault.advance(msg.sender, q.payout);

        emit ReceivableOpened(id, token, msg.sender, amount, a.navPerToken, q.payout, q.spreadBps, settleAfter);
    }

    // ---------- keeper ----------

    /// @notice Collect issuer proceeds for `id` and return capital plus yield to the vault.
    /// @dev Permissionless once the settlement window has elapsed. DEMO_ADMIN_ROLE may settle early.
    function settle(uint256 id) external nonReentrant returns (uint256 proceeds) {
        Receivable storage r = _receivables[id];
        if (r.id == 0 || r.status != Status.Open) revert ReceivableNotOpen(id);
        if (block.timestamp < r.settleAfter) {
            if (!hasRole(DEMO_ADMIN_ROLE, msg.sender)) revert SettlementWindowNotElapsed(id, r.settleAfter);
            emit DemoOverride(id, msg.sender);
        }

        r.status = Status.Settled;
        _removeOpen(id);

        proceeds = issuer.settle(id);

        uint256 fee;
        uint256 toVault = proceeds;
        if (proceeds > r.advanced) {
            fee = (proceeds - r.advanced) * protocolFeeBps / BPS;
            toVault = proceeds - fee;
            if (fee > 0) usdc.safeTransfer(treasury, fee);
        }
        vault.settleReceivable(r.advanced, toVault);

        emit ReceivableSettled(id, proceeds, fee, int256(toVault) - int256(r.advanced));
    }

    // ---------- views ----------

    function openReceivableIds() external view returns (uint256[] memory) {
        return _openIds;
    }

    function getReceivable(uint256 id) external view returns (Receivable memory) {
        return _receivables[id];
    }

    // ---------- admin ----------

    function setTreasury(address treasury_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setTreasury(treasury_);
    }

    function setProtocolFee(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setProtocolFee(bps);
    }

    function setCurve(Pricing.Curve memory c) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setCurve(c);
    }

    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    // ---------- internals ----------

    function _setTreasury(address treasury_) internal {
        if (treasury_ == address(0)) revert ZeroAddress();
        treasury = treasury_;
        emit TreasurySet(treasury_);
    }

    function _setProtocolFee(uint16 bps) internal {
        if (bps > BPS) revert InvalidFee();
        protocolFeeBps = bps;
        emit ProtocolFeeSet(bps);
    }

    function _setCurve(Pricing.Curve memory c) internal {
        if (c.kinkBps == 0 || c.kinkBps >= BPS) revert InvalidCurve();
        curve = c;
        emit CurveSet(c.kinkBps, c.slope1Bps, c.slope2Bps);
    }

    function _removeOpen(uint256 id) internal {
        uint256 idx = _openIndex[id];
        if (idx == 0) return;
        uint256 last = _openIds[_openIds.length - 1];
        _openIds[idx - 1] = last;
        _openIndex[last] = idx;
        _openIds.pop();
        delete _openIndex[id];
    }
}
```

- [ ] **Step 5: Run to verify it passes**

Run: `forge test --match-path test/RedemptionBridge.t.sol -vv`
Expected: 17 tests pass. If `test_quoteDecomposition_tbill` fails on `utilisationBps`, confirm the fixture's LP deposit is exactly `100_000e6` and no other advances happened.

- [ ] **Step 6: Commit**

```bash
git add contracts/src/RedemptionBridge.sol contracts/test/utils/Fixture.sol contracts/test/RedemptionBridge.t.sol
git commit -m "feat(contracts): redemption bridge with quote, redeem, settle and fee split

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: Deploy script, Anvil rehearsal, Monad testnet deployment

**Files:**
- Create: `contracts/script/Deploy.s.sol`, `contracts/deployments/.gitkeep`
- Modify: `contracts/README.md` (replace Foundry boilerplate)

**Interfaces:**
- Consumes: every contract above.
- Produces: `contracts/deployments/<chainId>.json` with keys `chainId, deployer, usdc, rTBILL, rTSLA, rPRIV, registry, vault, issuer, bridge, treasury` — the contract Plans 2 and 3 read. Deployer holds admin on everything plus `NAV_UPDATER_ROLE` and `DEMO_ADMIN_ROLE`, and starts with 1,000,000 USDC and 10,000 of each RWA.

- [ ] **Step 1: Write the deploy script**

`contracts/script/Deploy.s.sol`:
```solidity
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
import {Pricing} from "../src/lib/Pricing.sol";

/// @notice Deploys, wires, seeds, and writes deployments/<chainId>.json.
/// Usage: forge script script/Deploy.s.sol --rpc-url <anvil|monad_testnet> --broadcast
contract Deploy is Script {
    uint32 constant SECONDS_PER_DAY = 60;
    uint32 constant WINDOW = 120;

    function run() external {
        uint256 pk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(pk);
        address treasury = vm.envOr("TREASURY", deployer);

        vm.startBroadcast(pk);

        MockUSDC usdc = new MockUSDC(deployer);
        MockRWAToken tbill = new MockRWAToken("Tokenized T-Bill Fund", "rTBILL", deployer);
        MockRWAToken tsla = new MockRWAToken("Tokenized TSLA", "rTSLA", deployer);
        MockRWAToken priv = new MockRWAToken("Tokenized Private Credit", "rPRIV", deployer);
        RWARegistry registry = new RWARegistry(deployer, SECONDS_PER_DAY);
        LiquidityVault vault = new LiquidityVault(IERC20(address(usdc)), deployer, 9_500);
        MockIssuer issuer = new MockIssuer(registry, IERC20(address(usdc)), deployer);
        RedemptionBridge bridge = new RedemptionBridge(
            registry,
            vault,
            IERC20(address(usdc)),
            IIssuer(address(issuer)),
            treasury,
            deployer,
            2_500,
            Pricing.Curve({kinkBps: 8_000, slope1Bps: 20, slope2Bps: 200})
        );

        // wiring
        issuer.setBridge(address(bridge));
        vault.grantRole(vault.BRIDGE_ROLE(), address(bridge));
        registry.grantRole(registry.NAV_UPDATER_ROLE(), deployer);
        bridge.grantRole(bridge.DEMO_ADMIN_ROLE(), deployer);
        tbill.grantRole(tbill.ISSUER_ROLE(), address(issuer));
        tsla.grantRole(tsla.ISSUER_ROLE(), address(issuer));
        priv.grantRole(priv.ISSUER_ROLE(), address(issuer));

        // assets
        registry.registerAsset(address(tbill), address(issuer), 1.0432e18, WINDOW, 3, 1, true);
        registry.registerAsset(address(tsla), address(issuer), 248.5e18, WINDOW, 15, 180, true);
        registry.registerAsset(address(priv), address(issuer), 1e18, 600, 50, 30, false);

        // seed
        usdc.mint(deployer, 1_500_000e6);
        usdc.approve(address(issuer), 500_000e6);
        issuer.fund(500_000e6);
        tbill.mint(deployer, 10_000e18);
        tsla.mint(deployer, 10_000e18);
        priv.mint(deployer, 10_000e18);

        vm.stopBroadcast();

        // deployments json
        string memory obj = "deployment";
        vm.serializeUint(obj, "chainId", block.chainid);
        vm.serializeAddress(obj, "deployer", deployer);
        vm.serializeAddress(obj, "treasury", treasury);
        vm.serializeAddress(obj, "usdc", address(usdc));
        vm.serializeAddress(obj, "rTBILL", address(tbill));
        vm.serializeAddress(obj, "rTSLA", address(tsla));
        vm.serializeAddress(obj, "rPRIV", address(priv));
        vm.serializeAddress(obj, "registry", address(registry));
        vm.serializeAddress(obj, "vault", address(vault));
        vm.serializeAddress(obj, "issuer", address(issuer));
        string memory json = vm.serializeAddress(obj, "bridge", address(bridge));
        vm.createDir("deployments", true);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(json, path);
        console2.log("wrote", path);
    }
}
```

- [ ] **Step 2: Dry-run the script (no broadcast) to compile and simulate**

```bash
cd contracts
cp .env.example .env          # Anvil key
set -a; source .env; set +a
forge script script/Deploy.s.sol
```
Expected: `Script ran successfully`, log line `wrote deployments/31337.json`.

- [ ] **Step 3: Rehearse on Anvil**

Terminal A: `cd contracts && anvil --chain-id 31337 --block-time 1`
Terminal B:
```bash
cd contracts
set -a; source .env; set +a
forge script script/Deploy.s.sol --rpc-url anvil --broadcast
cat deployments/31337.json
```
Expected: 8 contract creations plus wiring transactions succeed; JSON contains all 11 keys.

Smoke the flow with cast (addresses from the JSON; `$D` = deployer address `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266`):
```bash
BRIDGE=$(jq -r .bridge deployments/31337.json); TBILL=$(jq -r .rTBILL deployments/31337.json)
USDC=$(jq -r .usdc deployments/31337.json); VAULT=$(jq -r .vault deployments/31337.json)
D=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
cast send $USDC "approve(address,uint256)" $VAULT 100000000000 --private-key $PRIVATE_KEY --rpc-url anvil
cast send $VAULT "deposit(uint256,address)" 100000000000 $D --private-key $PRIVATE_KEY --rpc-url anvil
cast send $TBILL "approve(address,uint256)" $BRIDGE 1000000000000000000000 --private-key $PRIVATE_KEY --rpc-url anvil
cast send $BRIDGE "redeem(address,uint256,uint256)" $TBILL 1000000000000000000000 0 --private-key $PRIVATE_KEY --rpc-url anvil
cast call $BRIDGE "openReceivableIds()(uint256[])" --rpc-url anvil      # expect [1]
sleep 121
cast send $BRIDGE "settle(uint256)" 1 --private-key $PRIVATE_KEY --rpc-url anvil
cast call $VAULT "totalAssets()(uint256)" --rpc-url anvil               # expect > 100000000000
```

- [ ] **Step 4: Deploy to Monad testnet**

Get a fresh deployer key (never reuse a key that holds real funds), fund it at `https://faucet.monad.xyz`, put it in `contracts/.env` as `PRIVATE_KEY`, then:
```bash
cd contracts
set -a; source .env; set +a
forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --slow
cat deployments/10143.json
```
Expected: all transactions confirmed; JSON written. `--slow` waits for each receipt, which avoids nonce races on a 50 rps public RPC.

Optional verification (per Monad docs; if the URL has changed consult https://docs.monad.xyz/guides/verify-smart-contract/foundry):
```bash
forge verify-contract --chain 10143 --verifier sourcify \
  --verifier-url https://sourcify-api-monad.blockvision.org \
  $(jq -r .bridge deployments/10143.json) src/RedemptionBridge.sol:RedemptionBridge
```

- [ ] **Step 5: Replace the README**

`contracts/README.md`:
```markdown
# RedeemNow contracts

Instant NAV-priced exits for tokenized RWAs. See `docs/superpowers/specs/2026-09-18-redeemnow-design.md`.

## Setup
    foundryup
    forge install OpenZeppelin/openzeppelin-contracts --no-git
    cp .env.example .env

## Test (one file at a time)
    forge test --match-path test/RedemptionBridge.t.sol -vv

## Deploy
    set -a; source .env; set +a
    forge script script/Deploy.s.sol --rpc-url anvil --broadcast          # local
    forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --slow

Addresses land in `deployments/<chainId>.json`.

## Contracts
| Contract | Role |
|---|---|
| RWARegistry | per-asset NAV, settlement window, eligibility, spread params; demo clock |
| LiquidityVault | ERC-4626 USDC pool; `advance` / `settleReceivable` for the bridge |
| RedemptionBridge | `quote`, `redeem`, `settle`; fee split to treasury |
| MockIssuer | holds redeemed tokens, pays NAV on settle |
| MockUSDC, MockRWAToken | demo tokens |
```

- [ ] **Step 6: Commit**

```bash
git add contracts/script/Deploy.s.sol contracts/deployments/31337.json contracts/deployments/10143.json contracts/README.md
git commit -m "feat(contracts): deploy script, Anvil rehearsal, Monad testnet deployment

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 8: Pricing fixtures for the TypeScript mirror

**Files:**
- Create: `contracts/script/PricingFixtures.s.sol`, `contracts/fixtures/.gitkeep`

**Interfaces:**
- Consumes: `Pricing` (Task 3).
- Produces: `contracts/fixtures/pricing.json`, an array of `{ "uBps", "kink", "slope1", "slope2", "utilTerm", "vol", "horizonWad", "timeRisk", "navWad", "spread", "payout" }` records that Plan 2's `pricing.test.ts` replays against the TS mirror.

- [ ] **Step 1: Write the fixture script**

`contracts/script/PricingFixtures.s.sol`:
```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script} from "forge-std/Script.sol";
import {Pricing} from "../src/lib/Pricing.sol";

/// @notice Writes fixtures/pricing.json so the TypeScript pricing mirror can be tested to the wei.
/// Usage: forge script script/PricingFixtures.s.sol
contract PricingFixtures is Script {
    function run() external {
        Pricing.Curve memory c = Pricing.Curve({kinkBps: 8_000, slope1Bps: 20, slope2Bps: 200});
        uint256[9] memory us = [uint256(0), 104, 1_000, 4_999, 8_000, 8_001, 9_500, 10_000, 12_000];
        uint256[4] memory vols = [uint256(0), 1, 30, 180];
        uint256[4] memory horizons = [uint256(0), 1e18, 2e18, 4e18];
        uint256[3] memory navs = [uint256(1_040e18), 24_850e18, 1];

        string memory out = "[";
        bool first = true;
        for (uint256 i = 0; i < us.length; i++) {
            for (uint256 j = 0; j < vols.length; j++) {
                for (uint256 k = 0; k < horizons.length; k++) {
                    for (uint256 m = 0; m < navs.length; m++) {
                        uint256 util = Pricing.utilisationTermBps(us[i], c);
                        uint256 tr = Pricing.timeRiskBps(vols[j], horizons[k]);
                        uint256 spread = 3 + util + tr;
                        uint256 payout = Pricing.payoutUsdc(navs[m], spread);
                        string memory rec = string.concat(
                            "{\"uBps\":", vm.toString(us[i]),
                            ",\"kink\":8000,\"slope1\":20,\"slope2\":200",
                            ",\"utilTerm\":", vm.toString(util),
                            ",\"vol\":", vm.toString(vols[j]),
                            ",\"horizonWad\":\"", vm.toString(horizons[k]), "\"",
                            ",\"timeRisk\":", vm.toString(tr),
                            ",\"navWad\":\"", vm.toString(navs[m]), "\"",
                            ",\"spread\":", vm.toString(spread),
                            ",\"payout\":\"", vm.toString(payout), "\"}"
                        );
                        out = string.concat(out, first ? "" : ",", rec);
                        first = false;
                    }
                }
            }
        }
        out = string.concat(out, "]");
        vm.createDir("fixtures", true);
        vm.writeFile("fixtures/pricing.json", out);
    }
}
```

- [ ] **Step 2: Run it and validate the JSON**

```bash
cd contracts
forge script script/PricingFixtures.s.sol
jq length fixtures/pricing.json     # expect 432
jq '.[0]' fixtures/pricing.json     # uBps 0, utilTerm 0, timeRisk 0, spread 3
```

- [ ] **Step 3: Commit**

```bash
git add contracts/script/PricingFixtures.s.sol contracts/fixtures/pricing.json
git commit -m "feat(contracts): pricing fixtures for the TypeScript mirror

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Handoff to Plans 2 and 3

- **Plan 2 (keeper + shared package):** reads `contracts/deployments/<chainId>.json` and `contracts/out/*.json` ABIs via wagmi CLI's foundry plugin; implements `pricing.ts` validated against `contracts/fixtures/pricing.json`; `keeper settle` uses `openReceivableIds()` and `getReceivable(id).settleAfter`; `keeper nav-sim` calls `RWARegistry.setNav` with the deployer key (which holds `NAV_UPDATER_ROLE`).
- **Plan 3 (dashboard):** consumes the same shared package; `quote(token, amount)` drives the Holder view; `openReceivableIds` + `getReceivable` drive the receivable book; `DEMO_ADMIN_ROLE` gates the "Settle now" button.
