# RedeemNow Credit Risk & Impairment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make RedeemNow price and risk-manage the two things it currently only asserts — issuer credit risk and default — and reframe the demo around private credit, the asset class where redemption is genuinely broken.

**Architecture:** Three surgical changes to already-reviewed contracts. (1) The registry gains a per-asset `creditBps` (expected loss on a redemption in flight, calibrated from observed default data) and an `assetClass`. (2) `Pricing` gains a fourth spread term, and the bridge gains a **per-asset exposure cap** derived from credit tier — so credit risk constrains *how much* we take, not just what we charge. (3) The bridge and vault gain an impairment path, so a receivable that never settles is written down across all LPs at once instead of sitting at face value for the last LP out to absorb.

**Tech Stack:** Unchanged — Foundry 1.8.3, Solidity 0.8.28, OpenZeppelin 5.7.0, viem 2.56.8, TypeScript 7.0.2.

**Spec:** `docs/superpowers/specs/2026-09-18-redeemnow-design.md` — this plan amends §4.3, §4.5, §4.6, §8. Update the spec as part of Task 5.

**Plan:** 4 of 4, and it amends Plan 1. Plans 1 (contracts) and 2 (`packages/shared` + `keeper`) are complete and verified. Plan 3 (dashboard) is written but not yet built; Task 5 here patches it before it is executed.

**Market evidence driving this plan** (Dune × RWA.xyz 2025 Report, decoded from `/Users/velocity/Downloads/2025 RWA Report (Dune x RWA) v03.pdf`):
- Private credit is **$15.9B (+61% YTD)** — 2.2× tokenized Treasuries at $7.3B. Institutional funds $1.7B but **+387%**.
- Treasuries are where redemption is *least* broken and users barely exist: **JAAA $756M / 6 holders**, **JTRSY $337M / 8 holders**, **WTGXX flows on only 17% of days**.
- Private credit pools run **>90% utilisation** — holders genuinely cannot exit. Plume's nCREDIT has **88K holders**.
- **Circle's USYC already sells instant redemption**, disclosing it is capped at an "instant-redemption capacity", above which settlement is T+0/T+1, with "unlimited instant redemptions available for a fee." Capacity being the binding constraint, and immediacy being priced, are now third-party-validated — and our "nobody does this" claim is dead.
- Credit risk is parameterisable from real numbers: **Maple has $47M defaulted against $1.23B active loans (3.8%)** at 9.39% average base APY, with yields halving 20%→10%.

## Global Constraints

