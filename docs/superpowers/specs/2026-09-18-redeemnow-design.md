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
| Stack | Foundry (Monad template), Next.js 16, React 19, Tailwind v4, shadcn/ui, wagmi v2, viem, pnpm workspace |
| Wallet | wagmi injected connector, custom connect button, no WalletConnect project ID |
| Network | Monad testnet, chain ID 10143, RPC https://testnet-rpc.monad.xyz, local Anvil for development |
| Demo assets | rTBILL (eligible, tight spread), rTSLA (eligible, wide spread), rPRIV (registered, NOT eligible) |

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

Deploy script writes `packages/shared/deployments/10143.json` (and `31337.json` for Anvil). Web and
keeper import addresses from there.

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
struct Asset {
  address token;
  address issuer;
  uint256 navPerToken;        // USD per token, 1e18
  uint64  navUpdatedAt;
  uint32  settlementWindow;   // seconds
  uint16  baseSpreadBps;
  uint16  dailyVolBps;        // 1-day NAV volatility in bps
  bool    eligible;           // bridge entity is an eligible redeemer with this issuer
  bool    enabled;
}
uint32 public secondsPerDay;  // 86400 production, 60 demo
```

Functions: `registerAsset`, `setNav`, `setEligible`, `setEnabled`, `setSettlementWindow`,
`setSecondsPerDay`, `getAsset`, `horizonDays(token)` (1e18 fixed point = settlementWindow / secondsPerDay).
Events for every setter.

### 4.4 LiquidityVault (ERC-4626)
Underlying MockUSDC, shares "RedeemNow USDC" / `rnUSDC`.

State: `idle` (USDC held), `outstanding` (sum of advances at face), `maxUtilisationBps` (9500),
`bridge` (address with `BRIDGE_ROLE`).

- `totalAssets() = idle + outstanding`
- `utilisationBps() = outstanding * 10000 / totalAssets()` (0 if totalAssets is 0)
- `advance(to, amount)` — bridge only; requires `idle >= amount` and post-utilisation `<= max`; `idle -= amount; outstanding += amount`; transfers USDC to `to`.
- `settleReceivable(advanced, proceedsToVault)` — bridge only, USDC already transferred in; `outstanding -= advanced; idle += proceedsToVault`. If `proceedsToVault < advanced` emit `LossRealised`.
- `withdraw`/`redeem` (ERC-4626) limited to `idle`; `maxWithdraw` reflects this.
- Vault is `Pausable`; `PAUSER_ROLE` (admin) pauses deposits, withdrawals and advances.

Share price rises when `proceedsToVault > advanced` and falls when lower. This is the only yield mechanism.

### 4.5 Pricing library (pure)

```
u              = (outstanding + navValue6d) * 10000 / (idle + outstanding)   // utilisation if the full NAV value were advanced (upper bound, avoids circularity)
utilTermBps    = u <= kink ? slope1 * u / kink
                           : slope1 + slope2 * (u - kink) / (10000 - kink)
timeRiskBps    = dailyVolBps * sqrt(horizonDays)          // sqrt in 1e18 fixed point
spreadBps      = baseSpreadBps + utilTermBps + timeRiskBps
navValue       = amount * navPerToken / 1e18              // 1e18 USD
payout(1e18)   = navValue * (10000 - spreadBps) / 10000
payoutUSDC     = payout / 1e12                            // scale to 6 decimals, floor
```

Global curve params on the bridge: `kinkBps = 8000`, `slope1Bps = 20`, `slope2Bps = 200`.
Bridge caps `spreadBps` at 5000 and reverts above.

Same function mirrored in `packages/shared/pricing.ts` and property-tested against Foundry output.

### 4.6 RedemptionBridge

Roles: `DEFAULT_ADMIN_ROLE`, `DEMO_ADMIN_ROLE`, `PAUSER_ROLE`. Config: registry, vault, usdc,
issuer, treasury, `protocolFeeBps = 2500` (share of realised profit), curve params.

```solidity
enum Status { Open, Settled }
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

- `quote(token, amount) → (navValue, spreadBps, utilTermBps, timeRiskBps, payout)` view.
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

`Deploy.s.sol`: deploy USDC, three RWA tokens, registry, vault, issuer, bridge; wire roles; register
assets (rTBILL: window 120 s, base 3 bps, vol 1 bps; rTSLA: window 120 s, base 15 bps, vol 180 bps;
rPRIV: eligible=false); `secondsPerDay = 60`; mint 1,000,000 USDC and 10,000 of each RWA to deployer;
fund issuer with 500,000 USDC; write deployments JSON.

Rehearsed demo (5 min): connect → LP deposits 100k USDC → holder redeems 1,000 rTBILL (tight spread)
→ holder redeems 2,000 rTSLA (wide spread; utilisation term visibly rises) → attempt rPRIV (revert:
not eligible) → keeper settles after 120 s (or admin "settle now") → LP share price ticks up, protocol
fees tile increments.

## 9. Out of scope

Tranching, weekend/holiday calendars, real issuers, KYC, multi-chain, delta hedging, governance,
upgradeability, audits.
