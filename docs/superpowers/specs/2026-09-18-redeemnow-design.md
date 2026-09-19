# RedeemNow — Design Spec

**Date:** 2026-09-18
**Status:** Approved design, pre-implementation
**Target:** Monad Blitz / Monad Metropolis hackathon, track "Onchain Finance & Trading"

## 1. Purpose

RedeemNow is an instant-redemption liquidity layer for tokenized real-world assets (RWAs) on Monad.
A holder of a redeemable RWA token deposits it and receives stablecoins in the same transaction at
NAV minus a spread. Liquidity providers (LPs) fund a vault and earn that spread. A keeper submits the
redemption to the issuer and collects NAV when it settles. The pending redemption is a short-dated,
asset-backed receivable.

This spec covers the hackathon build: a working demo on Monad testnet with mock issuer and mock
tokens. No real issuer assets, custody, KYC, or capital.

## 2. Decisions already made

| Decision | Choice |
|---|---|
| Scope | Full demo stack: contracts + keeper + dashboard |
| Time model | On-chain settlement window + admin demo override; global `secondsPerDay` scales pricing horizon |
| Vault | Single ERC-4626 pool; tranching is roadmap only |
| Roles in demo | One wallet, role tabs (Holder / LP / Admin) |
| Stack | Foundry (Monad template), Next.js 16, React 19, Tailwind v4, hand-built primitives (no shadcn/ui), wagmi 3, viem, pnpm workspace |
| Wallet | wagmi injected connector, custom connect button, no WalletConnect project ID |
| Network | Monad testnet, chain ID 10143, RPC https://testnet-rpc.monad.xyz, local Anvil for development |
| Demo assets | Five, spanning the report's asset classes: rTBILL (Treasury), rJAAA (institutional fund), rCREDIT (private credit, the headline), rTSLA (equity), rPRIV (registered, NOT eligible) |

## 3. Repository layout

```
redeemnow/
  contracts/          Foundry project
    src/              MockUSDC, MockRWAToken, RWARegistry, LiquidityVault, RedemptionBridge, MockIssuer
    src/lib/          Pricing.sol (pure math), Errors.sol
    test/             unit + fuzz tests
    script/           Deploy.s.sol, Seed.s.sol
  keeper/             TypeScript, viem, tsx. Commands: `settle`, `nav-sim`
  web/                Next.js 16 App Router dashboard
  packages/shared/    chain config, generated ABIs, deployments/<chainId>.json, pricing.ts mirror
  pnpm-workspace.yaml
```

Deploy script writes `contracts/deployments/10143.json` (and `31337.json` for Anvil), mirrored to
`packages/shared/deployments/`. Web and keeper import addresses from there.

## 4. Contracts

Solidity `^0.8.28`, OpenZeppelin v5. All external mutating functions use custom errors,
`ReentrancyGuard` where funds move, and `Pausable` on the bridge.

### 4.1 MockUSDC
ERC20, 6 decimals, `mint(to, amount)` restricted to `MINTER_ROLE` (deployer/admin).

### 4.2 MockRWAToken
ERC20, 18 decimals, `mint` restricted to `MINTER_ROLE`, `burnFrom` restricted to `ISSUER_ROLE`
(granted to MockIssuer). Three instances: rTBILL, rTSLA, rPRIV.

### 4.3 RWARegistry
`AccessControl` with `DEFAULT_ADMIN_ROLE` and `NAV_UPDATER_ROLE`.

```solidity
enum AssetClass { Treasury, GlobalBond, PrivateCredit, InstitutionalFund, Equity, Commodity }

struct Asset {
  address    token;
  address    issuer;
  uint256    navPerToken;        // USD per token, 1e18
  uint64     navUpdatedAt;
  uint32     settlementWindow;   // seconds
  uint16     baseSpreadBps;
  uint16     dailyVolBps;        // 1-day NAV volatility in bps
  uint16     creditBps;          // expected loss on a redemption in flight, bps
  uint16     maxExposureBps;     // cap on this asset's outstanding vs vault total assets
  AssetClass assetClass;
  bool       eligible;           // bridge entity is an eligible redeemer with this issuer
  bool       enabled;
}
uint32 public secondsPerDay;  // 86400 production, 60 demo
```