- **DO NOT COMMIT ANY FILES.** No `git add`, no `git commit`, no `git stash`, no branch creation. `git log --oneline | head -1` must still print `53354f8` when you finish.
- **Never run a whole test suite** (owner's global rule — daily-driver Mac). `forge test --match-path test/<One>.t.sol`, one file at a time. A bare `forge test`, bare `vitest run`, or `pnpm -r test` is **forbidden**. `forge build` is fine.
- Foundry is not on `PATH`: `export PATH="$PATH:$HOME/.foundry/bin"` first in every shell.
- pnpm only, never npm.
- **You are editing contracts that already passed review and have 64 passing tests.** Every existing test must still pass. If a change breaks one, that is a signal about the change, not licence to edit the test — report it.
- **`Status` is `enum Status { Open, Settled }` — Open == 0.** This plan appends `Impaired == 2`. Appending is safe; reordering would silently corrupt every stored receivable and break the keeper. Do not reorder.
- `bigint`/`uint256` end to end. No floats anywhere in a money path.
- The only private key permitted is the well-known **public** Anvil account 0 key. Never generate another.

## Design Rulings

Decided before dispatch. Implement as written; if you disagree, say so in your report.

1. **`creditBps` is flat, not horizon-scaled, and this is deliberate.** Pro-rating an annual default probability over a 2-day horizon gives ~2 bps on Maple's 3.8% — arithmetically defensible but economically wrong for this product. Our exposure is not "two days of an issuer's annual hazard"; it is **binary settlement risk on one redemption already in flight**: does the issuer honour it at all. That risk is dominated by counterparty and operational failure, not by term structure, at horizons measured in days. So `creditBps` is defined as *expected loss on a redemption in flight, in bps*, set per asset from its rating and the issuer's observed record. A term-structured PD/LGD model is roadmap, and the code says so.

2. **Credit risk must constrain exposure, not just price — otherwise it is `baseSpreadBps` renamed.** This is the substantive half of the change. Each asset gets `maxExposureBps`: the most of the vault's total assets that may be outstanding against that single asset at once. A 380 bps-credit private-credit asset gets a tighter cap than a 2 bps sovereign. Pricing answers "what do we charge"; the cap answers "how much do we take". A reviewer who says "you renamed base to credit" is only wrong because of this cap.

3. **Impairment writes down immediately and equally.** The moment a receivable is impaired, `totalAssets` drops, so every LP's share price drops at the same instant. The alternative — leaving it at face value until resolution — gives the first LP out a fictitious exit price and the last one the whole loss, which is a bank-run incentive. This is the single most important correctness property in this plan, and it gets a dedicated test.

4. **Impairment is permissioned and time-gated, not permissionless.** `markImpaired` requires `RISK_ADMIN_ROLE` and `block.timestamp > settleAfter + impairAfter`. A permissionless write-down would be an attack: anyone could impair a merely-late receivable and buy shares at the depressed price. The gate is honest about being a centralised judgement call — a real version needs an attestation or oracle, and the code says so.

5. **Lead the demo with private credit, not Treasuries.** rCREDIT becomes the headline leg. Treasuries stay in as the tight-spread contrast. This moves us off Circle's turf onto the $15.9B category, and it makes the credit term visibly dominant (≈380 bps vs 2 bps) rather than a rounding error.

6. **Do not build the borrow/LTV primitive in this plan.** The report favours collateral mobility over exit liquidity ($833M of syrupUSDC deployed as collateral vs. WTGXX moving on 17% of days), so it is the larger business — which is exactly why it needs its own design cycle for liquidation and oracle behaviour rather than a 3am bolt-on. It goes on the roadmap. The same pricing engine will drive it: the spread becomes the LTV haircut.

---

## Task 1: Registry — asset class, credit premium, exposure cap

**Files:**
- Modify: `contracts/src/RWARegistry.sol`, `contracts/src/interfaces/IRWARegistry.sol`
- Test: `contracts/test/RWARegistry.t.sol` (extend; all 9 existing tests must still pass)

**Interfaces produced** (Tasks 2-4 and Plan 3 depend on these exact names):
```solidity
enum AssetClass { Treasury, GlobalBond, PrivateCredit, InstitutionalFund, Equity, Commodity }

struct Asset {
    address token;
    address issuer;
    uint256 navPerToken;
    uint64 navUpdatedAt;
    uint32 settlementWindow;
    uint16 baseSpreadBps;
    uint16 dailyVolBps;
    uint16 creditBps;        // NEW: expected loss on a redemption in flight
    uint16 maxExposureBps;   // NEW: cap on outstanding vs vault total, per asset
    AssetClass assetClass;   // NEW
    bool eligible;
    bool enabled;
}

function setCredit(address token, uint16 creditBps) external;        // DEFAULT_ADMIN_ROLE
function setMaxExposure(address token, uint16 bps) external;         // DEFAULT_ADMIN_ROLE
event CreditSet(address indexed token, uint16 creditBps);
event MaxExposureSet(address indexed token, uint16 bps);
```
`registerAsset` gains `creditBps`, `maxExposureBps`, and `assetClass` parameters. Put the three new
parameters **after** `dailyVolBps` and **before** `eligible`, and update every call site.

- [ ] **Step 1: Read what exists before changing it**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/contracts
export PATH="$PATH:$HOME/.foundry/bin"
sed -n '1,140p' src/RWARegistry.sol
cat src/interfaces/IRWARegistry.sol
grep -rn 'registerAsset' --include=*.sol .
```
Note every `registerAsset` call site — there are several in tests, the fixture, and the deploy script.
All of them must be updated or the build breaks.

- [ ] **Step 2: Write the failing tests**

Append to `contracts/test/RWARegistry.t.sol` (keep every existing test untouched):
```solidity
    function test_registerStoresCreditClassAndExposure() public {
        IRWARegistry.Asset memory a = registry.getAsset(address(rwa));
        assertEq(a.creditBps, 380);
        assertEq(a.maxExposureBps, 4_000);
        assertEq(uint8(a.assetClass), uint8(IRWARegistry.AssetClass.PrivateCredit));
    }

    function test_setCredit() public {
        vm.prank(admin);
        registry.setCredit(address(rwa), 500);
        assertEq(registry.getAsset(address(rwa)).creditBps, 500);
    }

    function test_setCreditEmits() public {
        vm.expectEmit(true, false, false, true, address(registry));
        emit RWARegistry.CreditSet(address(rwa), 500);
        vm.prank(admin);
        registry.setCredit(address(rwa), 500);
    }

    function test_setCreditRejectsAbsurdPremium() public {
        // A credit premium at or above 100% would make payout zero and is certainly a typo.
        vm.prank(admin);
        vm.expectRevert(RWARegistry.InvalidBps.selector);
        registry.setCredit(address(rwa), 10_000);
    }

    function test_setCreditOnlyAdmin() public {
        vm.expectRevert();
        registry.setCredit(address(rwa), 500);
    }

    function test_setMaxExposure() public {
        vm.prank(admin);
        registry.setMaxExposure(address(rwa), 2_500);
        assertEq(registry.getAsset(address(rwa)).maxExposureBps, 2_500);
    }

    function test_setMaxExposureRejectsZeroAndOverfull() public {
        vm.startPrank(admin);
        vm.expectRevert(RWARegistry.InvalidBps.selector);
        registry.setMaxExposure(address(rwa), 0);
        vm.expectRevert(RWARegistry.InvalidBps.selector);
        registry.setMaxExposure(address(rwa), 10_001);
        vm.stopPrank();
    }

    function test_setCreditUnregisteredReverts() public {
        address ghost = makeAddr("ghost");
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(RWARegistry.AssetNotRegistered.selector, ghost));
        registry.setCredit(ghost, 100);
    }
