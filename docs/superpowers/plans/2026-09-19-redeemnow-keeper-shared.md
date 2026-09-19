# RedeemNow Keeper + Shared Package Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `packages/shared` (chain config, deployment addresses, generated ABIs, a BigInt mirror of the Solidity pricing math) and the `keeper` package (`settle` and `nav-sim` commands), so the Plan 3 dashboard has a typed, tested data layer and the demo settles itself.

**Architecture:** `packages/shared` is a source-only TypeScript workspace package consumed by both `keeper` and `web`. It owns four things: viem chain definitions, a typed deployments loader, wagmi-CLI-generated ABIs, and `pricing.ts` — an exact BigInt reimplementation of `contracts/src/lib/Pricing.sol` validated record-by-record against the 432-record fixture the Foundry script already emitted. `keeper` is a `commander` CLI over viem, with all decision logic pushed into pure functions (`due.ts`) so it is testable without a chain.

**Tech Stack:** TypeScript (version decided empirically in Task 1, Step 1), viem 2.56.8, @wagmi/cli 2.10.0, commander 15.0.0, dotenv 18.0.0, vitest 5.0.1, tsx 4.23.13, pnpm 10.0.0 workspace.

**Spec:** `docs/superpowers/specs/2026-09-18-redeemnow-design.md` (§3 repository layout, §5 keeper, §7 testing)

**Plan:** 2 of 3. Plan 1 (`docs/superpowers/plans/2026-09-18-redeemnow-contracts.md`) is complete: 8 contracts, 64 passing tests, `contracts/deployments/31337.json` and `contracts/fixtures/pricing.json` generated. Plan 3 is the Next.js dashboard.

## Global Constraints

- **DO NOT COMMIT ANY FILES.** No `git add`, no `git commit`, no `git stash`, no branch creation. The user instructed this explicitly and it governs the whole plan. Write files, run tests, report. `git log --oneline | head -1` must still show `53354f8` when you finish.
- **Never run a whole test suite unprompted** (owner's global rule — this is their daily-driver Mac, not CI). Run the narrowest thing that can fail: `pnpm vitest run test/<one-file>.test.ts` or `forge test --match-path test/<One>.t.sol`. A bare `vitest run`, bare `forge test`, or `pnpm -r test` is **forbidden**.
- Foundry is not on `PATH` by default. Every shell that runs `forge`/`cast`/`anvil` must first `export PATH="$PATH:$HOME/.foundry/bin"`.
- pnpm 10.0.0 via corepack. Install with `pnpm install` from the repo root, never `npm install`.
- The only private key permitted anywhere in this repo is the well-known **public** Anvil account 0 key `0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80`. Never generate, paste, or commit any other key. `.env` files are gitignored; only `.env.example` is tracked.
- Money paths use `bigint` end to end. No `Number`, no floats, no `parseFloat` on any amount, NAV, spread, or utilisation value. Formatting for display converts at the very last step only.
- Exact versions: viem `2.56.8`, `@wagmi/cli` `2.10.0`, commander `15.0.0`, dotenv `18.0.0`, vitest `5.0.1`, tsx `4.23.13`. Pin exactly (no `^`).
- Monad testnet: chain id **10143**, RPC `https://testnet-rpc.monad.xyz`, native currency **MON** (18 decimals), explorer `https://testnet.monadexplorer.com`. Anvil: chain id **31337**, RPC `http://127.0.0.1:8545`.
- `packages/shared` ships **source**, not a build artifact. Consumers import TypeScript directly via the `exports` map. No `tsc` build step, no `dist/`.

---

## File Structure

```
packages/shared/
  package.json
  tsconfig.json
  vitest.config.ts
  wagmi.config.ts               # @wagmi/cli foundry plugin -> src/generated.ts
  scripts/sync-deployments.mjs  # contracts/deployments/*.json -> ./deployments/
  deployments/                  # synced, gitignored
  src/
    index.ts                    # public surface
    chains.ts                   # monadTestnet, anvilLocal, byChainId
    deployments.ts              # typed loader + Deployment type
    pricing.ts                  # BigInt mirror of Pricing.sol
    generated.ts                # wagmi-cli output (gitignored)
  test/
    pricing.test.ts             # validates all 432 fixture records
    deployments.test.ts

keeper/
  package.json
  tsconfig.json
  vitest.config.ts
  .env.example
  src/
    config.ts                   # env parsing, fail-fast
    clients.ts                  # viem public + wallet clients
    due.ts                      # PURE: which receivables are settleable
    settle.ts                   # settle loop
    nav-sim.ts                  # NAV accrual + random walk
    index.ts                    # commander CLI
  test/
    due.test.ts
```

**Responsibilities.** `chains.ts` knows nothing about addresses. `deployments.ts` knows nothing about ABIs. `pricing.ts` is pure arithmetic with zero imports. `due.ts` is pure and takes plain data, so the settle loop's decision logic is unit-testable with no RPC. Everything that touches a chain lives in `clients.ts`, `settle.ts`, `nav-sim.ts`.

---

## Task 1: Shared package scaffold, chains, deployments

**Files:**
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`, `packages/shared/vitest.config.ts`, `packages/shared/src/chains.ts`, `packages/shared/src/deployments.ts`, `packages/shared/src/index.ts`, `packages/shared/scripts/sync-deployments.mjs`
- Test: `packages/shared/test/deployments.test.ts`
- Modify: `.gitignore` (append shared's generated paths)

**Interfaces:**
- Consumes: `contracts/deployments/31337.json` (11 keys: `bridge`, `chainId`, `deployer`, `issuer`, `rPRIV`, `rTBILL`, `rTSLA`, `registry`, `treasury`, `usdc`, `vault`).
- Produces, for Tasks 2-5 and all of Plan 3:
  ```ts
  export const monadTestnet: Chain          // id 10143
  export const anvilLocal: Chain            // id 31337
  export const supportedChains: readonly [Chain, ...Chain[]]
  export function chainById(id: number): Chain
  export type Deployment = {
    chainId: number
    bridge: Address; vault: Address; registry: Address; issuer: Address
    usdc: Address; rTBILL: Address; rTSLA: Address; rPRIV: Address
    treasury: Address; deployer: Address
  }
  export function loadDeployment(chainId: number): Deployment
  export const RWA_KEYS: readonly ['rTBILL', 'rTSLA', 'rPRIV']
  ```

- [ ] **Step 1: Decide the TypeScript version empirically**

`typescript@latest` is `7.0.2` — the native port, a major version. Third-party `.d.ts` consumption is where it breaks, and five later tasks depend on the answer. Settle it now with a two-minute probe instead of discovering it in Task 5.

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis
mkdir -p /tmp/tsprobe && cd /tmp/tsprobe
cat > package.json <<'JSON'
{ "name": "tsprobe", "private": true, "type": "module" }
JSON
cat > probe.ts <<'TS'
import { createPublicClient, http, defineChain, type Address, parseAbi } from 'viem'
const c = defineChain({
  id: 10143, name: 'M',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
})
const pc = createPublicClient({ chain: c, transport: http() })
const abi = parseAbi(['function idle() view returns (uint256)'])
const a: Address = '0x0000000000000000000000000000000000000000'
export async function probe(): Promise<bigint> {
  return pc.readContract({ address: a, abi, functionName: 'idle' })
}
TS
cat > tsconfig.json <<'JSON'
{ "compilerOptions": { "strict": true, "target": "ES2022", "module": "preserve",
  "moduleResolution": "bundler", "noEmit": true, "skipLibCheck": true,
  "verbatimModuleSyntax": true, "types": [] } }
JSON
npm i -D typescript@7.0.2 --silent >/dev/null 2>&1
npm i viem@2.56.8 --silent >/dev/null 2>&1
npx tsc --noEmit; echo "TS7 exit: $?"
```

Expected: exit 0. **If exit is non-zero**, re-run the last two lines with `typescript@6.0.2`, then `typescript@5.9.2`, and use the first version that exits 0.

Record the winning version in your report as `TS_VERSION=<x.y.z>`. Use that exact version, pinned, in every `package.json` this plan creates. Delete `/tmp/tsprobe` when done.

- [ ] **Step 2: Write the failing test**

`packages/shared/test/deployments.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { isAddress } from 'viem'
import { anvilLocal, chainById, monadTestnet, supportedChains } from '../src/chains.js'
import { RWA_KEYS, loadDeployment } from '../src/deployments.js'

describe('chains', () => {
  it('defines monad testnet with the right id and currency', () => {
    expect(monadTestnet.id).toBe(10143)
    expect(monadTestnet.nativeCurrency.symbol).toBe('MON')
    expect(monadTestnet.nativeCurrency.decimals).toBe(18)
    expect(monadTestnet.rpcUrls.default.http[0]).toBe('https://testnet-rpc.monad.xyz')
  })

  it('defines anvil at 31337', () => {
    expect(anvilLocal.id).toBe(31337)
    expect(anvilLocal.rpcUrls.default.http[0]).toBe('http://127.0.0.1:8545')
  })

  it('resolves both supported chains by id', () => {
    expect(supportedChains.map((c) => c.id).sort()).toEqual([10143, 31337])
    expect(chainById(10143)).toBe(monadTestnet)
    expect(chainById(31337)).toBe(anvilLocal)
  })

  it('throws on an unknown chain id', () => {
    expect(() => chainById(1)).toThrow(/unsupported chain/i)
  })
})

describe('loadDeployment', () => {
  it('loads the anvil deployment with every address present and checksummed-valid', () => {
    const d = loadDeployment(31337)
    expect(d.chainId).toBe(31337)
    const keys = [
      'bridge', 'vault', 'registry', 'issuer',
      'usdc', 'rTBILL', 'rTSLA', 'rPRIV', 'treasury', 'deployer',
    ] as const
    for (const k of keys) {
      expect(isAddress(d[k]), `${k} = ${d[k]}`).toBe(true)
    }
  })

  it('exposes the three RWA keys in demo order', () => {
    expect(RWA_KEYS).toEqual(['rTBILL', 'rTSLA', 'rPRIV'])
  })

  it('throws a useful error for a chain with no deployment file', () => {
    expect(() => loadDeployment(999)).toThrow(/no deployment for chain 999/i)
  })
})
```

- [ ] **Step 3: Run to verify it fails**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/packages/shared
pnpm vitest run test/deployments.test.ts
```
Expected: FAIL — cannot resolve `../src/chains.js`.

- [ ] **Step 4: Create the package manifest and tsconfig**

`packages/shared/package.json` (substitute your `TS_VERSION` from Step 1):
```json
{
  "name": "@redeemnow/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./chains": "./src/chains.ts",
    "./deployments": "./src/deployments.ts",
    "./pricing": "./src/pricing.ts",
    "./generated": "./src/generated.ts"
  },
  "scripts": {
    "sync": "node scripts/sync-deployments.mjs",
    "abis": "wagmi generate",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "viem": "2.56.8"
  },
  "devDependencies": {
    "@wagmi/cli": "2.10.0",
    "typescript": "TS_VERSION",
    "vitest": "5.0.1"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test", "scripts", "wagmi.config.ts"]
}
```

`packages/shared/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
```

- [ ] **Step 5: Implement chains.ts**

`packages/shared/src/chains.ts`:
```ts
import { defineChain } from 'viem'
import type { Chain } from 'viem'

/// Monad testnet. Reset from genesis on 2026-12-16; supports all opcodes through Cancun.
export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'Monad', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: ['https://testnet-rpc.monad.xyz'] } },
  blockExplorers: {
    default: { name: 'MonadExplorer', url: 'https://testnet.monadexplorer.com' },
  },
  testnet: true,
})