`creditBps`, `maxExposureBps` and `assetClass` sit between `dailyVolBps` and `eligible`. The struct is
still 4 storage slots — slot 3 uses 23 of its 32 bytes — so adding them cost no extra SSTORE.

`assetClass` is the report's taxonomy, not decoration: it is what lets the dashboard group a book by
what the collateral actually is, and it is the axis along which `creditBps` and `maxExposureBps` are
set. A Treasury and a private-credit fund are not the same trade and should not be presented as one.

Functions: `registerAsset`, `setNav`, `setEligible`, `setEnabled`, `setSettlementWindow`,
`setSecondsPerDay`, `setCredit(token, uint16)`, `setMaxExposure(token, uint16)`, `getAsset`,
`horizonDays(token)` (1e18 fixed point = settlementWindow / secondsPerDay). Both new setters are
`DEFAULT_ADMIN_ROLE` and validate via `InvalidBps`: `creditBps < 10000`, and `maxExposureBps` in
`(0, 10000]` — zero is rejected because a zero cap silently disables an asset that still reads as
enabled, which is the kind of state that gets discovered live. Events for every setter.

### 4.4 LiquidityVault (ERC-4626)
Underlying MockUSDC, shares "RedeemNow USDC" / `rnUSDC`.

State: `idle` (USDC held), `outstanding` (sum of advances at face), `maxUtilisationBps` (9500),
`bridge` (address with `BRIDGE_ROLE`).

- `totalAssets() = idle + outstanding`
- `utilisationBps() = outstanding * 10000 / totalAssets()` (0 if totalAssets is 0)
- `advance(to, amount)` — bridge only; requires `idle >= amount` and post-utilisation `<= max`; `idle -= amount; outstanding += amount`; transfers USDC to `to`.
- `settleReceivable(advanced, proceedsToVault)` — bridge only, USDC already transferred in; `outstanding -= advanced; idle += proceedsToVault`. If `proceedsToVault < advanced` emit `LossRealised`.
- `absorbLoss(advanced)` — bridge only; `outstanding -= advanced` with **no** matching rise in `idle`,
  so `totalAssets` falls and the share price drops for every holder in the same transaction. Reverts
  `LossExceedsOutstanding(advanced, outstanding)` rather than underflowing. Emits `LossAbsorbed`.
- `recoverLoss(recovered)` — bridge only; the mirror, for a workout that pays partially.
- `withdraw`/`redeem` (ERC-4626) limited to `idle`; `maxWithdraw` reflects this.
- Vault is `Pausable`; `PAUSER_ROLE` (admin) pauses deposits, withdrawals and advances.

Share price rises when `proceedsToVault > advanced` and falls when lower, and falls hard on
`absorbLoss`. Spread capture is the only yield mechanism; impairment is the only loss mechanism.

### 4.5 Pricing library (pure)

```
u              = (outstanding + navValue6d) * 10000 / (idle + outstanding)   // utilisation if the full NAV value were advanced (upper bound, avoids circularity)
utilTermBps    = u <= kink ? slope1 * u / kink
                           : slope1 + slope2 * (u - kink) / (10000 - kink)
timeRiskBps    = dailyVolBps * sqrt(horizonDays)          // sqrt in 1e18 fixed point
creditTermBps  = creditBps                                // NOT scaled by horizon — see below
spreadBps      = baseSpreadBps + utilTermBps + timeRiskBps + creditTermBps
navValue       = amount * navPerToken / 1e18              // 1e18 USD
payout(1e18)   = navValue * (10000 - spreadBps) / 10000
payoutUSDC     = payout / 1e12                            // scale to 6 decimals, floor
```

Global curve params on the bridge: `kinkBps = 8000`, `slope1Bps = 20`, `slope2Bps = 200`.
Bridge caps `spreadBps` at 5000 and reverts above.