```
Update this test file's own `registerAsset` call in `setUp` to pass `creditBps = 380`,
`maxExposureBps = 4_000`, `assetClass = PrivateCredit`.

- [ ] **Step 3: Run to verify it fails**

```bash
forge test --match-path test/RWARegistry.t.sol -vv
```
Expected: compilation failure — `registerAsset` arity, and the new members do not exist.

- [ ] **Step 4: Implement**

In `IRWARegistry.sol`: add the `AssetClass` enum and the three struct fields exactly as specified
above, and declare `setCredit` / `setMaxExposure`.

In `RWARegistry.sol`:
- Add the two errors/events and the two setters, each `onlyRole(DEFAULT_ADMIN_ROLE)` and each calling
  `_requireRegistered(token)` first.
- Validate: `creditBps < BPS` (reuse `InvalidBps`; add `uint256 private constant BPS = 10_000;` if
  the file does not already have it), and `maxExposureBps > 0 && maxExposureBps <= BPS`.
- Extend `registerAsset` and the `AssetRegistered` event with the three new values.
- **Storage packing matters and is already favourable — do not reorder the struct.** `token` and
  `issuer` each take a slot, `navPerToken` takes one, and `navUpdatedAt(8) + settlementWindow(4) +
  baseSpreadBps(2) + dailyVolBps(2) + creditBps(2) + maxExposureBps(2) + assetClass(1) +
  eligible(1) + enabled(1) = 23 bytes` still fits one slot. The struct stays 4 slots, so this change
  costs no extra SSTORE. Verify with `forge inspect RWARegistry storage-layout` and put the result in
  your report.

- [ ] **Step 5: Fix every other call site so the project still builds**

`registerAsset`'s signature changed, so `contracts/test/utils/Fixture.sol`, `contracts/test/MockIssuer.t.sol`,
`contracts/test/RedemptionBridge.t.sol` and `contracts/script/Deploy.s.sol` will all fail to compile.
Update each call to pass the new arguments. For now use `creditBps = 0`, `maxExposureBps = 10_000`,
and the fitting `assetClass` everywhere **except** the registry test — this keeps every existing
expected value in the other 55 tests unchanged, because a zero credit premium and a full exposure cap
are no-ops. Task 4 sets the real demo values.

- [ ] **Step 6: Run to verify**

```bash
forge build
forge test --match-path test/RWARegistry.t.sol -vv
```
Expected: build clean; RWARegistry tests all pass (9 existing + 8 new = 17).

Then confirm you broke nothing, one file at a time:
```bash
forge test --match-path test/MockTokens.t.sol
forge test --match-path test/Pricing.t.sol
forge test --match-path test/LiquidityVault.t.sol
forge test --match-path test/MockIssuer.t.sol
forge test --match-path test/RedemptionBridge.t.sol
```
Expected: 6, 11, 12, 6, 20 — unchanged. **Do not run a bare `forge test`.**

- [ ] **Step 7: Do NOT commit.** Confirm HEAD is still `53354f8`.

---

## Task 2: Pricing — the fourth spread term

**Files:**
- Modify: `contracts/src/lib/Pricing.sol`, `contracts/src/RedemptionBridge.sol` (`quote` only)
- Test: `contracts/test/Pricing.t.sol` (extend; 11 existing must still pass)

**Interfaces produced:**
```solidity
// Pricing.sol
function creditTermBps(uint256 creditBps) internal pure returns (uint256);
// RedemptionBridge.Quote gains, appended at the END so no existing field moves:
uint256 creditBps;
```

**The arithmetic, stated once so nobody re-derives it wrong:**
```
spreadBps = baseSpreadBps
          + utilisationTermBps(projectedUtilisation, curve)
          + timeRiskBps(dailyVolBps, horizonDays)
          + creditTermBps(creditBps)          <- NEW, and equal to creditBps
```
`creditTermBps` is an identity function today. That is intentional, not a placeholder: it exists as a
named seam so the term has one place to become a real PD/LGD model later, and so `quote()` reports it
as its own line rather than folding it into `base`. Say so in the doc comment. Do **not** delete it in
favour of adding `creditBps` directly — the dashboard renders these as four separate rows and a VC
reads them as four separate claims.

- [ ] **Step 1: Write the failing tests**

Append to `contracts/test/Pricing.t.sol`:
```solidity
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
```

- [ ] **Step 2: Run to verify it fails**

```bash
forge test --match-path test/Pricing.t.sol -vv
```
Expected: `creditTermBps` undefined.

- [ ] **Step 3: Implement**

In `Pricing.sol`, after `timeRiskBps`:
```solidity
    /// @notice Expected loss on a redemption already in flight, in bps.
    /// @dev Deliberately NOT scaled by the settlement horizon. Pro-rating an annual default
    ///      probability across a two-day window yields ~2 bps on a 3.8% observed default rate,
    ///      which is arithmetically defensible and economically wrong for this product: the
    ///      exposure is binary settlement risk on one redemption — does the issuer honour it at
    ///      all — which is dominated by counterparty and operational failure, not by term
    ///      structure, at horizons measured in days.
    ///
    ///      This is an identity function today and exists as a named seam, not as a placeholder:
    ///      it gives the term one place to become a real PD x LGD model, and it makes `quote()`
    ///      report credit as its own line instead of folding it into the base spread.
    ///
    ///      Calibration reference (Dune x RWA.xyz 2025): Maple Finance carried $47M of defaulted
    ///      loans against $1.23B of active loans, a 3.8% realised default rate, at a 9.39%
    ///      average base APY. Sovereign and AAA-CLO exposures are set far lower.
    function creditTermBps(uint256 creditBps) internal pure returns (uint256) {
        return creditBps;
    }
```

In `RedemptionBridge.sol`, append `creditBps` to the **end** of the `Quote` struct (so no existing
field's position changes) and extend `quote()`:
```solidity
        q.timeRiskBps = Pricing.timeRiskBps(a.dailyVolBps, registry.horizonDays(token));
        q.creditBps = Pricing.creditTermBps(a.creditBps);
        q.spreadBps = q.baseBps + q.utilTermBps + q.timeRiskBps + q.creditBps;
```

- [ ] **Step 4: Run to verify**

```bash
forge build
forge test --match-path test/Pricing.t.sol -vv
forge test --match-path test/RedemptionBridge.t.sol -vv
```
Expected: Pricing 11 + 4 = 15 pass. RedemptionBridge's 20 still pass **unchanged**, because Task 1
set `creditBps = 0` in the bridge test fixture, making the new term a no-op there. If a
RedemptionBridge expectation moves, the fixture is not at zero credit — fix the fixture, not the
expectation.

- [ ] **Step 5: Do NOT commit.**

---

## Task 3: Per-asset exposure cap and the impairment path

**Files:**
- Modify: `contracts/src/RedemptionBridge.sol`, `contracts/src/LiquidityVault.sol`
- Test: `contracts/test/RedemptionBridge.t.sol`, `contracts/test/LiquidityVault.t.sol` (extend)

**Interfaces produced:**
```solidity
// RedemptionBridge
enum Status { Open, Settled, Impaired }          // Impaired APPENDED as 2; do not reorder
bytes32 public constant RISK_ADMIN_ROLE = keccak256("RISK_ADMIN_ROLE");
uint32 public impairAfter;                        // grace period past settleAfter
mapping(address => uint256) public exposureUsdc;  // outstanding advanced per asset

error ExposureCapExceeded(address token, uint256 projected, uint256 cap);
error NotYetImpairable(uint256 id, uint64 impairableAt);
error NotImpaired(uint256 id);