export const anvilLocal = defineChain({
  id: 31337,
  name: 'Anvil',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://127.0.0.1:8545'] } },
  testnet: true,
})

export const supportedChains = [monadTestnet, anvilLocal] as const satisfies readonly [Chain, ...Chain[]]

export function chainById(id: number): Chain {
  const found = supportedChains.find((c) => c.id === id)
  if (!found) {
    throw new Error(
      `unsupported chain ${id}; expected one of ${supportedChains.map((c) => c.id).join(', ')}`,
    )
  }
  return found
}
```

- [ ] **Step 6: Implement deployments.ts and the sync script**

Spec §3 requires consumers to read `packages/shared/deployments/<chainId>.json`, but the reviewed
deploy script writes `contracts/deployments/<chainId>.json`. Do **not** modify the deploy script.
Copy instead, via a sync step both downstream packages depend on.

`packages/shared/scripts/sync-deployments.mjs`:
```js
#!/usr/bin/env node
// Copies contracts/deployments/*.json into packages/shared/deployments/.
// Spec §3 has consumers read from the shared package; Plan 1's reviewed deploy script writes to
// contracts/. Copying keeps both true without touching reviewed Solidity.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../../../contracts/deployments')
const dst = resolve(here, '../deployments')

mkdirSync(dst, { recursive: true })

let copied = 0
for (const f of readdirSync(src)) {
  if (!f.endsWith('.json')) continue
  copyFileSync(join(src, f), join(dst, f))
  console.log(`synced ${f}`)
  copied++
}
if (copied === 0) {
  console.error(`no deployment JSON found in ${src} — run the deploy script first`)
  process.exit(1)
}
```

`packages/shared/src/deployments.ts`:
```ts
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAddress } from 'viem'
import type { Address } from 'viem'

export const RWA_KEYS = ['rTBILL', 'rTSLA', 'rPRIV'] as const
export type RwaKey = (typeof RWA_KEYS)[number]

export type Deployment = {
  chainId: number
  bridge: Address
  vault: Address
  registry: Address
  issuer: Address
  usdc: Address
  treasury: Address
  deployer: Address
} & Record<RwaKey, Address>

const ADDRESS_KEYS = [
  'bridge', 'vault', 'registry', 'issuer', 'usdc', 'treasury', 'deployer', ...RWA_KEYS,
] as const

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../deployments')
const cache = new Map<number, Deployment>()