**Why the credit term is not scaled by the settlement horizon.** Every other risk in this spread is a
price-path risk, so it grows with time and the `sqrt(horizon)` scaling is correct. Default is not.
A redemption that will not be honoured is already not going to be honoured at the moment we front it;
the horizon changes when we find out, not whether it happened. Pro-rating an annual default
probability across a two-day window turns Maple's observed 3.8% realised default rate into roughly
2 bps — arithmetically defensible, economically wrong, and it would price the riskiest asset on the
book at less than its base spread. `creditTermBps` is therefore the identity function, and the
one-line implementation carries that reasoning as a comment so nobody "fixes" it later.

Term-structured PD × LGD is the right long-run model and is listed in §9 as out of scope, not as an
oversight.

Same function mirrored in `packages/shared/pricing.ts` and property-tested against Foundry output.

### 4.6 RedemptionBridge

Roles: `DEFAULT_ADMIN_ROLE`, `DEMO_ADMIN_ROLE`, `PAUSER_ROLE`, `RISK_ADMIN_ROLE`. Config: registry,
vault, usdc, issuer, treasury, `protocolFeeBps = 2500` (share of realised profit), curve params,
`impairAfter` (seconds past the settlement window before a receivable may be written down; 60 in demo).

```solidity
enum Status { Open, Settled, Impaired }   // Open == 0; Impaired APPENDED, never inserted
struct Receivable {
  uint256 id;
  address token;
  address holder;
  uint256 amount;          // RWA tokens, 1e18
  uint256 navAtFront;      // 1e18
  uint256 advanced;        // USDC 6d paid to holder
  uint256 expected;        // USDC 6d = navValue at front, for display
  uint64  openedAt;
  uint64  settleAfter;
  Status  status;
}
```

- `quote(token, amount) → Quote` view. `Quote` carries `navValueWad`, `navValueUsdc`,
  `utilisationBps`, `baseBps`, `utilTermBps`, `timeRiskBps`, `spreadBps`, `payout`, `capacityUsdc`,
  `creditBps`. `creditBps` is **appended last** so no existing field's position moved; every field is
  `uint256` on chain, so every field decodes to `bigint` client-side with no widening.
- `redeem(token, amount, minPayout)`:
  1. asset enabled and `eligible`, else `NotEligibleRedeemer(token)` / `AssetDisabled`.
  2. compute quote (utilisation as defined in 4.5); `payout >= minPayout` else `SlippageExceeded`.
  3. `token.transferFrom(msg.sender, issuer, amount)`; `issuer.requestRedemption(id, token, amount)`.
  4. `vault.advance(msg.sender, payout)`.
  5. store receivable, emit `ReceivableOpened(id, token, holder, amount, navAtFront, advanced, settleAfter)`.
- `settle(id)`: requires `Open`; requires `block.timestamp >= settleAfter` unless caller has
  `DEMO_ADMIN_ROLE` (then emits `DemoOverride(id, caller)`). Calls `issuer.settle(id)` which
  transfers `proceeds` USDC to the bridge. Then:
  - if `proceeds > advanced`: `profit = proceeds - advanced; fee = profit * protocolFeeBps / 10000`;
    transfer `fee` to treasury, transfer `proceeds - fee` to vault, `vault.settleReceivable(advanced, proceeds - fee)`.
  - else: transfer `proceeds` to vault, `vault.settleReceivable(advanced, proceeds)`.
  - emit `ReceivableSettled(id, proceeds, fee, pnl)`.
- `openReceivableIds()` view for the keeper and dashboard (bounded list; fine for demo scale).
- `pause`/`unpause`.

**Per-asset exposure cap.** `mapping(address => uint256) exposureUsdc` tracks USDC advanced against
each token, and `assetExposureCapUsdc(token) = vault.totalAssets() * maxExposureBps / 10000`. The cap
is a fraction of the book rather than an absolute figure, so it grows with LP capital automatically —
and tightens automatically when the book shrinks, including after an impairment. `redeem` checks it
last, after the vault-capacity check, so the more specific error wins:

```
spreadBps > MAX_SPREAD_BPS           -> SpreadTooHigh
payout < minPayout                   -> SlippageExceeded
payout == 0                          -> PayoutTooSmall
payout > capacityUsdc                -> InsufficientCapacity
exposureUsdc[token] + payout > cap   -> ExposureCapExceeded(token, projected, cap)
```