event ReceivableImpaired(uint256 indexed id, address indexed token, uint256 advanced);
event ReceivableRecovered(uint256 indexed id, uint256 recovered, int256 pnl);
event ImpairAfterSet(uint32 seconds_);

function assetExposureCapUsdc(address token) external view returns (uint256);
function markImpaired(uint256 id) external;                          // RISK_ADMIN_ROLE
function recoverImpaired(uint256 id, uint256 recoveredUsdc) external; // RISK_ADMIN_ROLE
function setImpairAfter(uint32 seconds_) external;                    // DEFAULT_ADMIN_ROLE

// LiquidityVault
function absorbLoss(uint256 advanced) external;      // BRIDGE_ROLE
function recoverLoss(uint256 recovered) external;    // BRIDGE_ROLE
event LossAbsorbed(uint256 advanced, uint256 totalAssetsAfter);
event LossRecovered(uint256 recovered);
```

- [ ] **Step 1: Write the failing tests — vault first**

Append to `contracts/test/LiquidityVault.t.sol`:
```solidity
    function test_absorbLossDropsTotalAssetsAndSharePrice() public {
        // 100k deposited, 40k advanced, then the whole advance is written off.
        uint256 priceBefore = vault.convertToAssets(1_000_000);
        vm.prank(bridge);
        vault.advance(borrower, 40_000e6);
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
        address lp2 = makeAddr("lp2");
        deal(address(usdc), lp2, 100_000e6);
        vm.startPrank(lp2);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(100_000e6, lp2);
        vm.stopPrank();

        uint256 v1Before = vault.convertToAssets(vault.balanceOf(lp));
        uint256 v2Before = vault.convertToAssets(vault.balanceOf(lp2));
        assertApproxEqAbs(v1Before, v2Before, 1);

        vm.prank(bridge);
        vault.advance(borrower, 50_000e6);
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
        vm.expectRevert();
        vault.absorbLoss(1e6);
    }

    function test_recoverLossReturnsCapitalToIdle() public {
        vm.prank(bridge);
        vault.advance(borrower, 40_000e6);
        vm.prank(bridge);
        vault.absorbLoss(40_000e6);
        uint256 afterLoss = vault.totalAssets();

        // The bridge forwards whatever it clawed back.
        deal(address(usdc), bridge, 10_000e6);
        vm.startPrank(bridge);
        usdc.approve(address(vault), type(uint256).max);
        vault.recoverLoss(10_000e6);
        vm.stopPrank();

        assertEq(vault.totalAssets(), afterLoss + 10_000e6);
        assertEq(vault.idle(), 60_000e6 + 10_000e6);
    }

    function test_absorbLossCannotExceedOutstanding() public {
        vm.prank(bridge);
        vault.advance(borrower, 10_000e6);
        vm.prank(bridge);
        vm.expectRevert();
        vault.absorbLoss(20_000e6);
    }
```
> Match the existing file's fixture names (`vault`, `usdc`, `bridge`, `lp`, `borrower`) — read the
> top of `LiquidityVault.t.sol` and adapt these to whatever it actually calls them. Do not rename
> anything that already exists.

- [ ] **Step 2: Implement the vault side**

In `LiquidityVault.sol`:
```solidity
    error LossExceedsOutstanding(uint256 loss, uint256 outstanding);

    event LossAbsorbed(uint256 advanced, uint256 totalAssetsAfter);
    event LossRecovered(uint256 recovered);

    /// @notice Write `advanced` USDC off the book permanently.
    /// @dev `outstanding` falls with no matching rise in `idle`, so `totalAssets` falls and the
    ///      share price drops for EVERY holder in the same transaction. That is the point: leaving
    ///      an unpayable receivable at face value would let the first LP out exit at a fictitious
    ///      price and leave the whole loss with the last, which is a bank-run incentive.
    function absorbLoss(uint256 advanced) external onlyRole(BRIDGE_ROLE) nonReentrant {
        if (advanced > outstanding) revert LossExceedsOutstanding(advanced, outstanding);
        outstanding -= advanced;
        emit LossAbsorbed(advanced, totalAssets());
    }

    /// @notice Credit a recovery on a previously written-down receivable back to idle capital.
    /// @dev Pulls USDC from the bridge, which must hold the recovered amount.
    function recoverLoss(uint256 recovered) external onlyRole(BRIDGE_ROLE) nonReentrant {
        IERC20(asset()).safeTransferFrom(msg.sender, address(this), recovered);
        idle += recovered;
        emit LossRecovered(recovered);
    }