/// Reads packages/shared/deployments/<chainId>.json. Run `pnpm --filter @redeemnow/shared sync`
/// after any deploy to refresh these files.
export function loadDeployment(chainId: number): Deployment {
  const hit = cache.get(chainId)
  if (hit) return hit

  let raw: string
  try {
    raw = readFileSync(resolve(dir, `${chainId}.json`), 'utf8')
  } catch {
    throw new Error(
      `no deployment for chain ${chainId} at ${dir}/${chainId}.json — ` +
        `run \`pnpm --filter @redeemnow/shared sync\` after deploying`,
    )
  }

  const parsed: unknown = JSON.parse(raw)
  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error(`deployment for chain ${chainId} is not an object`)
  }
  const obj = parsed as Record<string, unknown>

  const out = { chainId } as Deployment
  for (const k of ADDRESS_KEYS) {
    const v = obj[k]
    if (typeof v !== 'string') {
      throw new Error(`deployment for chain ${chainId} is missing "${k}"`)
    }
    out[k] = getAddress(v)
  }

  cache.set(chainId, out)
  return out
}
```

`packages/shared/src/index.ts`:
```ts
export * from './chains.js'
export * from './deployments.js'
export * from './pricing.js'
```
> `pricing.js` arrives in Task 2. Until then `index.ts` will not typecheck — that is expected;
> the tests in this task import from `../src/chains.js` and `../src/deployments.js` directly, not
> from the barrel. Do not create a stub `pricing.ts` to paper over it.

- [ ] **Step 7: Wire the workspace and gitignore**

Append to `.gitignore`:
```
packages/shared/deployments/
packages/shared/src/generated.ts
keeper/.env
web/.next/
web/node_modules/
```

`pnpm-workspace.yaml` already lists `packages/*`, `keeper`, and `web` — do not change it.

Then, from the repo root:
```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis
pnpm install
pnpm --filter @redeemnow/shared sync
```
Expected: `synced 31337.json`.

- [ ] **Step 8: Run to verify it passes**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/packages/shared
pnpm vitest run test/deployments.test.ts
```
Expected: 6 tests pass.

- [ ] **Step 9: Do NOT commit**

Per Global Constraints, no `git add`/`git commit`. Confirm `git log --oneline | head -1` still shows `53354f8` and report the file list instead.

---

## Task 2: BigInt pricing mirror validated against the Solidity fixtures

**Files:**
- Create: `packages/shared/src/pricing.ts`
- Test: `packages/shared/test/pricing.test.ts`

**Interfaces:**
- Consumes: `contracts/fixtures/pricing.json` — 432 records, each
  `{uBps:number, kink:number, slope1:number, slope2:number, utilTerm:number, vol:number, horizonWad:string, timeRisk:number, navWad:string, spread:number, payout:string}`.
  The fixture generator used a constant base spread of **3 bps**, so `spread === 3 + utilTerm + timeRisk` in every record.
- Produces:
  ```ts
  export const BPS = 10_000n
  export const WAD = 10n ** 18n
  export const USDC_SCALE = 10n ** 12n
  export type Curve = { kinkBps: bigint; slope1Bps: bigint; slope2Bps: bigint }
  export function sqrt(n: bigint): bigint
  export function utilisationTermBps(uBps: bigint, c: Curve): bigint
  export function timeRiskBps(dailyVolBps: bigint, horizonDaysWad: bigint): bigint
  export function navValueWad(amount: bigint, navPerToken: bigint): bigint
  export function wadToUsdc(wad: bigint): bigint
  export function projectedUtilisationBps(idle: bigint, outstanding: bigint, proposedUsdc: bigint): bigint
  export function payoutUsdc(navValueWad: bigint, spreadBps: bigint): bigint
  export function spreadBps(a: {baseSpreadBps: bigint; dailyVolBps: bigint}, uBps: bigint, horizonDaysWad: bigint, c: Curve): bigint
  export function horizonDaysWad(settlementWindow: bigint, secondsPerDay: bigint): bigint
  ```

**Why this task matters:** the dashboard quotes a spread before the user signs anything. If this
mirror disagrees with the chain by even one bps, the UI shows a number the contract will not honour.
The fixture comparison is the whole point of the task — it is not optional coverage.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/pricing.test.ts`:
```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BPS,
  USDC_SCALE,
  WAD,
  horizonDaysWad,
  navValueWad,
  payoutUsdc,
  projectedUtilisationBps,
  spreadBps,
  sqrt,
  timeRiskBps,
  utilisationTermBps,
  wadToUsdc,
} from '../src/pricing.js'

type Fixture = {
  uBps: number
  kink: number
  slope1: number
  slope2: number
  utilTerm: number
  vol: number
  horizonWad: string
  timeRisk: number
  navWad: string
  spread: number
  payout: string
}

const FIXTURE_BASE_BPS = 3n // the Foundry generator's constant base spread

const fixtures: Fixture[] = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../contracts/fixtures/pricing.json'),
    'utf8',
  ),
)

describe('sqrt (mirrors OpenZeppelin Math.sqrt, floor rounding)', () => {
  it('matches floor(sqrt(n)) on exact squares and non-squares', () => {
    expect(sqrt(0n)).toBe(0n)
    expect(sqrt(1n)).toBe(1n)
    expect(sqrt(2n)).toBe(1n)
    expect(sqrt(3n)).toBe(1n)
    expect(sqrt(4n)).toBe(2n)
    expect(sqrt(10n)).toBe(3n)
    expect(sqrt(15n)).toBe(3n)
    expect(sqrt(16n)).toBe(4n)
    expect(sqrt(10n ** 36n)).toBe(10n ** 18n)
    expect(sqrt(WAD * WAD - 1n)).toBe(WAD - 1n)
  })

  it('rejects negatives', () => {
    expect(() => sqrt(-1n)).toThrow()
  })
})

describe('fixture parity with Pricing.sol', () => {
  it('loaded all 432 records', () => {
    expect(fixtures).toHaveLength(432)
  })

  it('reproduces utilTerm, timeRisk, spread and payout for every record', () => {
    const mismatches: string[] = []

    for (const [i, f] of fixtures.entries()) {
      const curve = {
        kinkBps: BigInt(f.kink),
        slope1Bps: BigInt(f.slope1),
        slope2Bps: BigInt(f.slope2),
      }
      const horizon = BigInt(f.horizonWad)

      const util = utilisationTermBps(BigInt(f.uBps), curve)
      const risk = timeRiskBps(BigInt(f.vol), horizon)
      const spread = spreadBps(
        { baseSpreadBps: FIXTURE_BASE_BPS, dailyVolBps: BigInt(f.vol) },
        BigInt(f.uBps),
        horizon,
        curve,
      )
      const payout = payoutUsdc(BigInt(f.navWad), spread)

      if (util !== BigInt(f.utilTerm)) mismatches.push(`#${i} utilTerm ${util} != ${f.utilTerm}`)
      if (risk !== BigInt(f.timeRisk)) mismatches.push(`#${i} timeRisk ${risk} != ${f.timeRisk}`)
      if (spread !== BigInt(f.spread)) mismatches.push(`#${i} spread ${spread} != ${f.spread}`)
      if (payout !== BigInt(f.payout)) mismatches.push(`#${i} payout ${payout} != ${f.payout}`)
    }

    expect(mismatches.slice(0, 20)).toEqual([])
    expect(mismatches).toHaveLength(0)
  })
})

describe('pure helpers', () => {
  it('clamps utilisation above 100% to the curve endpoint', () => {
    const c = { kinkBps: 8_000n, slope1Bps: 20n, slope2Bps: 200n }
    expect(utilisationTermBps(10_000n, c)).toBe(220n)
    expect(utilisationTermBps(12_000n, c)).toBe(220n)
    expect(utilisationTermBps(99_999n, c)).toBe(220n)
  })

  it('is monotonic non-decreasing in utilisation across the kink', () => {
    const c = { kinkBps: 8_000n, slope1Bps: 20n, slope2Bps: 200n }
    let prev = -1n
    for (let u = 0n; u <= 10_000n; u += 137n) {
      const v = utilisationTermBps(u, c)
      expect(v >= prev).toBe(true)
      prev = v
    }
  })

  it('treats an empty vault as fully utilised', () => {
    expect(projectedUtilisationBps(0n, 0n, 0n)).toBe(BPS)
    expect(projectedUtilisationBps(0n, 0n, 1_000n)).toBe(BPS)
  })

  it('projects utilisation as (outstanding + proposed) / total', () => {
    // 100k idle, 0 outstanding, propose 74_550 USDC -> 7455 bps
    expect(projectedUtilisationBps(100_000_000_000n, 0n, 74_550_000_000n)).toBe(7_455n)
  })

  it('pays zero when the spread swallows the whole notional', () => {
    expect(payoutUsdc(1_000n * WAD, BPS)).toBe(0n)
    expect(payoutUsdc(1_000n * WAD, BPS + 1n)).toBe(0n)
  })

  it('scales wad to usdc by flooring', () => {
    expect(wadToUsdc(WAD)).toBe(1_000_000n)
    expect(wadToUsdc(USDC_SCALE - 1n)).toBe(0n)
  })

  it('computes nav value at 1e18 scale', () => {
    // 1000 tokens at 1.0432 -> 1043.2
    expect(navValueWad(1_000n * WAD, 1_043_200_000_000_000_000n)).toBe(1_043_200_000_000_000_000_000n)
  })

  it('derives the horizon from the settlement window and the demo clock', () => {
    // 120 s window, 60 s "day" -> 2 days
    expect(horizonDaysWad(120n, 60n)).toBe(2n * WAD)
    // 120 s window, real day -> 0.00138... days
    expect(horizonDaysWad(120n, 86_400n)).toBe(1_388_888_888_888_888n)
  })

  it('reproduces the demo rTBILL leg: 1000 rTBILL at 1.0432, 4 bps spread', () => {
    const c = { kinkBps: 8_000n, slope1Bps: 20n, slope2Bps: 200n }
    const nav = navValueWad(1_000n * WAD, 1_043_200_000_000_000_000n)
    const u = projectedUtilisationBps(100_000_000_000n, 0n, wadToUsdc(nav))
    const spread = spreadBps({ baseSpreadBps: 3n, dailyVolBps: 1n }, u, horizonDaysWad(120n, 60n), c)
    expect(spread).toBe(4n)
    expect(payoutUsdc(nav, spread)).toBe(1_042_782_720n)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/packages/shared
pnpm vitest run test/pricing.test.ts
```
Expected: FAIL — cannot resolve `../src/pricing.js`.

- [ ] **Step 3: Implement pricing.ts**

`packages/shared/src/pricing.ts`:
```ts
/**
 * Exact BigInt mirror of contracts/src/lib/Pricing.sol.
 *
 * Every function here must agree with the Solidity to the wei. The parity test walks all 432
 * records of contracts/fixtures/pricing.json, which the Foundry script PricingFixtures.s.sol
 * generated from the deployed library. If you change anything in this file, that test is the gate.
 *
 * Solidity integer division truncates toward zero; BigInt `/` does the same for non-negative
 * operands, and every value in these paths is non-negative. Do not introduce Number anywhere.
 */

export const BPS = 10_000n
export const WAD = 10n ** 18n
/** 1e18 (wad) -> 1e6 (USDC) */
export const USDC_SCALE = 10n ** 12n