This is the load-bearing risk decision in the protocol. Pricing risk is table stakes; a spread alone
implies every trade is acceptable at some price. A concentration limit says some trades are not
acceptable at any price, which is what a real trading book does and what no other RWA front-end has.

**Impairment.** `markImpaired(id)` — `RISK_ADMIN_ROLE`, `nonReentrant`:

- requires `r.id != 0 && r.status == Open`, else `ReceivableNotOpen(id)`. The `r.id != 0` guard is not
  redundant: `Status.Open` is the enum's zero value, so an id that was never created reads back as
  `{id: 0, status: Open, settleAfter: 0}` and would pass both a naive status check and any
  elapsed-time gate. Three permanent tests cover this.
- requires `block.timestamp > settleAfter + impairAfter`, else `NotYetImpairable(id, impairableAt)`.
- effects before interactions, matching `settle()`: set `Impaired`, remove from the open list, release
  `exposureUsdc[token]` (saturating at zero), then call `vault.absorbLoss(advanced)`.
- emits `ReceivableImpaired(id, token, advanced)`.

`recoverImpaired(id, recoveredUsdc)` — `RISK_ADMIN_ROLE`: requires `Impaired` else `NotImpaired(id)`,
sets `Settled`, pulls `recoveredUsdc` from the caller and routes it to `vault.recoverLoss`, emits
`ReceivableRecovered(id, recoveredUsdc, pnl)`. The workout path, not an undo — the loss stays
recognised in the period it occurred.

`LiquidityVault.absorbLoss(advanced)` is `BRIDGE_ROLE` only and reduces `outstanding` with no matching
rise in `idle`. `totalAssets` therefore falls and **every holder's share price drops in the same
transaction**. That is the point: there is no interval in which an informed LP can withdraw ahead of a
loss the protocol already knows about, so the bank-run incentive does not exist. `recoverLoss` is the
mirror, and reverts `LossExceedsOutstanding` if asked to write off more than is on the book.

### 4.7 MockIssuer
Holds redeemed RWA tokens per request. `requestRedemption` and `settle` callable only by the bridge.
`settle(id)`: burns tokens, computes `proceeds = amount * registry.nav(token) / 1e18 / 1e12`, transfers
USDC to the bridge. Admin `fund(amount)` pulls USDC so it can pay. Reverts `InsufficientIssuerFunds`
if under-funded (surfaced in dashboard as an admin task).

## 5. Keeper package

`keeper settle`: on start, load open receivable IDs; subscribe to `ReceivableOpened` and
`ReceivableSettled`; every 2 s, for each open receivable with `settleAfter <= now`, send `settle(id)`;
on revert log and retry with exponential backoff (max 5 attempts); print tx hash on success.

`keeper nav-sim`: every 10 s, `setNav` on rTBILL at +4%/yr accrual (using `secondsPerDay` so the
demo clock applies) and on rTSLA as a random walk with the asset's `dailyVolBps`. rPRIV untouched.

Config from env: `RPC_URL`, `CHAIN_ID`, `KEEPER_PRIVATE_KEY`. `.env.example` committed, `.env` ignored.
Pure "due" filter isolated in `due.ts` and unit-tested.

## 6. Dashboard (web)

Next.js 16 App Router, React 19, TypeScript, Tailwind v4, shadcn/ui, wagmi v2 + viem, TanStack Query,
Recharts. Wallet: wagmi `injected()` connector, custom connect button, chain switch prompt to 10143.

Routes:
- `/` Overview — stat tiles (TVL, utilisation, outstanding, LP share price / realised yield, protocol
  fees), per-asset live spread, utilisation curve chart with current point, receivable book table
  with countdown and status.
- `/holder` — asset picker, amount input, live quote decomposition (NAV value, base, utilisation
  term, time-risk term, total spread, payout), approve + redeem. rPRIV shows an "issuer eligibility
  pending" badge; attempted redeem shows the decoded revert.
- `/lp` — deposit/withdraw USDC, share price, position value, realised yield since deposit.
- `/admin` — set NAV, set demo clock (`secondsPerDay`), settle now (demo override), mint demo USDC /
  RWA to connected wallet, fund issuer, pause/unpause. Visible only when wallet holds admin role.