```

- [ ] **Step 3: Run the vault tests**

```bash
forge build
forge test --match-path test/LiquidityVault.t.sol -vv
```
Expected: 12 existing + 5 new = 17 pass. The invariant `totalAssets == idle + outstanding` must
still hold — if the existing invariant test fails, `absorbLoss` is wrong.

- [ ] **Step 4: Write the failing bridge tests**

Append to `contracts/test/RedemptionBridge.t.sol`:
```solidity
    function test_exposureCapBlocksConcentration() public {
        // Cap rTBILL at 5% of the vault, then try to exceed it in one redemption.
        vm.prank(admin);
        registry.setMaxExposure(address(rTBILL), 500); // 5% of 100k = 5,000 USDC
        uint256 cap = bridge.assetExposureCapUsdc(address(rTBILL));
        assertEq(cap, 5_000e6);

        // ~10,000 USDC of notional at NAV 1.0432 is well over the cap.
        vm.startPrank(holder);
        rTBILL.approve(address(bridge), type(uint256).max);
        vm.expectPartialRevert(RedemptionBridge.ExposureCapExceeded.selector);
        bridge.redeem(address(rTBILL), 9_600e18, 0);
        vm.stopPrank();
    }

    function test_exposureCapAllowsUpToTheLimit() public {
        vm.prank(admin);
        registry.setMaxExposure(address(rTBILL), 500);
        vm.startPrank(holder);
        rTBILL.approve(address(bridge), type(uint256).max);
        // ~1,043 USDC notional, comfortably inside a 5,000 cap.
        bridge.redeem(address(rTBILL), 1_000e18, 0);
        vm.stopPrank();
        assertGt(bridge.exposureUsdc(address(rTBILL)), 0);
        assertLe(bridge.exposureUsdc(address(rTBILL)), 5_000e6);
    }

    function test_exposureFreesUpOnSettlement() public {
        vm.startPrank(holder);
        rTBILL.approve(address(bridge), type(uint256).max);
        bridge.redeem(address(rTBILL), 1_000e18, 0);
        vm.stopPrank();
        assertGt(bridge.exposureUsdc(address(rTBILL)), 0);

        vm.warp(block.timestamp + WINDOW + 1);
        bridge.settle(1);
        assertEq(bridge.exposureUsdc(address(rTBILL)), 0);
    }

    function test_cannotImpairBeforeGracePeriod() public {
        vm.startPrank(holder);
        rTBILL.approve(address(bridge), type(uint256).max);
        bridge.redeem(address(rTBILL), 1_000e18, 0);
        vm.stopPrank();

        vm.prank(admin);
        vm.expectPartialRevert(RedemptionBridge.NotYetImpairable.selector);
        bridge.markImpaired(1);

        // Still not impairable one second before the grace period ends.
        vm.warp(block.timestamp + WINDOW + bridge.impairAfter());
        vm.prank(admin);
        vm.expectPartialRevert(RedemptionBridge.NotYetImpairable.selector);
        bridge.markImpaired(1);
    }

    function test_impairWritesDownAndRemovesFromOpenBook() public {
        vm.startPrank(holder);
        rTBILL.approve(address(bridge), type(uint256).max);
        bridge.redeem(address(rTBILL), 1_000e18, 0);
        vm.stopPrank();
        uint256 advanced = bridge.getReceivable(1).advanced;
        uint256 totalBefore = vault.totalAssets();

        vm.warp(block.timestamp + WINDOW + bridge.impairAfter() + 1);
        vm.prank(admin);
        bridge.markImpaired(1);

        assertEq(uint8(bridge.getReceivable(1).status), uint8(RedemptionBridge.Status.Impaired));
        assertEq(bridge.openReceivableIds().length, 0);
        assertEq(vault.totalAssets(), totalBefore - advanced);
        assertEq(bridge.exposureUsdc(address(rTBILL)), 0);
    }

    function test_impairedReceivableCannotBeSettled() public {
        vm.startPrank(holder);
        rTBILL.approve(address(bridge), type(uint256).max);
        bridge.redeem(address(rTBILL), 1_000e18, 0);
        vm.stopPrank();
        vm.warp(block.timestamp + WINDOW + bridge.impairAfter() + 1);
        vm.prank(admin);
        bridge.markImpaired(1);

        vm.expectPartialRevert(RedemptionBridge.ReceivableNotOpen.selector);
        bridge.settle(1);
    }

    function test_impairOnlyRiskAdmin() public {
        vm.startPrank(holder);
        rTBILL.approve(address(bridge), type(uint256).max);
        bridge.redeem(address(rTBILL), 1_000e18, 0);
        vm.stopPrank();
        vm.warp(block.timestamp + WINDOW + bridge.impairAfter() + 1);
        vm.expectRevert();
        bridge.markImpaired(1);
    }

    function test_recoveryOnAnImpairedReceivableReturnsCapital() public {
        vm.startPrank(holder);
        rTBILL.approve(address(bridge), type(uint256).max);
        bridge.redeem(address(rTBILL), 1_000e18, 0);
        vm.stopPrank();
        uint256 advanced = bridge.getReceivable(1).advanced;

        vm.warp(block.timestamp + WINDOW + bridge.impairAfter() + 1);
        vm.prank(admin);
        bridge.markImpaired(1);
        uint256 afterImpair = vault.totalAssets();

        // A workout recovers 60% of the advance; the admin funds the bridge and books it.
        uint256 recovered = (advanced * 60) / 100;
        deal(address(usdc), admin, recovered);
        vm.startPrank(admin);
        usdc.approve(address(bridge), type(uint256).max);
        bridge.recoverImpaired(1, recovered);
        vm.stopPrank();

        assertEq(vault.totalAssets(), afterImpair + recovered);
        assertEq(uint8(bridge.getReceivable(1).status), uint8(RedemptionBridge.Status.Settled));
    }

    function test_cannotRecoverAReceivableThatIsNotImpaired() public {
        vm.startPrank(holder);
        rTBILL.approve(address(bridge), type(uint256).max);
        bridge.redeem(address(rTBILL), 1_000e18, 0);
        vm.stopPrank();
        vm.prank(admin);
        vm.expectPartialRevert(RedemptionBridge.NotImpaired.selector);
        bridge.recoverImpaired(1, 1e6);
    }
