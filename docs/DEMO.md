# RedeemNow — demo runbook

Five minutes, nine beats. Every number below was produced by running the sequence against the
delivered contracts on a fresh Anvil, in this exact order, and reading the result back with `cast`.
They are not estimates and they are not standalone quotes.

**Read this first: order matters.** The spread depends on utilisation and the per-asset exposure cap
is `totalAssets × maxExposureBps / 10000`, so both move as the book fills. A leg quoted against an
untouched vault gives a *different* number from the same leg quoted in sequence. The figures in this
document are the in-sequence ones — the ones the audience will actually see. Run the steps in order
on a freshly deployed chain, or the numbers on screen will not match the numbers here.

---

## Setup

One command, and it is the one to use before a rehearsal or the real thing:

```bash
./scripts/start.sh --fresh
```

`--fresh` tears down any running chain, restarts Anvil, redeploys, and seeds the 100,000 USDC book —
which is what every figure below assumes. Without `--fresh` the script reuses a running chain and
leaves its state alone, which is right mid-session and **wrong before a demo**, because leftover
exposure changes which steps bind.

It prints the bridge address, the book size and the URLs, and tears down with `./scripts/stop.sh`.

<details>
<summary>The same thing by hand</summary>

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts
anvil --silent &
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
cd .. && pnpm --filter @redeemnow/shared sync   # copies addresses where web and keeper read them
cd web    && pnpm dev                           # http://localhost:3000
cd keeper && pnpm keeper settle                 # continuous mode; there is no `watch` subcommand
```

The deploy writes `contracts/deployments/31337.json`; the sync step copies it to
`packages/shared/deployments/`, which is the path the app actually reads. Skipping the sync is the
usual reason a freshly deployed chain shows no assets in the UI.
</details>

Demo time compression: `secondsPerDay = 60`, so a "2-day" settlement window elapses in 120 seconds
and a "10-day" window in 600. `impairAfter = 60` seconds past the window.

The only key used anywhere is Anvil's well-known account 0. Nothing here touches a real network.

---

## The nine beats

### 1. An LP funds the book

Deposit **100,000 USDC** on the LP page.

| | |
|---|---|
| Total assets | 100,000.00 |
| Share price | 1.000000 |
| Vault capacity (95% utilisation cap) | 95,000.00 |

Per-asset exposure caps, which the Overview page shows as used-vs-cap bars:

| Asset | Cap | As % of book |
|---|---|---|
| rTBILL | 100,000.00 | 100% — effectively uncapped, bounded by vault capacity |
| rJAAA | 50,000.00 | 50% |
| rTSLA | 80,000.00 | 80% |
| rCREDIT | **8,000.00** | **8%** — a single-name private-credit limit |

Say: the vault has one capacity number, but every asset has its own. Credit risk decides how much
we are willing to take, not only what we charge for it.

### 2. Sovereign — 1,000 rTBILL

| | |
|---|---|
| Spread | **6 bp** — base 3, utilisation 0, time 1, **credit 2** |
| Credit's share | **33%** |
| Payout | 1,042.574080 USDC |
| Utilisation after | 104 bp |

Say: *sovereign paper, two basis points of credit.* Show the spread and the instant payout.
**Do not show the LP yield on this leg** — the whole realised profit is 63 cents, of which LPs keep
47 (see beat 8). A cents number on a screen in front of investors reads as a toy.

### 3. One rung up — 5,000 rJAAA

| | |
|---|---|
| Spread | **32 bp** — base 5, utilisation 1, time 11, **credit 15** |
| Credit's share | **47%** |
| Payout | 4,984.00 USDC |
| Utilisation after | 602 bp |

An AAA CLO tranche. Same engine, five times the spread, and credit has gone from a third of it to
nearly half.

### 4. The headline — 5,000 rCREDIT

| | |
|---|---|
| Spread | **476 bp** — base 15, utilisation 2, time 79, **credit 380** |
| Credit's share | **80%** |
| Payout | 5,166.77 USDC |
| Utilisation after | 1,119 bp |

Point at the spread decomposition bar. Four terms, and the violet one is four-fifths of the total.

Say: *Maple Finance carries $47M of defaulted loans against a $1.23B active book — a 3.8% realised
default rate. We price that explicitly instead of asserting it away.* (Source: Dune × RWA.xyz 2025
RWA report.)

### 5. The cap bites — try 8,000 rCREDIT

Reverts:

```
ExposureCapExceeded(rCREDIT, 13431866000, 8000000000)
```

Projected exposure **13,431.87** against an **8,000.00** cap. The vault still has 83,806 of capacity
— this is not a liquidity limit, it is a concentration limit.

Say: *this is the market-maker's point. Every other RWA demo prices risk. None of them refuses the
trade.* After step 4 there is 2,833.23 of rCREDIT headroom left; anything larger is declined no
matter how much idle USDC the vault is holding.

### 6. Same engine, different composition — 300 rTSLA

| | |
|---|---|
| Spread | **371 bp** — base 15, utilisation **77**, time 254, **credit 25** |
| Credit's share | **6.7%** |
| Payout | 71,784.195 USDC |
| Utilisation after | 8,297 bp |

Two things to point at:

- **Credit has collapsed to under 7% of the spread.** Tokenized equity is volatile, not
  credit-impaired, and the time term (254 bp) now dominates. The same four terms, doing completely
  different work.
- **The utilisation term jumped from 2 bp to 77 bp.** This leg's projected utilisation is 8,574 bp,
  which crosses the 8,000 bp kink onto the steep half of the curve. The curve chart moves visibly.

Do not script a larger rTSLA leg: at 248.50 NAV, 2,000 tokens is ~$497k and exceeds capacity.

### 7. The moat — attempt rPRIV

Reverts:

```
NotEligibleRedeemer(rPRIV)
```

Thirty seconds, and the most important thirty seconds in the demo. BUIDL, OUSG, USDY and Superstate
only redeem for KYC'd qualified investors. A protocol that has not done that onboarding cannot front
these assets at all — which is why this is a business with a moat and not a fork.

### 8. The keeper settles — the rTBILL leg

Wait out the 120-second window (or use the Admin page's settle override, which emits `DemoOverride`
on chain rather than hiding the shortcut).

| | Before | After |
|---|---|---|
| Share price | 1.000000 | **1.000004** |
| Total assets | 100,000.00 | 100,000.469440 |

Realised profit **0.625920 USDC**, of which the treasury took 0.156480 (25%) and LPs kept
**0.469440**. This is why beat 2 shows the spread and not the yield — sub-dollar profit is the honest
consequence of a 6 bp spread on $1,043, and it belongs in a footnote, not on a slide.

```bash
cd keeper && pnpm keeper settle --once     # prints the tx hash
```

### 9. Impairment — the part nobody else shows

The rCREDIT leg does not pay. 60 seconds past its window it becomes impairable. From the Admin page
(gated on `RISK_ADMIN_ROLE`), mark it impaired.

| | Before | After |
|---|---|---|
| Share price | 1.000004 | **0.948336** |
| Total assets | 100,000.469440 | 94,833.699440 |

The book falls by **5,166.77** — exactly the amount advanced, to the wei. Two details worth pointing
at on screen:

- **Every LP's share price drops in the same transaction.** Not on a later NAV update, not after a
  governance vote. There is no window in which an informed holder can exit ahead of the loss, so
  there is no first-mover advantage and no run to start.
- **The rCREDIT cap tightens itself to 7,586.70** — 8% of a smaller book. The system de-risks as it
  shrinks, without anyone filing a transaction.

Then show the workout path. `recoverImpaired(id, 3100062000)` — 60 cents on the dollar:

| | |
|---|---|
| Share price | **0.979337** |
| Total assets | 97,933.761440 |

LPs end 2,066.71 down on a 5,166.77 default: a 40% loss given default, recognised when it happened
and recovered when the cash arrived.

---

## Close

One sentence, and it is the whole pitch:

> Credit's share of the spread runs **33% → 47% → 80%** climbing the risk curve, then collapses to
> **under 7%** on equity where volatility takes over. One engine, priced per asset, with a
> concentration limit that refuses the trade and an impairment path that makes every LP eat the loss
> at the same instant.

## If something goes wrong

| Symptom | Cause | Fix |
|---|---|---|
| Numbers do not match this document | The chain is not fresh; caps and utilisation scale with the book | Restart Anvil and redeploy |
| `ExposureCapExceeded` on a leg that should pass | An earlier rehearsal left exposure on the book | Restart Anvil and redeploy |
| `InsufficientIssuerFunds` on settle | Issuer USDC ran out (deploy seeds 500,000) | Call `fund()` on the issuer as admin |
| `NotYetImpairable(id, ts)` | Window + 60s has not elapsed | Wait, or `cast rpc anvil_increaseTime 600` |
| Dashboard shows no assets | `deployments/31337.json` missing or stale | Re-run the deploy script |
| Wallet on the wrong network | — | The app's ChainGuard offers a one-click switch |