export type Curve = {
  kinkBps: bigint
  slope1Bps: bigint
  slope2Bps: bigint
}

/**
 * Floor integer square root, matching OpenZeppelin Math.sqrt's default Rounding.Floor.
 * Newton's method; converges from above, so the loop exits at floor(sqrt(n)).
 */
export function sqrt(n: bigint): bigint {
  if (n < 0n) throw new Error(`sqrt of negative: ${n}`)
  if (n < 2n) return n
  let x0 = n
  let x1 = (n >> 1n) + 1n
  while (x1 < x0) {
    x0 = x1
    x1 = (x1 + n / x1) >> 1n
  }
  return x0
}

/** Kinked utilisation curve. Values above 100% are clamped, as in Solidity. */
export function utilisationTermBps(uBps: bigint, c: Curve): bigint {
  const u = uBps > BPS ? BPS : uBps
  if (u <= c.kinkBps) {
    return (c.slope1Bps * u) / c.kinkBps
  }
  return c.slope1Bps + (c.slope2Bps * (u - c.kinkBps)) / (BPS - c.kinkBps)
}

/**
 * One standard deviation of NAV movement over the settlement horizon.
 * sqrt(h * 1e18) where h is already 1e18-scaled yields sqrt(h) at 1e18 scale.
 */
export function timeRiskBps(dailyVolBps: bigint, horizonDaysWad: bigint): bigint {
  const sqrtDaysWad = sqrt(horizonDaysWad * WAD)
  return (dailyVolBps * sqrtDaysWad) / WAD
}

/** @returns USD value at 1e18 scale */
export function navValueWad(amount: bigint, navPerToken: bigint): bigint {
  return (amount * navPerToken) / WAD
}

export function wadToUsdc(wad: bigint): bigint {
  return wad / USDC_SCALE
}

/**
 * Utilisation the vault would have if `proposedUsdc` were advanced in full.
 * Returns 10_000 for an empty vault, and may exceed 10_000 — callers must reject that.
 */
export function projectedUtilisationBps(
  idle: bigint,
  outstanding: bigint,
  proposedUsdc: bigint,
): bigint {
  const total = idle + outstanding
  if (total === 0n) return BPS
  return ((outstanding + proposedUsdc) * BPS) / total
}

/** @returns payout in USDC (6 decimals), floored */
export function payoutUsdc(navValueWad: bigint, spreadBps: bigint): bigint {
  if (spreadBps >= BPS) return 0n
  return wadToUsdc((navValueWad * (BPS - spreadBps)) / BPS)
}

/**
 * Total spread, composed exactly as RedemptionBridge.quote() composes it:
 * base + utilisationTerm(u) + dailyVol * sqrt(horizonDays)
 */
export function spreadBps(
  asset: { baseSpreadBps: bigint; dailyVolBps: bigint },
  uBps: bigint,
  horizonDaysWad: bigint,
  c: Curve,
): bigint {
  return (
    asset.baseSpreadBps + utilisationTermBps(uBps, c) + timeRiskBps(asset.dailyVolBps, horizonDaysWad)
  )
}