```
> `vm.expectPartialRevert` matches on selector only, which is what we want where the revert carries
> computed arguments. If your Foundry version lacks it, use
> `vm.expectRevert(abi.encodeWithSelector(...))` with the exact arguments, computing them first.

- [ ] **Step 5: Implement the bridge side**

In `RedemptionBridge.sol`:
- Append `Impaired` to `Status`. **Append only.** `Open` must stay 0 and `Settled` must stay 1, or
  every stored receivable is reinterpreted and the keeper breaks.
- Add `RISK_ADMIN_ROLE`, `impairAfter` (constructor parameter, and `setImpairAfter`), and
  `mapping(address => uint256) public exposureUsdc`.
- `assetExposureCapUsdc(token)` = `vault.totalAssets() * registry.getAsset(token).maxExposureBps / BPS`.
- In `redeem`, after the capacity check and before any state change:
  ```solidity
  uint256 projectedExposure = exposureUsdc[token] + q.payout;
  uint256 cap = assetExposureCapUsdc(token);
  if (projectedExposure > cap) revert ExposureCapExceeded(token, projectedExposure, cap);
  ```
  and `exposureUsdc[token] = projectedExposure;` alongside the existing bookkeeping.
- In `settle`, decrement `exposureUsdc[r.token] -= r.advanced;` in the same place the receivable
  leaves the open book. Guard the subtraction so a rounding mismatch can never underflow-revert a
  settlement: if `exposureUsdc[r.token] < r.advanced`, set it to 0.
- `markImpaired(id)`:
  ```solidity
  function markImpaired(uint256 id) external onlyRole(RISK_ADMIN_ROLE) nonReentrant {
      Receivable storage r = _receivables[id];
      if (r.status != Status.Open) revert ReceivableNotOpen(id);
      uint64 impairableAt = r.settleAfter + impairAfter;
      if (block.timestamp <= impairableAt) revert NotYetImpairable(id, impairableAt);

      r.status = Status.Impaired;          // effects before interactions
      _removeOpen(id);
      uint256 advanced = r.advanced;
      uint256 e = exposureUsdc[r.token];
      exposureUsdc[r.token] = e > advanced ? e - advanced : 0;

      vault.absorbLoss(advanced);
      emit ReceivableImpaired(id, r.token, advanced);
  }
  ```
- `recoverImpaired(id, recoveredUsdc)`: require `Status.Impaired`; pull `recoveredUsdc` from
  `msg.sender` with `safeTransferFrom`; `usdc.forceApprove(address(vault), recoveredUsdc)`; call
  `vault.recoverLoss(recoveredUsdc)`; set `r.status = Status.Settled`; emit `ReceivableRecovered`
  with `pnl = int256(recoveredUsdc) - int256(r.advanced)`.
- Wire `RISK_ADMIN_ROLE` to `admin` in the constructor.

**Why the write-down is permissioned and time-gated, in a comment on `markImpaired`:** a
permissionless write-down is an attack — anyone could impair a merely-late receivable and buy shares
at the depressed price. The gate is an honest centralised judgement call; a production version needs
an issuer attestation or an oracle, and the comment should say so.

- [ ] **Step 6: Run to verify**

```bash
forge build
forge test --match-path test/RedemptionBridge.t.sol -vv
forge test --match-path test/LiquidityVault.t.sol -vv
```
Expected: RedemptionBridge 20 + 9 = 29; LiquidityVault 17. Then re-check the other three files
individually (`MockTokens`, `Pricing`, `MockIssuer`) — 6, 15, 6. **No bare `forge test`.**

- [ ] **Step 7: Do NOT commit.**

---

## Task 4: Credit-led asset mix and the rewritten demo

**Files:**
- Modify: `contracts/script/Deploy.s.sol`, `contracts/script/PricingFixtures.s.sol`
- Modify: `packages/shared/src/pricing.ts`, `packages/shared/test/pricing.test.ts`, `packages/shared/src/deployments.ts`, `packages/shared/src/index.ts`

**The new asset mix.** Five assets, chosen so the demo tells the market's story rather than Circle's:

| Token | Class | NAV | Window | base | vol/day | **credit** | maxExposure | eligible |
|---|---|---|---|---|---|---|---|---|
| `rTBILL` | Treasury | 1.0432 | 120 s | 3 | 1 | **2** | 10000 | yes |
| `rJAAA` | InstitutionalFund | 1.0000 | 120 s | 5 | 8 | **15** | 5000 | yes |
| `rCREDIT` | PrivateCredit | 1.0850 | 600 s | 15 | 25 | **380** | **800** | yes |
| `rTSLA` | Equity | 248.50 | 120 s | 15 | 180 | **25** | 8000 | yes |
| `rPRIV` | PrivateCredit | 1.0000 | 1800 s | 50 | 30 | **500** | 500 | **no** |

**Mint 10,000 of each RWA to the deployer** (unchanged from the current deploy script).

**The caps are not decoration — I computed them so the binding one actually binds inside the
mintable supply.** With `maxExposureBps = 4000`, rCREDIT's cap would be 40,000 USDC against a 100,000
vault, but 10,000 minted tokens are only ~10,850 of notional, so the cap could never trigger and demo
step 4 would be a lie. At **800 bps** the cap is 8,000 USDC and it binds at ~7,700 tokens. 8% is also
the more defensible number: you would not put 40% of a vault into one private-credit issuer carrying a
3.8% realised default rate.

**Verified figures** — I computed each of these against the pricing math before writing them down.
The implementer should reproduce them with `cast` and report any divergence rather than adjusting:

| Leg | Notional | Spread | Credit share of spread | Payout | vs cap |
|---|---|---|---|---|---|
| 1,000 `rTBILL` | 1,043.20 | **6 bps** | 2 bps = 33% | 1,042.57 | ok (100,000) |
| 5,000 `rJAAA` | 5,000.00 | **32 bps** | 15 bps = 46% | 4,984.00 | ok (50,000) |
| 5,000 `rCREDIT` | 5,425.00 | **475 bps** | **380 bps = 80%** | 5,167.31 | ok (8,000) |
| 8,000 `rCREDIT` | 8,680.00 | 476 bps | 380 bps = 79% | 8,266.83 | **exceeds 8,000** |
| 300 `rTSLA` | 74,550.00 | **312 bps** | 25 bps = **8%** | 72,224.04 | ok (80,000) |

That table *is* the pitch. Across the first three legs the credit term goes 33% → 46% → 80% of the
spread as you move up the risk curve, and on rTSLA it collapses to 8% because equity spread is
volatility-driven, not credit-driven. Four terms, visibly doing different work on different assets.

Calibration, to be stated in a comment in `Deploy.s.sol` so the numbers are defensible on stage:
- `rCREDIT` 380 bps ← Maple's $47M defaulted against $1.23B active loans = 3.8% realised default rate.
- `rJAAA` 15 bps ← AAA-rated CLO tranche; JAAA is $756M with a 0.40% management fee.
- `rTBILL` 2 bps ← sovereign; JTRSY is rated AA+.
- `rTSLA` 25 bps ← broker-dealer settlement risk, not issuer credit.
- `rPRIV` 500 bps ← unrated, and ineligible regardless.
- `maxExposureBps` falls as credit risk rises. That is the whole point of Design Ruling 2.

`secondsPerDay` stays **60**, so a 120 s window reads as 2 days and rCREDIT's 600 s reads as 10 days.

- [ ] **Step 1: Rewrite the deploy script**

Update `Deploy.s.sol` to deploy five RWA tokens with the table above, wire `ISSUER_ROLE` and
`MINTER_ROLE` for each, register each with its class/credit/exposure, grant `RISK_ADMIN_ROLE`, set
`impairAfter` (use **60 s** for the demo so impairment is reachable on stage), mint 10,000 of each
RWA to the deployer, and keep the existing USDC mint and issuer funding. Add `rJAAA` and `rCREDIT` to
the deployments JSON alongside the existing keys — **do not remove or rename any existing key**, or
`packages/shared/deployments.ts` and the keeper break.

Then:
```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/contracts
export PATH="$PATH:$HOME/.foundry/bin"
forge build
pkill -f "anvil --chain-id 31337"; sleep 1
nohup anvil --chain-id 31337 --block-time 1 > /tmp/anvil.log 2>&1 &
sleep 4
forge script script/Deploy.s.sol --rpc-url anvil --broadcast -v
cat deployments/31337.json
```
Expected: 13 keys (the original 11 plus `rJAAA` and `rCREDIT`).

- [ ] **Step 2: Extend `Deployment` in the shared package**

`packages/shared/src/deployments.ts`: add `rJAAA` and `rCREDIT` to `RWA_KEYS` in demo order
`['rTBILL', 'rJAAA', 'rCREDIT', 'rTSLA', 'rPRIV']`, so the type and the loader's validation both
cover them. Then fix the three findings the Tasks 1-3 review raised, since you are in this file
anyway:

- **Important-1 (barrel hazard):** add a comment at the top of `deployments.ts` and of `index.ts`
  stating that this module touches `node:fs` at import time, is therefore server-only, and that a
  `"use client"` module must import `@redeemnow/shared/chains` or `/pricing` directly rather than the
  barrel.
- **Important-2 (stale cache):** give `loadDeployment` an optional `opts?: { fresh?: boolean }` that
  bypasses the cache, and export `clearDeploymentCache()`. Document that a long-running keeper must
  call one of them after a redeploy. Do not remove the cache — the dashboard reads it per request.
- **Minor-1:** include the offending key's name in the `getAddress` failure path so a malformed
  address in the JSON is actionable.

- [ ] **Step 3: Regenerate the pricing fixtures with the credit dimension**

`PricingFixtures.s.sol` currently sweeps 9 utilisations × 4 vols × 4 horizons × 3 NAVs = 432 records
with a hardcoded base of 3 bps. Add a credit dimension of `[0, 2, 15, 380]` and emit `credit` in each
record, giving **1,728 records**. Keep the existing field names and order, appending `credit` — the
TypeScript parity test reads them by name.

This is also the moment to close the review's **Important-3** coverage gap: the fixture currently
supplies `navWad`, `horizonWad` and `uBps` pre-computed, so the parity test never exercises
`navValueWad`, `horizonDaysWad` or `projectedUtilisationBps` against Solidity-derived data. Emit the
**inputs** to those three as well — `amount`, `navPerToken`, `settlementWindow`, `secondsPerDay`,
`idle`, `outstanding`, `proposedUsdc` — so the TypeScript test must derive `navWad`, `horizonWad` and
`uBps` itself and compare. That turns three unguarded functions into guarded ones.

If the added struct fields reintroduce "stack too deep", extend the existing `Rec` struct and
`_buildRecord`/`_encode` helper split rather than enabling `via_ir` globally — a previous fix wave
restructured this script specifically so that plain `forge build` works.

```bash
forge script script/PricingFixtures.s.sol
python3 -c "import json;d=json.load(open('fixtures/pricing.json'));print(len(d),'records');print(d[0])"
```
Expected: 1,728 records.

- [ ] **Step 4: Update the TypeScript mirror and widen its parity test**

`packages/shared/src/pricing.ts`: add
```ts
/**
 * Expected loss on a redemption already in flight, in bps. Mirrors Pricing.creditTermBps —
 * deliberately not horizon-scaled; see that function's comment for why.
 */