Reads poll every 1 s. Custom errors decoded via ABI and shown inline. All amounts formatted from
on-chain integers; no floats in money paths.

Visual direction (applied with the frontend-design skill): dark-first trading-terminal aesthetic
with a supported light theme; OKLCH colour tokens; geometric sans for text, monospace for every
number; numbers tick to new values; dense but breathable layout; mobile-usable.

## 7. Testing

Foundry (`forge test --match-path` per file while iterating):
- `Pricing.t.sol` — fuzz: spread monotonic in utilisation and horizon; payout <= navValue; zero at zero.
- `LiquidityVault.t.sol` — invariant `totalAssets == idle + outstanding`; advance respects max
  utilisation; share price up on profit, down on loss; withdraw bounded by idle.
- `RedemptionBridge.t.sol` — happy path, eligibility revert, disabled revert, slippage revert,
  settle-before-window revert, demo override event, fee split correctness, NAV drop shortfall.
- `MockIssuer.t.sol` — only bridge can call; under-funded revert.

Shared: `pricing.test.ts` compares TS mirror to fixtures generated by a Foundry script.
Keeper: `due.test.ts`. Web: no unit tests in scope beyond shared; manual demo rehearsal.

Per the owner's global rule: never run whole suites unprompted; narrowest test that can fail.

## 8. Deployment and demo

`Deploy.s.sol` deploys USDC, five RWA tokens, registry, vault, issuer and bridge; wires roles;
registers the assets; sets `secondsPerDay = 60` and `impairAfter = 60`; mints 1,500,000 USDC and
10,000 of each RWA to the deployer; funds the issuer with 500,000 USDC; writes the deployments JSON.

The registered book, chosen so the four spread terms visibly do different work on different assets:

| Token | Asset class | NAV | Window | Base | Vol | **Credit** | **Max exposure** | Eligible |
|---|---|---|---|---|---|---|---|---|
| rTBILL | Treasury | 1.0432 | 120 s | 3 | 1 | **2** | 10000 (uncapped) | yes |
| rJAAA | InstitutionalFund | 1.0000 | 120 s | 5 | 8 | **15** | 5000 | yes |
| rCREDIT | PrivateCredit | 1.0850 | 600 s | 15 | 25 | **380** | **800** | yes |
| rTSLA | Equity | 248.50 | 120 s | 15 | 180 | **25** | 8000 | yes |
| rPRIV | PrivateCredit | 1.0000 | 1800 s | 50 | 30 | **500** | 500 | **no** |

`rCREDIT`'s 800 bps cap is deliberately tight enough to bind inside the demo: against a 100,000 book
it is an 8,000 USDC ceiling, which trips at roughly 7,700 tokens — well inside the 10,000 minted. 8%
is also the defensible number for a single private-credit name, so the constraint is honest rather
than staged.

### The demo

**The runbook lives in [`docs/DEMO.md`](../../DEMO.md)** — nine beats, with every figure produced by
running the sequence against the delivered contracts on a fresh Anvil and reading it back with `cast`.

The arc, in one line each: an LP funds 100,000 → rTBILL at **6 bp** (credit 33% of it) → rJAAA at
**32 bp** (47%) → rCREDIT at **476 bp** with **credit 80% of the spread**, the headline →
8,000 rCREDIT **rejected** by the exposure cap → rTSLA at **371 bp** where credit is only **6.7%** and
volatility dominates → rPRIV reverts `NotEligibleRedeemer` → the keeper settles and LPs earn the
spread → the rCREDIT leg is **impaired** and every LP's share price falls in the same transaction,
then a 60% workout partially recovers it.

Two warnings that belong in the spec and not only the runbook:

1. **Spreads and caps are state-dependent.** The exposure cap is a fraction of `totalAssets` and the
   utilisation term depends on what is already outstanding, so a leg quoted against an untouched vault
   gives a different number from the same leg quoted in sequence. Quote figures for a slide must be
   taken from an in-order rehearsal on a fresh chain. (Earlier standalone quotes of 475 bp / 5,167.31
   for rCREDIT and 312 bp / 72,224.04 for rTSLA are the untouched-book numbers and are *not* what the
   demo displays.)