/** Mirrors RWARegistry.horizonDays: settlementWindow * 1e18 / secondsPerDay. */
export function horizonDaysWad(settlementWindow: bigint, secondsPerDay: bigint): bigint {
  if (secondsPerDay === 0n) throw new Error('secondsPerDay must be non-zero')
  return (settlementWindow * WAD) / secondsPerDay
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/packages/shared
pnpm vitest run test/pricing.test.ts
```
Expected: all tests pass, including the 432-record parity check.

**If the parity test fails:** the mirror is wrong, not the fixtures. The fixtures came from the
reviewed, deployed Solidity. Do not edit `pricing.json`, and do not relax an assertion. Read the
first few mismatch strings — they name the record index and both values — and fix `pricing.ts`.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/packages/shared
pnpm typecheck
```
Expected: clean. `src/index.ts` now resolves, since `pricing.ts` exists.

- [ ] **Step 6: Do NOT commit** — per Global Constraints. Report the file list.

---

## Task 3: Generated ABIs via @wagmi/cli

**Files:**
- Create: `packages/shared/wagmi.config.ts`
- Generated (do not hand-write): `packages/shared/src/generated.ts`

**Interfaces:**
- Consumes: `contracts/out/*.json` — Foundry build artifacts. Requires `forge build` to have run.
- Produces, for Tasks 4-5 and all of Plan 3: one exported ABI const per contract. Confirm the exact
  export names by reading the generated file after Step 3 and record them in your report — Plan 3
  depends on them. Expect the shape `redemptionBridgeAbi`, `liquidityVaultAbi`, `rwaRegistryAbi`,
  `mockIssuerAbi`, `mockUsdcAbi`, `mockRwaTokenAbi`.

- [ ] **Step 1: Ensure the Foundry artifacts exist**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/contracts
export PATH="$PATH:$HOME/.foundry/bin"
forge build
ls out/RedemptionBridge.sol/RedemptionBridge.json
```
Expected: 0 errors, the artifact listed. (Plain `forge build` must work — a Plan 1 fix wave
specifically restructured `PricingFixtures.s.sol` so that it does. If it fails, stop and report;
do not add `via_ir` to `foundry.toml`.)

- [ ] **Step 2: Write the wagmi config**

`packages/shared/wagmi.config.ts`:
```ts
import { defineConfig } from '@wagmi/cli'
import { foundry } from '@wagmi/cli/plugins'

export default defineConfig({
  out: 'src/generated.ts',
  plugins: [
    foundry({
      project: '../../contracts',
      // Artifacts are already built by `forge build`; don't shell out during generation.
      forge: { build: false },
      include: [
        'RedemptionBridge.sol/**',
        'LiquidityVault.sol/**',
        'RWARegistry.sol/**',
        'MockIssuer.sol/**',
        'MockUSDC.sol/**',
        'MockRWAToken.sol/**',
      ],
    }),
  ],
})
```

- [ ] **Step 3: Generate**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/packages/shared
pnpm abis
grep -c 'Abi = ' src/generated.ts
grep -oE 'export const [a-zA-Z]+Abi' src/generated.ts | sort
```
Expected: six `…Abi` consts, one per contract above.

If `@wagmi/cli` rejects `forge: { build: false }` or the `include` glob shape, read
`node_modules/@wagmi/cli/dist/plugins/*.d.ts` for the actual option names rather than guessing, fix
the config, and note the correction in your report.

- [ ] **Step 4: Verify the generated ABI is usable and complete**

Create a throwaway check (delete it afterwards — it is a probe, not a test):
```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/packages/shared
cat > /tmp/abicheck.ts <<'TS'
import { redemptionBridgeAbi, rwaRegistryAbi, liquidityVaultAbi } from './src/generated.js'
const names = (abi: readonly unknown[]) =>
  abi.filter((x: any) => x.type === 'function' || x.type === 'error' || x.type === 'event')
     .map((x: any) => `${x.type}:${x.name}`)
const b = names(redemptionBridgeAbi)
for (const need of [
  'function:quote', 'function:redeem', 'function:settle', 'function:openReceivableIds',
  'function:getReceivable', 'function:maxRedeemable',
  'error:NotEligibleRedeemer', 'error:InsufficientCapacity', 'error:SlippageExceeded',
  'event:ReceivableOpened', 'event:ReceivableSettled', 'event:DemoOverride',
]) {
  if (!b.includes(need)) throw new Error(`bridge ABI missing ${need}`)
}
for (const need of ['function:setNav', 'function:getAsset', 'function:horizonDays', 'function:secondsPerDay', 'function:tokens', 'function:tokenCount']) {
  if (!names(rwaRegistryAbi).includes(need)) throw new Error(`registry ABI missing ${need}`)
}
for (const need of ['function:idle', 'function:outstanding', 'function:capacityUsdc', 'function:totalAssets', 'function:deposit', 'function:withdraw', 'function:convertToAssets']) {
  if (!names(liquidityVaultAbi).includes(need)) throw new Error(`vault ABI missing ${need}`)
}
console.log('abi surface ok')
TS
cp /tmp/abicheck.ts ./abicheck.ts
pnpm tsx abicheck.ts
rm abicheck.ts /tmp/abicheck.ts
```
Expected: `abi surface ok`. (`pnpm tsx` resolves from the workspace root's tsx.)

- [ ] **Step 5: Do NOT commit.** `src/generated.ts` is gitignored (added in Task 1 Step 7); confirm
`git status --short packages/shared` does not list it.

---

## Task 4: Keeper scaffold and the pure `due` filter

**Files:**
- Create: `keeper/package.json`, `keeper/tsconfig.json`, `keeper/vitest.config.ts`, `keeper/.env.example`, `keeper/src/config.ts`, `keeper/src/due.ts`
- Test: `keeper/test/due.test.ts`

**Interfaces:**
- Consumes: `@redeemnow/shared` (`chainById`, `loadDeployment`).
- Produces:
  ```ts
  // due.ts
  export type OpenReceivable = { id: bigint; settleAfter: bigint; status: number }
  export const STATUS_OPEN = 1
  export type Attempt = { attempts: number; nextEligibleAt: number }
  export function isDue(r: OpenReceivable, nowSec: bigint): boolean
  export function backoffMs(attempts: number): number
  export function selectDue(
    receivables: readonly OpenReceivable[],
    nowSec: bigint,
    attempts: ReadonlyMap<bigint, Attempt>,
    nowMs: number,
    maxAttempts?: number,
  ): bigint[]
  // config.ts
  export type KeeperConfig = { rpcUrl: string; chainId: number; privateKey: `0x${string}` }
  export function loadConfig(env?: NodeJS.ProcessEnv): KeeperConfig
  ```

**Design note:** `Status` in `RedemptionBridge.sol` is `{ None, Open, Settled }` — so `Open === 1`.
`openReceivableIds()` already returns only open ids, but `selectDue` re-checks status anyway: the
keeper reads ids and receivables in separate calls, so a settle can land between them.

- [ ] **Step 1: Write the failing test**

`keeper/test/due.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { STATUS_OPEN, backoffMs, isDue, selectDue, type Attempt } from '../src/due.js'
import { loadConfig } from '../src/config.js'

const open = (id: bigint, settleAfter: bigint, status = STATUS_OPEN) => ({ id, settleAfter, status })

describe('isDue', () => {
  it('is due when now has passed settleAfter', () => {
    expect(isDue(open(1n, 100n), 101n)).toBe(true)
  })

  it('is due exactly at settleAfter (the contract uses >=)', () => {
    expect(isDue(open(1n, 100n), 100n)).toBe(true)
  })

  it('is not due before settleAfter', () => {
    expect(isDue(open(1n, 100n), 99n)).toBe(false)
  })

  it('is never due when not open', () => {
    expect(isDue(open(1n, 0n, 2), 10_000n)).toBe(false)
    expect(isDue(open(1n, 0n, 0), 10_000n)).toBe(false)
  })
})

describe('backoffMs', () => {
  it('grows exponentially from 1s and caps at 30s', () => {
    expect(backoffMs(0)).toBe(1_000)
    expect(backoffMs(1)).toBe(2_000)
    expect(backoffMs(2)).toBe(4_000)
    expect(backoffMs(3)).toBe(8_000)
    expect(backoffMs(4)).toBe(16_000)
    expect(backoffMs(5)).toBe(30_000)
    expect(backoffMs(99)).toBe(30_000)
  })
})

describe('selectDue', () => {
  const none = new Map<bigint, Attempt>()

  it('returns due ids in ascending order', () => {
    const ids = selectDue(
      [open(3n, 10n), open(1n, 10n), open(2n, 999n)],
      50n,
      none,
      0,
    )
    expect(ids).toEqual([1n, 3n])
  })

  it('excludes receivables still inside their window', () => {
    expect(selectDue([open(1n, 100n)], 99n, none, 0)).toEqual([])
  })

  it('excludes a receivable whose backoff has not elapsed', () => {
    const attempts = new Map<bigint, Attempt>([[1n, { attempts: 1, nextEligibleAt: 5_000 }]])
    expect(selectDue([open(1n, 10n)], 50n, attempts, 4_999)).toEqual([])
    expect(selectDue([open(1n, 10n)], 50n, attempts, 5_000)).toEqual([1n])
  })

  it('gives up after maxAttempts', () => {
    const attempts = new Map<bigint, Attempt>([[1n, { attempts: 5, nextEligibleAt: 0 }]])
    expect(selectDue([open(1n, 10n)], 50n, attempts, 1_000, 5)).toEqual([])
    expect(selectDue([open(1n, 10n)], 50n, attempts, 1_000, 6)).toEqual([1n])
  })

  it('handles an empty book', () => {
    expect(selectDue([], 50n, none, 0)).toEqual([])
  })
})

describe('loadConfig', () => {
  const good = {
    RPC_URL: 'http://127.0.0.1:8545',
    CHAIN_ID: '31337',
    KEEPER_PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  }

  it('parses a complete env', () => {
    const c = loadConfig(good as NodeJS.ProcessEnv)
    expect(c.chainId).toBe(31337)
    expect(c.rpcUrl).toBe('http://127.0.0.1:8545')
    expect(c.privateKey.startsWith('0x')).toBe(true)
  })

  it('names the missing variable', () => {
    const { RPC_URL: _omit, ...rest } = good
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow(/RPC_URL/)
  })

  it('rejects a non-numeric chain id', () => {
    expect(() => loadConfig({ ...good, CHAIN_ID: 'mainnet' } as NodeJS.ProcessEnv)).toThrow(/CHAIN_ID/)
  })

  it('rejects an unsupported chain id', () => {
    expect(() => loadConfig({ ...good, CHAIN_ID: '1' } as NodeJS.ProcessEnv)).toThrow(/unsupported chain/i)
  })

  it('rejects a malformed private key', () => {
    expect(() => loadConfig({ ...good, KEEPER_PRIVATE_KEY: 'nope' } as NodeJS.ProcessEnv)).toThrow(
      /KEEPER_PRIVATE_KEY/,
    )
  })
})
```

- [ ] **Step 2: Run to verify it fails**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/keeper
pnpm vitest run test/due.test.ts
```
Expected: FAIL — cannot resolve `../src/due.js`.

- [ ] **Step 3: Create the manifest, tsconfig and env example**

`keeper/package.json` (substitute `TS_VERSION` from Task 1 Step 1):
```json
{
  "name": "@redeemnow/keeper",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "bin": { "keeper": "./src/index.ts" },
  "scripts": {
    "keeper": "tsx src/index.ts",
    "settle": "tsx src/index.ts settle",
    "nav-sim": "tsx src/index.ts nav-sim",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@redeemnow/shared": "workspace:*",
    "commander": "15.0.0",
    "dotenv": "18.0.0",
    "viem": "2.56.8"
  },
  "devDependencies": {
    "@types/node": "24.13.5",
    "tsx": "4.23.13",
    "typescript": "TS_VERSION",
    "vitest": "5.0.1"
  }
}
```
> If `@types/node@24.13.5` does not resolve, use the latest `24.x` and note the version used.

`keeper/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

`keeper/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
})
```

`keeper/.env.example`:
```
# Anvil local (default). For Monad testnet use:
#   RPC_URL=https://testnet-rpc.monad.xyz
#   CHAIN_ID=10143
RPC_URL=http://127.0.0.1:8545
CHAIN_ID=31337

# Anvil account 0 — a WELL-KNOWN PUBLIC test key. Never put a real key here.
KEEPER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

- [ ] **Step 4: Implement config.ts**

`keeper/src/config.ts`:
```ts
import { chainById } from '@redeemnow/shared/chains'

export type KeeperConfig = {
  rpcUrl: string
  chainId: number
  privateKey: `0x${string}`
}

function require_(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]
  if (v === undefined || v.trim() === '') {
    throw new Error(`missing required env var ${key} — copy keeper/.env.example to keeper/.env`)
  }
  return v.trim()
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const rpcUrl = require_(env, 'RPC_URL')

  const rawChainId = require_(env, 'CHAIN_ID')
  const chainId = Number(rawChainId)
  if (!Number.isInteger(chainId)) {
    throw new Error(`CHAIN_ID must be an integer, got "${rawChainId}"`)
  }
  chainById(chainId) // throws "unsupported chain <id>" for anything we do not know

  const privateKey = require_(env, 'KEEPER_PRIVATE_KEY')
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('KEEPER_PRIVATE_KEY must be 0x followed by 64 hex characters')
  }

  return { rpcUrl, chainId, privateKey: privateKey as `0x${string}` }
}
```

- [ ] **Step 5: Implement due.ts**

`keeper/src/due.ts`:
```ts
/** RedemptionBridge.Status = { None, Open, Settled } */
export const STATUS_NONE = 0
export const STATUS_OPEN = 1
export const STATUS_SETTLED = 2