export function creditTermBps(creditBps: bigint): bigint {
  return creditBps
}
```
and extend `spreadBps` to take `creditBps` and add the fourth term. **`spreadBps`'s signature
changes**, so update its existing callers.

`packages/shared/test/pricing.test.ts`: extend the fixture type with the new fields, walk all 1,728
records, and additionally derive and compare `navValueWad`, `horizonDaysWad` and
`projectedUtilisationBps` from the emitted inputs.

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/packages/shared
pnpm sync
pnpm vitest run test/pricing.test.ts
pnpm vitest run test/deployments.test.ts
pnpm typecheck
```
Expected: all pass, with the parity check now covering 1,728 records and seven functions.

**If parity fails, the mirror is wrong, not the fixtures** — they come from the deployed Solidity.
Never edit `pricing.json`, never relax an assertion.

- [ ] **Step 5: Regenerate ABIs and re-verify the keeper still works**

Every struct changed, so the generated ABIs are stale.
```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/packages/shared
pnpm abis
grep -oE 'export const [a-zA-Z]+Abi' src/generated.ts | sort
cd ../../keeper
pnpm typecheck
pnpm vitest run test/due.test.ts
pnpm vitest run test/navsim.test.ts
```
Expected: six ABI names unchanged; keeper typechecks; 15 and 11 tests pass.

`due.ts`'s `STATUS_OPEN = 0` / `STATUS_SETTLED = 1` stay correct because `Impaired` was appended.
Add `export const STATUS_IMPAIRED = 2` and make `isDue` explicit that only `Open` is settleable
(it already is — confirm, do not restructure).