2. **Do not reuse a chain between rehearsals.** Leftover exposure and a grown book silently change
   which steps bind — including whether the exposure cap trips at all.

## 9. Out of scope

Tranching, weekend/holiday calendars, real issuers, KYC, multi-chain, delta hedging, governance,
upgradeability, audits.

Two exclusions are decisions rather than omissions, and each is recorded with the evidence behind it:

**The borrow / LTV primitive.** The strongest signal in the Dune × RWA.xyz 2025 report is that RWA
holders want liquidity *without selling*: **$833M of syrupUSDC — over 30% of supply — is deployed as
DeFi collateral** (Spark $571M, Jupiter $75M, Pendle $57M, Morpho and Kamino $44M each), JTRSY is the
largest single asset supplied on Aave Horizon, and Binance institutions post USYC as derivatives
collateral. Meanwhile **WTGXX sees flows on only 17% of days** — these positions sit still. A borrow
product is therefore the larger market than redemption bridging, and it runs on this same pricing
engine: the spread becomes the LTV haircut and `maxExposureBps` becomes the per-asset debt ceiling.
It is excluded because it needs liquidation machinery and an oracle, which is a second protocol's
worth of work, not because it was overlooked.

**Term-structured PD × LGD**, replacing the flat `creditBps`. See §4.5 for why the flat term is the
right *approximation* at this stage and wrong as a permanent model.

## 10. Market positioning

Recorded here because these four findings are what redirected the project from "instant redemption"
to "liquidity and risk-pricing layer for RWA collateral," and because anyone presenting this needs the
numbers and the honest competitive picture in one place. Source throughout: the Dune × RWA.xyz 2025
RWA report.

**1. Private credit is the market, not treasuries.** Private credit is roughly **2.2× the size** of
tokenized treasuries and runs at **over 90% utilisation**. Treasuries are where the tokenization story
started and where every demo goes; private credit is where the spread, the risk and the volume are.
This is why `rCREDIT` is the headline asset in the demo and why the credit term exists at all.

**2. Default is observed, not hypothetical.** Maple Finance carries **$47M of defaulted loans against
a $1.23B active book — a 3.8% realised default rate.** A protocol that fronts cash against
private-credit redemptions and prices no credit term is not being optimistic, it is being wrong. The
380 bps on `rCREDIT` is calibrated to this figure.

**3. Holders want liquidity without selling.** **$833M of syrupUSDC — over 30% of supply — is deployed
as DeFi collateral** (Spark $571M, Jupiter $75M, Pendle $57M, Morpho and Kamino $44M each); JTRSY is
the largest single asset supplied on Aave Horizon; Binance institutions post USYC as derivatives
collateral. Against that, **WTGXX sees flows on only 17% of days.** The borrow/LTV product is the
larger opportunity and runs on this same engine (§9) — redemption bridging is the wedge, not the
destination.

**4. Nobody has a secondary market for these positions.** Tradable's own report entry lists a
secondary market as "coming soon." That is the infrastructure play: be the venue other protocols price
against, rather than another RWA front-end competing for retail flow.

### What the competition already does — say this before someone in the room does

**Circle's USYC already sells instant redemption for a fee, and it is capacity-limited.** Do not claim
on stage that nobody offers instant RWA redemption; it is false and it is the kind of false that a
well-informed investor corrects out loud.

The honest differentiation is narrower and stronger:

| | USYC / issuer-run instant redemption | RedeemNow |
|---|---|---|
| Who provides the liquidity | The issuer, from its own balance sheet | Third-party LPs, permissionlessly |
| Coverage | One issuer's own fund | Any registered asset, any issuer |
| Price | A posted fee | A four-term spread that moves with utilisation, horizon and credit |
| Concentration control | Internal, opaque | An on-chain per-asset exposure cap that refuses the trade |
| Loss handling | Issuer absorbs, off-chain | `absorbLoss` repriced across all LPs in the same transaction |

The claim to make is not "instant redemption is new." It is: **issuer-run instant redemption does not
scale past the issuer's own balance sheet, and it prices risk by fiat rather than by market.** This is
the same argument market makers make about internalised flow versus a venue, which is the argument
worth making to this audience.