export type OpenReceivable = {
  id: bigint
  settleAfter: bigint
  status: number
}

export type Attempt = {
  attempts: number
  /** epoch ms before which we should not retry */
  nextEligibleAt: number
}

const BASE_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
export const DEFAULT_MAX_ATTEMPTS = 5

/**
 * The contract settles when `block.timestamp >= settleAfter`, so the comparison is >=, not >.
 * Using > here would make the keeper skip a receivable for one whole poll tick.
 */
export function isDue(r: OpenReceivable, nowSec: bigint): boolean {
  if (r.status !== STATUS_OPEN) return false
  return nowSec >= r.settleAfter
}

/** 1s, 2s, 4s, 8s, 16s, then flat 30s. */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return BASE_BACKOFF_MS
  const grown = BASE_BACKOFF_MS * 2 ** attempts
  return grown > MAX_BACKOFF_MS ? MAX_BACKOFF_MS : grown
}

/**
 * Pure: which receivable ids should we try to settle on this tick?
 * Ascending id order, so the demo settles in the order the holder created them.
 */
export function selectDue(
  receivables: readonly OpenReceivable[],
  nowSec: bigint,
  attempts: ReadonlyMap<bigint, Attempt>,
  nowMs: number,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): bigint[] {
  const out: bigint[] = []
  for (const r of receivables) {
    if (!isDue(r, nowSec)) continue
    const a = attempts.get(r.id)
    if (a) {
      if (a.attempts >= maxAttempts) continue
      if (nowMs < a.nextEligibleAt) continue
    }
    out.push(r.id)
  }
  return out.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
}
```

- [ ] **Step 6: Install and run to verify it passes**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis
pnpm install
cd keeper
pnpm vitest run test/due.test.ts
```
Expected: 16 tests pass.

- [ ] **Step 7: Do NOT commit.** Report the file list.

---

## Task 5: Keeper `settle` and `nav-sim` commands, verified against Anvil

**Files:**
- Create: `keeper/src/clients.ts`, `keeper/src/settle.ts`, `keeper/src/nav-sim.ts`, `keeper/src/index.ts`
- Test: `keeper/test/navsim.test.ts`

**Interfaces:**
- Consumes: `@redeemnow/shared` (`chainById`, `loadDeployment`, `redemptionBridgeAbi`, `rwaRegistryAbi`), `./config.js`, `./due.js`.
- Produces: the `keeper` CLI — `keeper settle [--interval <ms>] [--once]` and
  `keeper nav-sim [--interval <ms>] [--once]`.

**Spec §5 behaviour, verbatim requirements:**
- `settle`: on start, load open receivable ids; subscribe to `ReceivableOpened` and
  `ReceivableSettled`; every 2 s, for each open receivable with `settleAfter <= now`, send
  `settle(id)`; on revert log and retry with exponential backoff, max 5 attempts; print tx hash on
  success.
- `nav-sim`: every 10 s, `setNav` on rTBILL at +4%/yr accrual (using `secondsPerDay` so the demo
  clock applies) and on rTSLA as a random walk with the asset's `dailyVolBps`. rPRIV untouched.

**Design rulings you should not re-litigate:**
- The event subscription is a *cache invalidation hint*, not the source of truth. Each tick re-reads
  `openReceivableIds()`. Monad's 300 ms blocks plus a 2 s tick make a purely event-driven book a
  liability for a five-minute live demo; a re-read costs one RPC call.
- Use `eth_getLogs` polling (`watchContractEvent` with `poll: true`), not WebSocket filters. The
  Monad testnet RPC is HTTP.
- Simulate before sending (`simulateContract`), so a revert is caught with its decoded custom error
  before it costs gas and before it lands in the book as a failed tx during the demo.
- `nav-sim` must derive accrual from the chain's `secondsPerDay`, not from wall-clock days. At
  `secondsPerDay = 60` the demo clock runs 1440× fast and the T-bill must visibly accrue.

- [ ] **Step 1: Implement clients.ts**

`keeper/src/clients.ts`:
```ts
import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chainById, loadDeployment, type Deployment } from '@redeemnow/shared'
import type { KeeperConfig } from './config.js'

export type Ctx = {
  public: ReturnType<typeof createPublicClient>
  wallet: ReturnType<typeof createWalletClient>
  account: ReturnType<typeof privateKeyToAccount>
  deployment: Deployment
  chainId: number
}

export function makeCtx(cfg: KeeperConfig): Ctx {
  const chain = chainById(cfg.chainId)
  const transport = http(cfg.rpcUrl)
  const account = privateKeyToAccount(cfg.privateKey)

  return {
    public: createPublicClient({ chain, transport }),
    wallet: createWalletClient({ account, chain, transport }),
    account,
    deployment: loadDeployment(cfg.chainId),
    chainId: cfg.chainId,
  }
}

/** Fail fast and loudly if the RPC is unreachable — a silent retry loop wastes demo time. */
export async function assertChainReachable(ctx: Ctx): Promise<void> {
  const id = await ctx.public.getChainId()
  if (id !== ctx.chainId) {
    throw new Error(`RPC reports chain ${id} but CHAIN_ID is ${ctx.chainId}`)
  }
}
```

- [ ] **Step 2: Implement settle.ts**

`keeper/src/settle.ts`:
```ts
import { BaseError, ContractFunctionRevertedError } from 'viem'
import { redemptionBridgeAbi } from '@redeemnow/shared/generated'
import { assertChainReachable, type Ctx } from './clients.js'
import {
  DEFAULT_MAX_ATTEMPTS,
  backoffMs,
  selectDue,
  type Attempt,
  type OpenReceivable,
} from './due.js'

/** Decode a custom Solidity error into something a human can read at 3am. */
function describeRevert(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.reason ?? 'unknown revert'
      const args = revert.data?.args
      return args && args.length > 0 ? `${name}(${args.map(String).join(', ')})` : name
    }
    return err.shortMessage
  }
  return err instanceof Error ? err.message : String(err)
}

async function readBook(ctx: Ctx): Promise<OpenReceivable[]> {
  const bridge = { address: ctx.deployment.bridge, abi: redemptionBridgeAbi } as const

  const ids = await ctx.public.readContract({ ...bridge, functionName: 'openReceivableIds' })
  if (ids.length === 0) return []

  const receivables = await ctx.public.multicall({
    contracts: ids.map((id) => ({ ...bridge, functionName: 'getReceivable', args: [id] } as const)),
    allowFailure: false,
  })

  return receivables.map((r) => ({
    id: r.id,
    settleAfter: r.settleAfter,
    status: Number(r.status),
  }))
}

async function settleOne(ctx: Ctx, id: bigint): Promise<`0x${string}`> {
  const { request } = await ctx.public.simulateContract({
    address: ctx.deployment.bridge,
    abi: redemptionBridgeAbi,
    functionName: 'settle',
    args: [id],
    account: ctx.account,
  })
  const hash = await ctx.wallet.writeContract(request)
  await ctx.public.waitForTransactionReceipt({ hash })
  return hash
}

export type SettleOptions = {
  intervalMs?: number
  once?: boolean
  maxAttempts?: number
}

export async function runSettle(ctx: Ctx, opts: SettleOptions = {}): Promise<void> {
  const intervalMs = opts.intervalMs ?? 2_000
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

  await assertChainReachable(ctx)
  console.log(
    `[settle] chain ${ctx.chainId} bridge ${ctx.deployment.bridge} keeper ${ctx.account.address} ` +
      `interval ${intervalMs}ms maxAttempts ${maxAttempts}`,
  )

  const attempts = new Map<bigint, Attempt>()
  let dirty = true

  // Spec §5: subscribe to the book's lifecycle events. Treated as a hint to re-read promptly;
  // every tick re-reads anyway, so a missed log delays nothing past the next interval.
  const unwatchOpened = ctx.public.watchContractEvent({
    address: ctx.deployment.bridge,
    abi: redemptionBridgeAbi,
    eventName: 'ReceivableOpened',
    poll: true,
    pollingInterval: intervalMs,
    onLogs: (logs) => {
      for (const l of logs) console.log(`[settle] opened #${l.args.id} settleAfter ${l.args.settleAfter}`)
      dirty = true
    },
  })
  const unwatchSettled = ctx.public.watchContractEvent({
    address: ctx.deployment.bridge,
    abi: redemptionBridgeAbi,
    eventName: 'ReceivableSettled',
    poll: true,
    pollingInterval: intervalMs,
    onLogs: (logs) => {
      for (const l of logs) console.log(`[settle] settled #${l.args.id} pnl ${l.args.pnl}`)
      dirty = true
    },
  })

  const stop = () => {
    unwatchOpened()
    unwatchSettled()
  }
  process.once('SIGINT', () => {
    console.log('[settle] stopping')
    stop()
    process.exit(0)
  })

  try {
    for (;;) {
      const book = await readBook(ctx)
      const block = await ctx.public.getBlock()
      const nowMs = Date.now()
      const due = selectDue(book, block.timestamp, attempts, nowMs, maxAttempts)

      if (dirty) {
        console.log(`[settle] book ${book.length} open, ${due.length} due at ts ${block.timestamp}`)
        dirty = false
      }

      for (const id of due) {
        try {
          const hash = await settleOne(ctx, id)
          console.log(`[settle] #${id} settled  tx ${hash}`)
          attempts.delete(id)
          dirty = true
        } catch (err) {
          const prior = attempts.get(id)?.attempts ?? 0
          const next = prior + 1
          const wait = backoffMs(prior)
          attempts.set(id, { attempts: next, nextEligibleAt: Date.now() + wait })
          const giveUp = next >= maxAttempts ? ' (giving up)' : ` retry in ${wait}ms`
          console.error(`[settle] #${id} attempt ${next}/${maxAttempts} failed: ${describeRevert(err)}${giveUp}`)
        }
      }

      if (opts.once) return
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  } finally {
    stop()
  }
}
```

- [ ] **Step 3: Implement nav-sim.ts**

`keeper/src/nav-sim.ts`:
```ts
import { rwaRegistryAbi } from '@redeemnow/shared/generated'
import { assertChainReachable, type Ctx } from './clients.js'