Then the end-to-end check, which is the gate for this task:
```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/keeper
pnpm keeper settle --once          # expect: 0 open, nothing due
# seed a redemption with cast as in Plan 2 Task 5 Step 6, then:
pnpm keeper settle --once          # expect: settles, prints a tx hash
```

- [ ] **Step 6: Do NOT commit.**

---

## Task 5: Update the spec, the demo script, and the Plan 3 dashboard doc

**Files:**
- Modify: `docs/superpowers/specs/2026-09-18-redeemnow-design.md` (§4.3, §4.5, §4.6, §8, §9)
- Modify: `docs/superpowers/plans/2026-09-19-redeemnow-dashboard.md`

- [ ] **Step 1: Amend the spec**

- §4.3 registry: the three new `Asset` fields, the two new setters, the `AssetClass` enum.
- §4.5 pricing: the four-term spread, with the note on why credit is not horizon-scaled.
- §4.6 bridge: `Status.Impaired`, the exposure cap, `markImpaired`/`recoverImpaired`, `RISK_ADMIN_ROLE`.
- §9 out of scope: add the borrow/LTV primitive with its justification from the report, and add
  term-structured PD/LGD.
- Add a short "Market positioning" section recording the four findings that drove this plan, with the
  figures, and the explicit statement that **Circle's USYC already sells capacity-limited instant
  redemption for a fee** — so nobody on the team repeats a "nobody does this" claim on stage.

- [ ] **Step 2: Rewrite the demo script (spec §8)**

Compute each figure against the deployed contracts before writing it down — do not estimate. Run
`quote()` via `cast` for each leg on a live Anvil and paste the real numbers.

The narrative arc, which the sizes must serve:
1. LP deposits 100,000 USDC. Capacity 95,000. Per-asset caps now visible: rCREDIT **8,000**,
   rJAAA 50,000, rTSLA 80,000, rTBILL uncapped.
2. Redeem **1,000 rTBILL** — spread **6 bps**, of which 2 is credit (33%). The tight-spread contrast.
   Say "sovereign, two basis points of credit". Do not show the yield number; it is cents.
3. Redeem **5,000 rJAAA** — spread **32 bps**, credit 15 (46%). One rung up the curve: AAA CLO.
4. Redeem **5,000 rCREDIT** — spread **475 bps**, of which **380 bps is credit — 80% of the
   spread**. Payout 5,167.31. THE HEADLINE. Point at the decomposition and say: Maple carries a 3.8%
   realised default rate on a $1.23B book; we price that explicitly instead of asserting it.
5. Try **8,000 rCREDIT** → payout 8,266.83 against an 8,000 cap → **`ExposureCapExceeded`**.
   Credit risk limits *how much we take*, not only what we charge. This is the market-maker's point
   and no other RWA demo has it.
6. Redeem **300 rTSLA** — spread **312 bps** but credit is only 25 bps, **8%** of it. Same engine,
   completely different composition: equity spread is volatility-driven, credit-driven spread is not.
   Four terms visibly doing different work on different assets.
7. Attempt **rPRIV** → `NotEligibleRedeemer`. The eligibility moat.
8. Settle the rTBILL leg via the keeper; LPs earn the spread.
9. **Impair** the rCREDIT leg from the admin page → share price drops for every LP *in the same
   transaction*. Say plainly: no first-mover advantage, no bank run. Then `recoverImpaired` at 60%
   to show the workout path.

- [ ] **Step 3: Patch the Plan 3 dashboard doc**

Plan 3 is written but not built, so amend the document rather than the code:
- `useProtocol` / `useAssets`: add `creditBps`, `maxExposureBps`, `assetClass`, `exposureUsdc`,
  `assetExposureCapUsdc`. Remember viem returns `uint16` as `number` — widen with `BigInt(...)`.
- `Quote` type: append `creditBps`.
- `QuotePanel`: add a **credit** row to the decomposition, between time risk and total. Four
  components must visibly sum to the total. This is the single most important UI change in the plan.
- Overview: add an asset-class column and a per-asset exposure bar (used vs cap).
- Holder: show the binding constraint — `min(vault capacity, asset exposure cap)` — and label which
  one binds.
- Admin: add impair / recover controls behind `RISK_ADMIN_ROLE`, and a red impairment badge.
- `explainRevert`: add `ExposureCapExceeded`, `NotYetImpairable`, `NotImpaired`,
  `LossExceedsOutstanding`.
- Demo runbook: replace with the seven-step arc from Step 2.

- [ ] **Step 4: Do NOT commit.** Confirm HEAD is `53354f8` and report the full file list.

---

## Roadmap, deliberately not built

Recorded with the evidence that justifies each, so these read as decisions rather than gaps:

- **Borrow / LTV primitive.** The report's strongest signal: **$833M of syrupUSDC (30%+ of supply) is
  deployed as DeFi collateral** (Spark $571M, Jupiter $75M, Pendle $57M, Morpho and Kamino $44M
  each), JTRSY is the largest asset supplied on Aave Horizon, and Binance institutions use USYC as
  derivatives collateral — while **WTGXX sees flows on only 17% of days**. Holders want liquidity
  without selling. The same pricing engine drives it: the spread becomes the LTV haircut.
- **Term-structured PD × LGD**, replacing the flat `creditBps`.
- **Issuer attestation or oracle for impairment**, replacing the permissioned `RISK_ADMIN_ROLE` call.
- **JIT-liquidity mitigation** (lockup or streamed profit) — profit still lands as a discrete jump.
- **Fee on net book P&L** rather than gross per-receivable profit, so the treasury cannot book a fee
  in a period when LPs are net down. Now more pressing, because impairment makes net-down real.
- **`openReceivableIds()` pagination.** The keeper reads the whole array every tick.
- **Multi-issuer routing** via `Asset.issuer`, currently dead data.
- **Secondary market for receivables.** Tradable's own report entry lists a secondary market as
  "coming soon" — nobody has one. This is the infrastructure play: be the venue other protocols
  price against, rather than another RWA front-end competing with Plume for retail.