const WAD = 10n ** 18n
const BPS = 10_000n
/** 4% per year, expressed in bps: applied pro-rata per simulated day. */
const TBILL_APY_BPS = 400n

/**
 * Deterministic T-bill accrual. The NAV must rise by 4%/yr of *simulated* time, so the elapsed
 * simulated days come from the chain's secondsPerDay — at the demo's 60 the clock runs 1440x fast
 * and the accrual is actually visible inside a five-minute demo.
 */
export function accrue(nav: bigint, elapsedSeconds: bigint, secondsPerDay: bigint): bigint {
  if (secondsPerDay === 0n) return nav
  // nav * (1 + apy * elapsedDays / 365), all integer, scaled by 1e18 to keep precision
  const elapsedDaysWad = (elapsedSeconds * WAD) / secondsPerDay
  const growthWad = (TBILL_APY_BPS * elapsedDaysWad) / (BPS * 365n)
  return nav + (nav * growthWad) / WAD
}

/**
 * One random-walk step of +/- up to `dailyVolBps` scaled to the elapsed simulated time.
 * `rand` is injected so this is testable; it must return a value in [0, 1).
 */
export function walk(
  nav: bigint,
  dailyVolBps: bigint,
  elapsedSeconds: bigint,
  secondsPerDay: bigint,
  rand: () => number,
): bigint {
  if (secondsPerDay === 0n || dailyVolBps === 0n) return nav
  const elapsedDaysWad = (elapsedSeconds * WAD) / secondsPerDay
  // One sigma over the elapsed window, in bps at wad scale. Scaled linearly in time rather than
  // by sqrt(t): this is a price simulator for the demo, not the pricing path, and a linear scale
  // makes the rTSLA line visibly move at a 60-second demo "day".
  const sigmaBpsWad = dailyVolBps * elapsedDaysWad
  // uniform in [-1, 1)
  const draw = BigInt(Math.round((rand() * 2 - 1) * 1e6))
  const moveBpsWad = (sigmaBpsWad * draw) / 1_000_000n
  const next = nav + (nav * moveBpsWad) / (BPS * WAD)
  // never let a simulated price go to zero or negative
  const floor = nav / 2n
  return next < floor ? floor : next
}

export type NavSimOptions = {
  intervalMs?: number
  once?: boolean
  rand?: () => number
}

export async function runNavSim(ctx: Ctx, opts: NavSimOptions = {}): Promise<void> {
  const intervalMs = opts.intervalMs ?? 10_000
  const rand = opts.rand ?? Math.random

  await assertChainReachable(ctx)

  const registry = { address: ctx.deployment.registry, abi: rwaRegistryAbi } as const
  const secondsPerDay = BigInt(await ctx.public.readContract({ ...registry, functionName: 'secondsPerDay' }))

  console.log(
    `[nav-sim] chain ${ctx.chainId} registry ${ctx.deployment.registry} ` +
      `secondsPerDay ${secondsPerDay} interval ${intervalMs}ms`,
  )

  let last = (await ctx.public.getBlock()).timestamp

  const tick = async () => {
    const now = (await ctx.public.getBlock()).timestamp
    const elapsed = now > last ? now - last : 0n
    last = now
    if (elapsed === 0n) return

    for (const [key, mode] of [
      ['rTBILL', 'accrue'],
      ['rTSLA', 'walk'],
    ] as const) {
      const token = ctx.deployment[key]
      const asset = await ctx.public.readContract({ ...registry, functionName: 'getAsset', args: [token] })
      const nav = asset.navPerToken
      const next =
        mode === 'accrue'
          ? accrue(nav, elapsed, secondsPerDay)
          : walk(nav, BigInt(asset.dailyVolBps), elapsed, secondsPerDay, rand)

      if (next === nav) continue

      const { request } = await ctx.public.simulateContract({
        ...registry,
        functionName: 'setNav',
        args: [token, next],
        account: ctx.account,
      })
      const hash = await ctx.wallet.writeContract(request)
      await ctx.public.waitForTransactionReceipt({ hash })
      console.log(`[nav-sim] ${key} ${nav} -> ${next}  tx ${hash}`)
    }
  }

  process.once('SIGINT', () => {
    console.log('[nav-sim] stopping')
    process.exit(0)
  })

  for (;;) {
    try {
      await tick()
    } catch (err) {
      console.error(`[nav-sim] tick failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (opts.once) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
```

- [ ] **Step 4: Implement the CLI**

`keeper/src/index.ts`:
```ts
#!/usr/bin/env -S npx tsx
import { config as loadDotenv } from 'dotenv'
import { Command } from 'commander'
import { loadConfig } from './config.js'
import { makeCtx } from './clients.js'
import { runSettle } from './settle.js'
import { runNavSim } from './nav-sim.js'

loadDotenv()

const program = new Command()
program.name('keeper').description('RedeemNow keeper: settles receivables and simulates NAV')

program
  .command('settle')
  .description('settle every receivable whose settlement window has elapsed')
  .option('--interval <ms>', 'poll interval in ms', '2000')
  .option('--once', 'run a single tick and exit', false)
  .option('--max-attempts <n>', 'attempts before giving up on a receivable', '5')
  .action(async (o: { interval: string; once: boolean; maxAttempts: string }) => {
    const ctx = makeCtx(loadConfig())
    await runSettle(ctx, {
      intervalMs: Number(o.interval),
      once: o.once,
      maxAttempts: Number(o.maxAttempts),
    })
  })

program
  .command('nav-sim')
  .description('accrue rTBILL at 4%/yr and random-walk rTSLA')
  .option('--interval <ms>', 'tick interval in ms', '10000')
  .option('--once', 'run a single tick and exit', false)
  .action(async (o: { interval: string; once: boolean }) => {
    const ctx = makeCtx(loadConfig())
    await runNavSim(ctx, { intervalMs: Number(o.interval), once: o.once })
  })

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
```

- [ ] **Step 4b: Test the pure NAV simulation math**

`accrue` and `walk` are pure and exported, so they get a test. Injected `rand` makes `walk`
deterministic.

`keeper/test/navsim.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { accrue, walk } from '../src/nav-sim.js'

const WAD = 10n ** 18n
const NAV = 1_043_200_000_000_000_000n // 1.0432

describe('accrue', () => {
  it('leaves NAV untouched when no time has passed', () => {
    expect(accrue(NAV, 0n, 60n)).toBe(NAV)
  })

  it('raises NAV over one simulated day by 4%/365', () => {
    const next = accrue(NAV, 60n, 60n) // one 60-second "day"
    expect(next > NAV).toBe(true)
    // 4%/yr over 1 day = 0.010958...% -> ~1.14e14 wei on a 1.0432 NAV
    expect(next - NAV).toBe((NAV * ((400n * WAD) / (10_000n * 365n))) / WAD)
  })

  it('accrues 365 simulated days to about +4%', () => {
    const next = accrue(NAV, 60n * 365n, 60n)
    const gainBps = ((next - NAV) * 10_000n) / NAV
    expect(gainBps).toBe(400n)
  })

  it('is a no-op when secondsPerDay is zero rather than dividing by zero', () => {
    expect(accrue(NAV, 600n, 0n)).toBe(NAV)
  })

  it('accrues 1440x slower on the production clock than the demo clock', () => {
    const demo = accrue(NAV, 60n, 60n) - NAV
    const prod = accrue(NAV, 60n, 86_400n) - NAV
    expect(demo / prod).toBe(1440n)
  })
})

describe('walk', () => {
  const TSLA = 248_500_000_000_000_000_000n // 248.5
  const VOL = 180n

  it('moves up on a high draw and down on a low draw', () => {
    expect(walk(TSLA, VOL, 60n, 60n, () => 1) > TSLA).toBe(true)
    expect(walk(TSLA, VOL, 60n, 60n, () => 0) < TSLA).toBe(true)
  })

  it('does not move on a median draw', () => {
    expect(walk(TSLA, VOL, 60n, 60n, () => 0.5)).toBe(TSLA)
  })

  it('moves by at most one sigma over one simulated day', () => {
    const up = walk(TSLA, VOL, 60n, 60n, () => 1)
    const movedBps = ((up - TSLA) * 10_000n) / TSLA
    expect(movedBps <= VOL).toBe(true)
  })

  it('is a no-op for a zero-vol asset', () => {
    expect(walk(TSLA, 0n, 60n, 60n, () => 1)).toBe(TSLA)
  })

  it('never falls below half the previous NAV', () => {
    const crashed = walk(TSLA, 100_000n, 60n * 100n, 60n, () => 0)
    expect(crashed).toBe(TSLA / 2n)
  })

  it('is a no-op when secondsPerDay is zero', () => {
    expect(walk(TSLA, VOL, 600n, 0n, () => 1)).toBe(TSLA)
  })
})
```

Run it:
```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/keeper
pnpm vitest run test/navsim.test.ts
```
Expected: 12 tests pass.

If an expectation disagrees with your implementation, re-derive the arithmetic by hand before
touching either side, then report which one was wrong. Do **not** weaken or delete an assertion to
get green.

- [ ] **Step 5: Typecheck**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/keeper
pnpm typecheck
```
Expected: clean. If viem's inferred struct return types fight you (e.g. `r.settleAfter` typed as
`unknown`), fix the typing at the call site — do **not** add `any` or `@ts-expect-error`, and do not
loosen `strict`.

- [ ] **Step 6: Verify against a live Anvil**

This is the real gate for this task. It exercises deploy → redeem → settle end to end.

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis
export PATH="$PATH:$HOME/.foundry/bin"

# 1. A clean chain. If an anvil is already listening on 8545, use it and skip this.
lsof -nP -iTCP:8545 -sTCP:LISTEN >/dev/null 2>&1 || \
  (cd contracts && anvil --chain-id 31337 --block-time 1 > /tmp/anvil.log 2>&1 &) && sleep 3

# 2. Deploy and sync addresses.
cd contracts
cp -n .env.example .env 2>/dev/null || true
forge script script/Deploy.s.sol --rpc-url anvil --broadcast -v
cd ..
pnpm --filter @redeemnow/shared sync
cat packages/shared/deployments/31337.json

# 3. Seed a receivable: LP deposits, holder redeems 1000 rTBILL.
cd contracts
DEPLOYER=$(jq -r .deployer deployments/31337.json)
PK=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
VAULT=$(jq -r .vault deployments/31337.json)
USDC=$(jq -r .usdc deployments/31337.json)
BRIDGE=$(jq -r .bridge deployments/31337.json)
RTBILL=$(jq -r .rTBILL deployments/31337.json)

cast send "$USDC" 'approve(address,uint256)' "$VAULT" \
  115792089237316195423570985008687907853269984665640564039457584007913129639935 \
  --rpc-url anvil --private-key $PK >/dev/null
cast send "$VAULT" 'deposit(uint256,address)' 100000000000 "$DEPLOYER" \
  --rpc-url anvil --private-key $PK >/dev/null
cast send "$RTBILL" 'approve(address,uint256)' "$BRIDGE" \
  115792089237316195423570985008687907853269984665640564039457584007913129639935 \
  --rpc-url anvil --private-key $PK >/dev/null
cast send "$BRIDGE" 'redeem(address,uint256,uint256)' "$RTBILL" 1000000000000000000000 0 \
  --rpc-url anvil --private-key $PK >/dev/null

echo "open ids: $(cast call "$BRIDGE" 'openReceivableIds()(uint256[])' --rpc-url anvil)"
echo "vault total before: $(cast call "$VAULT" 'totalAssets()(uint256)' --rpc-url anvil)"
```

Now confirm the keeper does **not** settle early, then does settle once the window elapses:

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/keeper
cp -n .env.example .env

# a) Not yet due — expect "0 due", no tx.
pnpm keeper settle --once

# b) Advance past the 120 s window and settle.
cast rpc evm_increaseTime 130 --rpc-url http://127.0.0.1:8545 >/dev/null
cast rpc evm_mine --rpc-url http://127.0.0.1:8545 >/dev/null
pnpm keeper settle --once
```

Expected from (b): `[settle] #1 settled  tx 0x…`.

Verify the money moved, matching Plan 1's independently re-derived figure exactly:
```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/contracts
VAULT=$(jq -r .vault deployments/31337.json)
cast call "$VAULT" 'totalAssets()(uint256)' --rpc-url anvil
```
Expected: **`100000312960`** (100,000 USDC deposited + 312,960 wei-USDC of LP profit). Plan 1
verified this figure to the wei: payout 1,042,782,720; proceeds 1,043,200,000; profit 417,280;
fee 104,320; LP P&L +312,960.

If you get a different number, do not adjust anything to match — report the discrepancy with both
figures. A mismatch means either the keeper settled a different receivable or the chain was not
clean, and both are worth knowing.

Finally, exercise `nav-sim` for one tick:
```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/keeper
cast rpc evm_increaseTime 60 --rpc-url http://127.0.0.1:8545 >/dev/null
cast rpc evm_mine --rpc-url http://127.0.0.1:8545 >/dev/null
pnpm keeper nav-sim --once
```
Expected: two lines, `rTBILL <old> -> <higher>` and `rTSLA <old> -> <different>`, each with a tx
hash. rTBILL must strictly increase. rPRIV must not appear.

- [ ] **Step 7: Re-run the pure tests (narrow, one file)**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/keeper
pnpm vitest run test/due.test.ts
```
Expected: still 16 passing. Do not run a bare `vitest run`.

- [ ] **Step 8: Do NOT commit.** Report the file list, the Anvil transcript's key numbers, and the
`TS_VERSION` you settled on in Task 1.

---

## Handoff to Plan 3 (dashboard)

The web app consumes, and must not duplicate:

- `@redeemnow/shared` → `monadTestnet`, `anvilLocal`, `supportedChains`, `chainById`
- `@redeemnow/shared/deployments` → `loadDeployment(chainId)`, `RWA_KEYS`. **Note:** this uses
  `node:fs`, so it is server-only. The web app must read the deployment in a server component (or
  import the JSON directly through Next's bundler) and pass plain addresses to client components —
  do not import `deployments.ts` into a `"use client"` module.
- `@redeemnow/shared/generated` → the six ABI consts, for both reads and custom-error decoding.
- `@redeemnow/shared/pricing` → the validated mirror. Use it for optimistic/local quote previews
  only; the authoritative number for anything the user signs is `bridge.quote()` on chain. Where the
  UI shows a locally computed figure, label it as an estimate.
- `keeper` runs as a separate process during the demo. The dashboard's admin "settle now" button is
  the manual fallback and emits `DemoOverride`.

Carried items Plan 3 must resolve:
- **Minor-1 (parked in Plan 1):** the holder page and the overview tile can show different
  utilisation figures — `quote().utilisationBps` is *projected including this trade*, while
  `vault.utilisationBps()` is *current*. Pick one per surface and label it explicitly.
- Display `quote().capacityUsdc`; demo step 1 depends on the 95,000 figure being visible.
- `maxRedeemable(unknownToken)` **reverts** `AssetNotRegistered` rather than returning 0 (adjudicated
  in Plan 1 as correct). Enumerate assets from the registry via `tokens(i)` / `tokenCount()` so you
  never call it with an unregistered address.
