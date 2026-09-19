# RedeemNow Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `web/` Next.js dashboard — four routes (Overview, Holder, LP, Admin) over the deployed RedeemNow contracts, built to the Apple-system design language, live at 1-second polling — so the five-minute demo in spec §8 can be driven entirely from the browser.

**Architecture:** Next.js 16 App Router. The root layout is a Server Component: it reads deployment addresses off disk (the only server-side work in the app) and hands them to a client `DeploymentProvider`, because `@redeemnow/shared/deployments` uses `node:fs` and cannot cross into a `"use client"` module. Everything below the provider is client-rendered and reads the chain through wagmi. All money is `bigint` from the contract to the last formatting call. One shared `useProtocol()` hook batches the reads every route needs so four surfaces cannot disagree about the same number.

**Tech Stack:** Next.js 16.3.5, React 19.3.0, TypeScript (version from Plan 2's probe), Tailwind CSS 4.3.3 + `@tailwindcss/postcss`, **wagmi 3.7.7** (not v2 — see Global Constraints), viem 2.56.8, TanStack Query 5.103.1, Recharts 3.10.1.

**Spec:** `docs/superpowers/specs/2026-09-18-redeemnow-design.md` (§6 dashboard, §8 demo)

**Design system:** `docs/superpowers/specs/2026-09-19-redeemnow-design-system.md` — **binding for every
visual decision.** Apple's *system* language (Stocks / Wallet / Numbers), not Apple's marketing pages.
Read it before writing a single class name. Where it and this plan disagree on appearance, it wins.

**Plan:** 3 of 3. Plan 1 (contracts) and Plan 2 (`packages/shared` + `keeper`) precede it. Read Plan 2's handoff section before Task 1.

## Global Constraints

- **DO NOT COMMIT ANY FILES.** No `git add`, no `git commit`, no `git stash`, no branch creation. The user instructed this explicitly and it governs every task. `git log --oneline | head -1` must still print `53354f8` when you finish.
- **Never run a whole test suite unprompted** (owner's global rule — daily-driver Mac, not CI). Run the narrowest thing that can fail. A bare `vitest run`, `pnpm -r test`, or `forge test` is **forbidden**. `next build` and `tsc --noEmit` are fine and expected.
- Foundry is not on `PATH`. Any shell running `forge`/`cast`/`anvil` must first `export PATH="$PATH:$HOME/.foundry/bin"`.
- pnpm only, never npm, inside the repo.
- **wagmi 3, not 2.** Spec §6 says "wagmi v2"; the user's implementation-time instruction was "use latest tech stack", which is more recent and more specific. wagmi 3 is a real breaking change — the v2 idioms you may reach for by reflex are gone:
  - `useAccount` is renamed **`useConnection`**. `useAccountEffect` → `useConnectionEffect`. The old names are removed, not deprecated.
  - Mutation hooks (`useConnect`, `useDisconnect`, `useSwitchChain`, `useWriteContract`) return the **whole TanStack mutation object**. Call `.mutate(...)` / `.mutateAsync(...)`; do NOT destructure a named function out of them. `const { connect } = useConnect()` is a v2 idiom and will be `undefined`.
  - `useConnect().connectors` → `useConnectors()`. `useSwitchChain().chains` → `useChains()`.
  - Query hooks (`useReadContract`, `useReadContracts`, `useBalance`, `useWaitForTransactionReceipt`) are **unchanged** from v2: `{ data, isLoading, error }`, and polling is still `query: { refetchInterval: 1000 }`.
  - `createConfig`, `WagmiProvider`, `injected()`, and the SSR cookie-hydration pattern are unchanged.
- **Tailwind 4 is CSS-first.** There is no `tailwind.config.ts`. `@tailwind base/components/utilities` is replaced by a single `@import "tailwindcss";`. Do not create a JS config file, and do not add `postcss-import` or `autoprefixer` — v4 includes both.
- **No shadcn/ui.** Hand-write the primitives (see Task 2). Ruling and rationale are in the plan's Design Rulings section; do not reintroduce it or Radix.
- **`bigint` end to end.** No `Number()`, `parseFloat`, or arithmetic on a float anywhere in a money, NAV, spread, or utilisation path. Formatting converts to a string at the very last step, via integer math only. `Number()` is permitted only for chart pixel coordinates and for values that are already small unsigned integers by construction (a bps figure for an axis tick, an array index).
- **Turbopack is the default** in Next 16 for both `dev` and `build`. Do not add `--turbopack`, and do not add a custom webpack config (that would force `--webpack` and break `next build`).
- **Next 16 async request APIs are enforced.** `cookies()`, `headers()`, and `params`/`searchParams` must be awaited. There is no sync fallback.
- Exact versions, pinned, no `^`: `next` 16.3.5, `react` 19.3.0, `react-dom` 19.3.0, `wagmi` 3.7.7, `viem` 2.56.8, `@tanstack/react-query` 5.103.1, `recharts` 3.10.1, `tailwindcss` 4.3.3, `@tailwindcss/postcss` 4.3.3.
- TypeScript: use the exact version Plan 2's Task 1 probe selected (read `TS_VERSION` from `.superpowers/sdd/2026-09-19-redeemnow-keeper-shared/report-shared.md`). `"strict": true` is **required** by wagmi. `moduleResolution` must be `"bundler"` — the legacy `"node"` value is removed in TypeScript 7.
- Chain support is **testnet only**: Monad testnet 10143 and Anvil 31337. viem also ships `monad` (mainnet, chain 143) — do not add it.

## Design Rulings

Decided before dispatch. Do not re-litigate; if you disagree, implement as written and say so in your report.

1. **No shadcn/ui, hand-write ~7 primitives.** Spec §6 names shadcn/ui, and this deviates. Three reasons: research could not verify the CLI against this exact Next 16 / Tailwind 4 / React 19 / TS 7 combination; this project must be **rebuilt live at a hackathon** where a failing generator costs the event; and the visual direction is a bespoke trading terminal, so shadcn's defaults would be overridden anyway. We need Button, Input, Card, StatTile, Badge, Table, and a nav — no dialog, no popover, nothing that needs Radix's focus management. Cost if wrong: hand-rolled focus states are less polished than Radix's. Accepted.

2. **Two utilisation numbers, both shown, both labelled.** This resolves Plan 1's parked Minor-1. `vault.utilisationBps()` is **current** utilisation; `quote().utilisationBps` is **projected, including the trade being quoted**. They legitimately differ. The Overview tile shows *current* and is labelled "Utilisation". The Holder quote panel shows *projected* and is labelled "Utilisation after this trade", with the current figure beside it as "now". Never display either unlabelled.

3. **The chain is the authority for anything signed.** `packages/shared/pricing.ts` is validated against the Solidity to the wei, but it is still a mirror. Every number the user acts on comes from `bridge.quote()` on chain. The local mirror is used only for the utilisation-curve chart's *shape* (sampling the curve across utilisations the vault is not currently at, which no on-chain call can give you). Label that chart's plotted line as a model of the configured curve, and mark the live point as the real one.

4. **Assets are enumerated from the registry, never hardcoded.** Read `tokenCount()` then `tokens(i)`, then `getAsset(token)` for each. Plan 1 adjudicated that `maxRedeemable(unknownToken)` **reverts** `AssetNotRegistered` rather than returning 0, so calling it with an address that is not registered is a real error — enumerating prevents it.

5. **Admin surfaces are gated on an on-chain role read, not on an address comparison.** Read `hasRole(DEFAULT_ADMIN_ROLE, account)` on the registry and `hasRole(DEMO_ADMIN_ROLE, account)` on the bridge. Hiding the route on a hardcoded address would break the moment the demo runs from a different wallet.

6. **Light is the default; dark is a selected counterpart, not an inversion.** This follows the design
system and Apple's own behaviour: respect `prefers-color-scheme` on first visit, let an explicit toggle
override it, persist that choice in `localStorage` wrapped in try/catch (private windows throw). Both
themes are first-class — every colour step in dark mode was chosen against the dark surface, and the
chart palette was re-validated there. Do not implement dark mode as a filter, an `invert()`, or an
automatic lightness flip.

7. **Numbers are set in the sans face with tabular figures, never in a monospace.** This is what Apple
does in Stocks, Numbers and Wallet, it keeps numerals in the same voice as their labels, and it avoids
the monospace-for-data-labels cliché. Monospace is reserved for addresses and transaction hashes, where
telling `0` from `O` is a real requirement. The `.num` utility therefore sets `font-variant-numeric`,
**not** `font-family`.

8. **Sentence case everywhere. No all-caps labels** — not on stat tiles, not on table headers, not as
eyebrows. Hierarchy comes from size, weight and colour. This applies to every label in Tasks 2 through 6,
including ones whose code below predates this ruling: if you meet `uppercase` in a class list, drop it.

---

## File Structure

```
web/
  package.json
  tsconfig.json
  next.config.ts
  postcss.config.mjs
  vitest.config.ts
  src/
    app/
      layout.tsx            Server Component: reads deployments, mounts providers
      page.tsx              / Overview
      holder/page.tsx
      lp/page.tsx
      admin/page.tsx
      globals.css           @import "tailwindcss" + @theme tokens
    lib/
      wagmi.ts              createConfig + Register augmentation
      deployments.server.ts SERVER ONLY. node:fs. Never imported by a client module.
      format.ts             PURE bigint -> string formatters
      abis.ts               re-exports the generated ABIs under stable local names
    providers/
      providers.tsx         WagmiProvider + QueryClientProvider + DeploymentProvider
      deployment.tsx        client context carrying the address book
      theme.tsx             dark/light class toggle
    hooks/
      useProtocol.ts        batched reads every route needs
      useAssets.ts          registry enumeration + per-asset config/NAV
      useQuote.ts           live bridge.quote() for the holder form
      useTx.ts              write + receipt + decoded custom errors
      useRoles.ts           admin gating
    components/
      ui/                   Button, Input, Card, Badge, StatTile, Table, Spinner
      Nav.tsx
      Num.tsx               monospace tabular number with tick animation
      ConnectButton.tsx
      ChainGuard.tsx        prompts a switch to a supported chain
      UtilisationCurve.tsx  Recharts area + live ReferenceDot
      ReceivableBook.tsx    open receivables with countdown
      TxButton.tsx          write button with pending/confirming/error states
  test/
    format.test.ts
```

**Responsibilities.** `format.ts` is pure and has no imports — it is the only place a bigint becomes a string, and it is the only file in `web/` with unit tests. `deployments.server.ts` is the single server-only module; if any client file imports it the build fails, which is the point. `useProtocol.ts` is the single source of the numbers three routes share, so Overview and LP cannot disagree.

---

## Task 1: Scaffold, theme system, providers

**Files:**
- Create: `web/package.json`, `web/tsconfig.json`, `web/next.config.ts`, `web/postcss.config.mjs`, `web/src/app/globals.css`, `web/src/app/layout.tsx`, `web/src/app/page.tsx`, `web/src/lib/wagmi.ts`, `web/src/lib/deployments.server.ts`, `web/src/lib/abis.ts`, `web/src/providers/providers.tsx`, `web/src/providers/deployment.tsx`, `web/src/providers/theme.tsx`:
```tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'light' | 'dark'
const KEY = 'redeemnow.theme'

const Ctx = createContext<{ theme: Theme; toggle: () => void }>({
  theme: 'light',
  toggle: () => {},
})

/**
 * Apple's behaviour: follow the system preference until the person says otherwise, then
 * remember their choice. Light is the default because that is the system default.
 */
function resolve(): Theme {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // private windows and blocked site data throw; fall through to the system preference
  }
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function apply(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.style.colorScheme = theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>('light')

  useEffect(() => {
    const initial = resolve()
    setTheme(initial)
    apply(initial)

    // Keep following the system while the person has expressed no preference.
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (e: MediaQueryListEvent) => {
      try {
        if (localStorage.getItem(KEY)) return
      } catch {
        // unreadable storage means no stored preference
      }
      const next: Theme = e.matches ? 'dark' : 'light'
      setTheme(next)
      apply(next)
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'light' ? 'dark' : 'light'
      apply(next)
      try {
        localStorage.setItem(KEY, next)
      } catch {
        // non-fatal
      }
      return next
    })
  }, [])

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>
}

export function useTheme() {
  return useContext(Ctx)
}
```

**Also add a pre-paint script to `layout.tsx` so there is no flash of the wrong theme.** It must run
before React hydrates, so it goes in `<head>` via `dangerouslySetInnerHTML` — this is the one
legitimate use of that API in this app:
```tsx
const themeScript = `(function(){try{var s=localStorage.getItem('redeemnow.theme');
var d=s==='dark'||(!s&&matchMedia('(prefers-color-scheme: dark)').matches);
if(d)document.documentElement.classList.add('dark');
document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})()`
```
and in the returned JSX:
```tsx
<head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
```
The `<html>` element must therefore **not** carry a hardcoded `dark` class or `data-theme`.
```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis
grep -E '^TS_VERSION=' .superpowers/sdd/2026-09-19-redeemnow-keeper-shared/report-shared.md
grep -oE 'export const [a-zA-Z]+Abi' packages/shared/src/generated.ts | sort
cat packages/shared/package.json
sed -n '/## Handoff to Plan 3/,$p' docs/superpowers/plans/2026-09-19-redeemnow-keeper-shared.md
```

Write down the TypeScript version and the six exact ABI export names. Every later step uses them.

- [ ] **Step 2: Create the manifest and configs**

`web/package.json` — substitute `TS_VERSION`, and `@types/node`/`@types/react` at their latest matching majors:
```json
{
  "name": "@redeemnow/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@redeemnow/shared": "workspace:*",
    "@tanstack/react-query": "5.103.1",
    "next": "16.3.5",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "recharts": "3.10.1",
    "viem": "2.56.8",
    "wagmi": "3.7.7"
  },
  "devDependencies": {
    "@tailwindcss/postcss": "4.3.3",
    "@types/node": "24.13.5",
    "@types/react": "19.3.1",
    "@types/react-dom": "19.3.1",
    "tailwindcss": "4.3.3",
    "typescript": "TS_VERSION",
    "vitest": "5.0.1"
  }
}
```
If a `@types/*` version does not resolve, take the latest in the same major and note it.

`web/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "preserve",
    "module": "preserve",
    "moduleResolution": "bundler",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "skipLibCheck": true,
    "noEmit": true,
    "allowJs": false,
    "incremental": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["next-env.d.ts", "src", "test", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```
> `verbatimModuleSyntax` is deliberately **omitted** here (unlike the keeper's tsconfig): Next's
> generated type files and JSX runtime do not consistently satisfy it. Do not add it.

`web/next.config.ts`:
```ts
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Turbopack is the default in Next 16 for dev and build. No webpack config — adding one would
  // force `next build --webpack`.
  transpilePackages: ['@redeemnow/shared'],
}

export default nextConfig
```

`web/postcss.config.mjs`:
```js
// Tailwind 4 includes postcss-import and autoprefixer internally. Do not add them.
export default {
  plugins: { '@tailwindcss/postcss': {} },
}
```

`web/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
})
```

- [ ] **Step 3: Write the theme tokens**

The visual direction is set by `docs/superpowers/specs/2026-09-19-redeemnow-design-system.md` and
summarised here: Apple's *system* language applied to institutional credit data. Light default with a
selected dark counterpart, one typeface (the system stack, genuine SF Pro on Apple hardware), numbers
in tabular sans figures rather than a monospace, sentence case throughout, hairlines and material
before shadows, and motion only in response to a user action. The four spread-component colours below
were validated with the dataviz palette checker in both modes — do not substitute a value without
re-running it.

`web/src/app/globals.css`:
```css
@import "tailwindcss";

/* Tailwind 4: drive `dark:` from a class we control, not from the media query alone,
   so an explicit user choice can override the system preference. */
@custom-variant dark (&:where(.dark, .dark *));

@theme {
  /* One family. The demo machine renders genuine SF Pro; Inter is the loaded
     cross-platform fallback with close enough metrics that layout does not shift. */
  --font-sans: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display",
               var(--font-inter), "Helvetica Neue", Arial, sans-serif;
  /* Monospace is for addresses and tx hashes ONLY — never for data labels. */
  --font-mono: ui-monospace, "SF Mono", var(--font-mono-stack), Menlo, monospace;

  /* ---- Surfaces (light) ---- */
  --color-ground:      oklch(0.977 0.0015 264);
  --color-surface:     oklch(1     0      0  );
  --color-surface-2:   oklch(0.958 0.0025 264);  /* wells, table headers, segmented track */
  --color-line:        oklch(0.906 0.004  264);  /* hairline separators */
  --color-line-firm:   oklch(0.858 0.005  264);  /* input borders */

  /* ---- Ink (light) ---- */
  --color-ink:         oklch(0.205 0.012  264);
  --color-ink-dim:     oklch(0.468 0.011  264);
  --color-ink-faint:   oklch(0.632 0.009  264);

  /* ---- Accent: interactive affordances only, never decoration ---- */
  --color-accent:       oklch(0.505 0.168 266);
  --color-accent-hover: oklch(0.448 0.172 266);
  --color-accent-ink:   oklch(0.995 0     0  );
  --color-accent-soft:  oklch(0.955 0.028 266);

  /* ---- Semantic: P&L and pass/fail ONLY. Never a chart series. ---- */
  --color-gain:      oklch(0.545 0.135 152);
  --color-gain-soft: oklch(0.955 0.035 152);
  --color-loss:      oklch(0.545 0.190 25 );
  --color-loss-soft: oklch(0.957 0.036 25 );
  --color-warn:      oklch(0.600 0.130 75 );
  --color-warn-soft: oklch(0.962 0.040 75 );

  /* ---- Spread decomposition: VALIDATED categorical palette, fixed order.
     Passed all six dataviz checks in both modes. Do not substitute a value
     without re-running scripts/validate_palette.js. ---- */
  --color-term-base:   #4C7EF3;  /* protocol operating floor */
  --color-term-util:   #A96500;  /* utilisation — amber because utilisation is heat */
  --color-term-time:   #0E9AA7;  /* volatility over the horizon */
  --color-term-credit: #8E44C9;  /* expected loss. VIOLET, never red: credit is a
                                    premium earned, not a loss taken. */

  /* ---- Shape: radius encodes hierarchy ---- */
  --radius-control: 8px;
  --radius-card:    14px;
  --radius-sheet:   20px;

  /* ---- Motion: Apple's curve, short, action-triggered only ---- */
  --ease-std:  cubic-bezier(0.32, 0.72, 0, 1);
  --dur-fast:  140ms;
  --dur-std:   220ms;
}

/* Dark steps are SELECTED against the dark surface, not an inversion of light. */
.dark {
  --color-ground:      oklch(0.178 0.006 264);
  --color-surface:     oklch(0.216 0.008 264);
  --color-surface-2:   oklch(0.258 0.009 264);
  --color-line:        oklch(0.305 0.010 264);
  --color-line-firm:   oklch(0.372 0.011 264);

  --color-ink:         oklch(0.968 0.003 264);
  --color-ink-dim:     oklch(0.722 0.010 264);
  --color-ink-faint:   oklch(0.566 0.010 264);

  --color-accent:       oklch(0.672 0.158 266);
  --color-accent-hover: oklch(0.730 0.148 266);
  --color-accent-ink:   oklch(0.165 0.020 266);
  --color-accent-soft:  oklch(0.292 0.058 266);

  --color-gain:      oklch(0.730 0.150 152);
  --color-gain-soft: oklch(0.278 0.050 152);
  --color-loss:      oklch(0.680 0.185 25 );
  --color-loss-soft: oklch(0.288 0.062 25 );
  --color-warn:      oklch(0.775 0.140 75 );
  --color-warn-soft: oklch(0.300 0.055 75 );

  /* Re-validated against the dark surface — not the light values lightened. */
  --color-term-base:   #5A87F0;
  --color-term-util:   #BD8620;
  --color-term-time:   #17A3AB;
  --color-term-credit: #9E63D2;
}

html { background-color: var(--color-ground); }

body {
  background-color: var(--color-ground);
  color: var(--color-ink);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 22px;
  letter-spacing: -0.004em;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

/* Numbers wear TABULAR FIGURES IN THE SANS FACE — not a monospace family.
   This is Apple's own treatment in Stocks, Numbers and Wallet: numerals stay in
   the same voice as their labels, and columns still align. */
.num {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum" 1;
}

/* Reserved for addresses and transaction hashes, where 0-vs-O matters. */
.hash {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

/* Type scale — Apple's named roles, adapted down for dashboard density.
   Tracking tightens as size grows, mimicking optical sizing. */
.t-large-title { font-size: 32px; line-height: 38px; font-weight: 600; letter-spacing: -0.021em; }
.t-title-2     { font-size: 22px; line-height: 28px; font-weight: 600; letter-spacing: -0.017em; }
.t-title-3     { font-size: 17px; line-height: 22px; font-weight: 600; letter-spacing: -0.011em; }
.t-body        { font-size: 15px; line-height: 22px; font-weight: 400; letter-spacing: -0.004em; }
.t-callout     { font-size: 14px; line-height: 20px; font-weight: 400; letter-spacing: -0.003em; }
.t-footnote    { font-size: 13px; line-height: 18px; font-weight: 400; }
.t-caption     { font-size: 12px; line-height: 16px; font-weight: 400; }
.t-metric      { font-size: 28px; line-height: 32px; font-weight: 590; letter-spacing: -0.02em;
                 font-variant-numeric: tabular-nums; }
.t-metric-lg   { font-size: 40px; line-height: 44px; font-weight: 600; letter-spacing: -0.024em;
                 font-variant-numeric: tabular-nums; }

/* Elevation: hairline first, shadow second. Two levels only. */
.elev-1 { box-shadow: 0 1px 2px oklch(0.2 0.01 264 / 0.05),
                      0 0 0 0.5px oklch(0.2 0.01 264 / 0.045); }
.elev-2 { box-shadow: 0 4px 16px oklch(0.2 0.01 264 / 0.07),
                      0 1px 3px oklch(0.2 0.01 264 / 0.05); }
/* Shadows do not read on dark surfaces — use an inset hairline highlight instead. */
.dark .elev-1 { box-shadow: inset 0 0 0 0.5px oklch(1 0 0 / 0.07); }
.dark .elev-2 { box-shadow: inset 0 0 0 0.5px oklch(1 0 0 / 0.09),
                            0 8px 24px oklch(0 0 0 / 0.35); }

/* The one Apple signature worth keeping: a translucent, blurred nav. */
.material-bar {
  background-color: color-mix(in oklch, var(--color-ground) 72%, transparent);
  backdrop-filter: saturate(180%) blur(20px);
  -webkit-backdrop-filter: saturate(180%) blur(20px);
}

/* Focus is always visible. Never `outline: none` without a replacement. */
:where(a, button, input, select, [tabindex]):focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 2px;
  border-radius: var(--radius-control);
}

/* A polled value changed. One-shot, not a loop. */
@keyframes value-settle {
  from { background-color: var(--color-accent-soft); }
  to   { background-color: transparent; }
}
.tick { animation: value-settle var(--dur-std) var(--ease-std); border-radius: 4px; }

@media (prefers-reduced-motion: reduce) {
  .tick { animation: none; }
  *, *::before, *::after { transition-duration: 0.01ms !important; animation-duration: 0.01ms !important; }
}
```

- [ ] **Step 4: Implement the wagmi config**

`web/src/lib/wagmi.ts`:
```ts
import { cookieStorage, createConfig, createStorage, http } from 'wagmi'
import { anvil, monadTestnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

declare module 'wagmi' {
  interface Register {
    config: ReturnType<typeof getConfig>
  }
}

export function getConfig() {
  return createConfig({
    chains: [monadTestnet, anvil],
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
    connectors: [injected()],
    transports: {
      [monadTestnet.id]: http(),
      [anvil.id]: http(),
    },
  })
}
```
> `wagmi/chains` re-exports viem's chains, and viem 2.56.8 ships both of these with the correct RPC
> URLs already (`https://testnet-rpc.monad.xyz`, `http://127.0.0.1:8545`). Do not hand-define them.

- [ ] **Step 5: Implement the server-only deployment reader and its client context**

`web/src/lib/deployments.server.ts`:
```ts
import 'server-only'
import { loadDeployment, supportedChains, type Deployment } from '@redeemnow/shared'

/**
 * Reads every deployment file that exists. A chain with no deployment is omitted rather than
 * fatal: 10143.json only appears once someone has actually deployed to Monad testnet, and the
 * local demo must still run before that happens.
 */
export function getDeployments(): Record<number, Deployment> {
  const out: Record<number, Deployment> = {}
  for (const chain of supportedChains) {
    try {
      out[chain.id] = loadDeployment(chain.id)
    } catch {
      // no deployment for this chain yet
    }
  }
  return out
}
```

`web/src/providers/deployment.tsx`:
```tsx
'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useConnection } from 'wagmi'
import type { Deployment } from '@redeemnow/shared'

const Ctx = createContext<Record<number, Deployment>>({})

export function DeploymentProvider({
  value,
  children,
}: {
  value: Record<number, Deployment>
  children: ReactNode
}) {
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useDeployments(): Record<number, Deployment> {
  return useContext(Ctx)
}

/** The deployment for the connected chain, or undefined if that chain has none. */
export function useMaybeDeployment(): Deployment | undefined {
  const all = useContext(Ctx)
  const { chainId } = useConnection()
  return chainId === undefined ? undefined : all[chainId]
}

/**
 * Same, but throws. Use inside components that only render behind <ChainGuard/>, so the
 * non-null case is guaranteed and callers are not littered with optional chaining.
 */
export function useDeployment(): Deployment {
  const d = useMaybeDeployment()
  if (!d) throw new Error('no deployment for the connected chain')
  return d
}
```

- [ ] **Step 6: Implement the theme provider**

`web/src/providers/theme.tsx`:
```tsx
'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'

type Theme = 'dark' | 'light'
const KEY = 'redeemnow.theme'

const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: 'dark', toggle: () => {} })

function read(): Theme {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch {
    // private windows and blocked site data throw; dark is the default anyway
    return 'dark'
  }
}

function apply(theme: Theme) {
  const root = document.documentElement
  root.classList.toggle('dark', theme === 'dark')
  root.dataset.theme = theme
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Dark on the server and on first paint, so there is no light flash before hydration.
  const [theme, setTheme] = useState<Theme>('dark')

  useEffect(() => {
    const initial = read()
    setTheme(initial)
    apply(initial)
  }, [])

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next: Theme = prev === 'dark' ? 'light' : 'dark'
      apply(next)
      try {
        localStorage.setItem(KEY, next)
      } catch {
        // non-fatal
      }
      return next
    })
  }, [])

  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>
}

export function useTheme() {
  return useContext(Ctx)
}
```

- [ ] **Step 7: Implement the provider stack and the root layout**

`web/src/providers/providers.tsx`:
```tsx
'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { WagmiProvider, type State } from 'wagmi'
import type { Deployment } from '@redeemnow/shared'
import { getConfig } from '@/lib/wagmi'
import { DeploymentProvider } from './deployment'
import { ThemeProvider } from './theme'

export function Providers({
  children,
  initialState,
  deployments,
}: {
  children: ReactNode
  initialState: State | undefined
  deployments: Record<number, Deployment>
}) {
  const [config] = useState(() => getConfig())
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Reads poll on an explicit refetchInterval per hook; keep values fresh but do not
            // hammer the RPC on every remount.
            staleTime: 500,
            retry: 1,
          },
        },
      }),
  )

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <DeploymentProvider value={deployments}>
          <ThemeProvider>{children}</ThemeProvider>
        </DeploymentProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
```

`web/src/app/layout.tsx`:
```tsx
import type { Metadata } from 'next'
import { Inter, JetBrains_Mono } from 'next/font/google'
import { headers } from 'next/headers'
import type { ReactNode } from 'react'
import { cookieToInitialState } from 'wagmi'
import { getDeployments } from '@/lib/deployments.server'
import { getConfig } from '@/lib/wagmi'
import { Providers } from '@/providers/providers'
import { Nav } from '@/components/Nav'
import './globals.css'

// Inter is the cross-platform fallback only — on Apple hardware the stack in globals.css
// resolves to genuine SF Pro first. JetBrains Mono is for hashes and addresses only.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-stack', display: 'swap' })

const themeScript = `(function(){try{var s=localStorage.getItem('redeemnow.theme');`
  + `var d=s==='dark'||(!s&&matchMedia('(prefers-color-scheme: dark)').matches);`
  + `if(d)document.documentElement.classList.add('dark');`
  + `document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})()`

export const metadata: Metadata = {
  title: 'RedeemNow',
  description: 'Instant liquidity for tokenized RWAs — exit at NAV in one block.',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Next 16: headers() must be awaited.
  const initialState = cookieToInitialState(getConfig(), (await headers()).get('cookie'))
  const deployments = getDeployments()

  return (
    <html lang="en" className={`${inter.variable} ${mono.variable}`} suppressHydrationWarning>
      {/* Sets the theme class before first paint so there is no flash of the wrong theme. */}
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="min-h-dvh bg-ground text-ink antialiased">
        <Providers initialState={initialState} deployments={deployments}>
          <Nav />
          <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  )
}
```

- [ ] **Step 8: Implement the ABI re-export shim**

This is the one place the generated names are referenced, so a casing surprise from `@wagmi/cli`
is fixed in a single file instead of across twenty imports.

`web/src/lib/abis.ts`:
```ts
// Re-export the wagmi-cli generated ABIs under stable local names.
// IMPORTANT: the right-hand side must match packages/shared/src/generated.ts EXACTLY. The CLI's
// camelCasing of acronym-heavy contract names (RWARegistry, MockUSDC, MockRWAToken) is not
// something to guess — run:
//   grep -oE 'export const [a-zA-Z]+Abi' packages/shared/src/generated.ts | sort
// and use what it prints.
export {
  redemptionBridgeAbi as bridgeAbi,
  liquidityVaultAbi as vaultAbi,
  rwaRegistryAbi as registryAbi,
  mockIssuerAbi as issuerAbi,
  mockUsdcAbi as usdcAbi,
  mockRwaTokenAbi as rwaAbi,
} from '@redeemnow/shared/generated'
```
Fix the left-hand identifiers to the real generated names if they differ. Do not rename anything in
`packages/shared` to match this file.

- [ ] **Step 9: A minimal Nav and Overview so the app builds**

`web/src/components/Nav.tsx`:
```tsx
'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ConnectButton } from './ConnectButton'
import { useTheme } from '@/providers/theme'

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/holder', label: 'Holder' },
  { href: '/lp', label: 'LP' },
  { href: '/admin', label: 'Admin' },
] as const

export function Nav() {
  const path = usePathname()
  const { theme, toggle } = useTheme()

  return (
    <header className="material-bar sticky top-0 z-20 border-b border-line">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-6 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-[15px] font-semibold tracking-tight">RedeemNow</span>
          <span className="hidden text-[11px] text-ink-faint sm:inline">
            instant RWA redemption
          </span>
        </Link>

        <nav className="order-3 -mx-1 flex w-full gap-1 overflow-x-auto sm:order-none sm:w-auto">
          {LINKS.map((l) => {
            const active = l.href === '/' ? path === '/' : path.startsWith(l.href)
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`shrink-0 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                  active
                    ? 'bg-surface-2 font-medium text-ink'
                    : 'text-ink-dim hover:bg-surface hover:text-ink'
                }`}
              >
                {l.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink"
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <ConnectButton />
        </div>
      </div>
    </header>
  )
}
```

`web/src/components/ConnectButton.tsx` — note the wagmi 3 mutation-object shape:
```tsx
'use client'

import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function ConnectButton() {
  const { address, isConnected } = useConnection()
  const connect = useConnect()
  const disconnect = useDisconnect()
  const connectors = useConnectors()
  const injectedConnector = connectors.find((c) => c.type === 'injected') ?? connectors[0]

  if (isConnected && address) {
    return (
      <button
        type="button"
        onClick={() => disconnect.mutate({})}
        className="num rounded-md border border-line bg-surface px-3 py-1.5 text-[12px] text-ink-dim hover:text-ink"
        title="Disconnect"
      >
        {short(address)}
      </button>
    )
  }

  return (
    <button
      type="button"
      disabled={connect.isPending || !injectedConnector}
      onClick={() => injectedConnector && connect.mutate({ connector: injectedConnector })}
      className="rounded-md bg-accent px-3 py-1.5 text-[12px] font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-50"
    >
      {connect.isPending ? 'Connecting…' : 'Connect wallet'}
    </button>
  )
}
```

`web/src/app/page.tsx` — a placeholder that Task 4 replaces wholesale:
```tsx
export default function OverviewPage() {
  return (
    <section className="py-10">
      <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
      <p className="mt-2 text-[13px] text-ink-dim">Built in Task 4.</p>
    </section>
  )
}
```

- [ ] **Step 10: Install, typecheck, build**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis
pnpm install
cd web
pnpm typecheck
pnpm build
```
Expected: typecheck clean, `next build` succeeds.

**Known failure modes and what to do:**
- *`loadDeployment` / `node:fs` pulled into a client bundle* → something under a `'use client'` file imported `deployments.server.ts` or the `@redeemnow/shared` barrel (the barrel re-exports `deployments.ts`, which uses `node:fs`). Client modules must import `@redeemnow/shared/chains` or `@redeemnow/shared/pricing` directly, **never** the barrel. Fix the import, do not add a webpack/Turbopack alias or a polyfill.
- *`Register` declaration merging fails under TypeScript 7* → this was flagged UNVERIFIED in research. If `declare module 'wagmi'` does not take effect, drop the augmentation block and pass `config` explicitly to hooks instead. Report it; it affects every later task.
- *`next/font/google` cannot reach the network* → replace the two font imports with a plain system stack in `globals.css` (`--font-sans: ui-sans-serif, system-ui, sans-serif`) and drop the `variable` classes from `<html>`. Report the substitution.

- [ ] **Step 11: See it render**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/web
pnpm dev
```
Fetch `http://localhost:3000` and confirm: HTTP 200, the nav renders, the page is dark, no console
errors. Then stop the dev server. Report what you saw.

- [ ] **Step 12: Do NOT commit.** Confirm `git log --oneline | head -1` is `53354f8`.

---

## Task 2: Formatters and UI primitives

**Files:**
- Create: `web/src/lib/format.ts`, `web/src/components/Num.tsx` — the number component, used for every figure in the app:
```tsx
'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A figure in the sans face with TABULAR FIGURES — deliberately not a monospace family.
 * Apple sets numerals this way in Stocks, Numbers and Wallet: columns still align, but the
 * numbers stay in the same typographic voice as their labels. A monospace face here would
 * read as a terminal, which is the opposite of this product's register.
 *
 * Flashes once when the value changes, which is what makes a 1-second polling dashboard
 * feel live. One-shot, never looping, and disabled under prefers-reduced-motion.
 */
export function Num({
  children,
  className = '',
  tone = 'default',
  size = 'body',
}: {
  children: string
  className?: string
  tone?: 'default' | 'dim' | 'faint' | 'gain' | 'loss' | 'warn' | 'accent'
  size?: 'caption' | 'footnote' | 'body' | 'metric' | 'metric-lg'
}) {
  const [flash, setFlash] = useState(false)
  const prev = useRef(children)

  useEffect(() => {
    if (prev.current === children) return
    prev.current = children
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 240)
    return () => clearTimeout(t)
  }, [children])

  const tones = {
    default: 'text-ink',
    dim: 'text-ink-dim',
    faint: 'text-ink-faint',
    gain: 'text-gain',
    loss: 'text-loss',
    warn: 'text-warn',
    accent: 'text-accent',
  } as const

  const sizes = {
    caption: 't-caption num',
    footnote: 't-footnote num',
    body: 't-body num',
    metric: 't-metric',
    'metric-lg': 't-metric-lg',
  } as const

  return (
    <span className={`${sizes[size]} ${tones[tone]} ${flash ? 'tick' : ''} ${className}`}>
      {children}
    </span>
  )
}

/** An address or transaction hash. The ONE place a monospace face is correct. */
export function Hash({ value, chars = 6 }: { value: string; chars?: number }) {
  return (
    <span className="hash t-footnote text-ink-dim" title={value}>
      {value.length > chars * 2 + 2 ? `${value.slice(0, chars)}…${value.slice(-4)}` : value}
    </span>
  )
}
```tsx
'use client'

import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-accent text-accent-ink hover:bg-accent-hover',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-2',
  ghost: 'text-ink-dim hover:bg-surface hover:text-ink',
  danger: 'border border-loss/40 bg-loss-soft text-loss hover:border-loss/70',
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: {
  children: ReactNode
  variant?: Variant
  size?: 'sm' | 'md'
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const sizes = { sm: 'px-2.5 py-1.5 text-[12px]', md: 'px-4 py-2.5 text-[13px]' } as const
  return (
    <button
      {...rest}
      className={`inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${VARIANTS[variant]} ${sizes[size]} ${className}`}
    >
      {children}
    </button>
  )
}
```

`web/src/components/ui/Input.tsx`:
```tsx
'use client'

import type { InputHTMLAttributes, ReactNode } from 'react'

export function Input({
  label,
  hint,
  suffix,
  error,
  className = '',
  ...rest
}: {
  label?: string
  hint?: ReactNode
  suffix?: ReactNode
  error?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="block">
      {label && (
        <span className="mb-1.5 flex items-baseline justify-between gap-2">
          <span className="text-[11px] t-caption font-medium text-ink-faint">
            {label}
          </span>
          {hint}
        </span>
      )}
      <span
        className={`flex items-center gap-2 rounded-md border bg-surface px-3 py-2.5 focus-within:border-accent ${
          error ? 'border-loss' : 'border-line'
        }`}
      >
        <input
          {...rest}
          inputMode="decimal"
          autoComplete="off"
          className={`num w-full bg-transparent text-[14px] text-ink outline-none placeholder:text-ink-faint ${className}`}
        />
        {suffix && <span className="shrink-0 text-[12px] text-ink-faint">{suffix}</span>}
      </span>
      {error && <span className="mt-1 block text-[11px] text-loss">{error}</span>}
    </label>
  )
}
```

`web/src/components/ui/Card.tsx`:
```tsx
import type { ReactNode } from 'react'

export function Card({
  title,
  subtitle,
  actions,
  children,
  className = '',
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section
      className={`rounded-[--radius-card] border border-line bg-surface ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3 sm:px-5">
          <div>
            {title && <h2 className="text-[13px] font-semibold tracking-tight text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[11px] text-ink-faint">{subtitle}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="px-4 py-4 sm:px-5">{children}</div>
    </section>
  )
}
```

`web/src/components/ui/Badge.tsx`:
```tsx
import type { ReactNode } from 'react'

type Tone = 'neutral' | 'accent' | 'gain' | 'loss' | 'warn'

const TONES: Record<Tone, string> = {
  neutral: 'border-line bg-surface-2 text-ink-dim',
  accent: 'border-accent/30 bg-accent-soft text-accent',
  gain: 'border-gain/30 bg-gain-soft text-gain',
  loss: 'border-loss/30 bg-loss-soft text-loss',
  warn: 'border-warn/30 bg-warn-soft text-warn',
}

export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${TONES[tone]}`}
    >
      {children}
    </span>
  )
}
```

`web/src/components/ui/StatTile.tsx`:
```tsx
import type { ReactNode } from 'react'

export function StatTile({
  label,
  value,
  sub,
  note,
}: {
  label: string
  /** Pass a <Num> so the figure ticks. */
  value: ReactNode
  sub?: ReactNode
  /** A short clarifier. Use it whenever the label alone could be read two ways. */
  note?: string
}) {
  return (
    <div className="rounded-[--radius-card] border border-line bg-surface px-4 py-3.5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[11px] t-caption font-medium text-ink-faint">
          {label}
        </span>
        {note && (
          <span className="text-[10px] text-ink-faint/70" title={note}>
            ⓘ
          </span>
        )}
      </div>
      <div className="mt-1.5">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-ink-faint">{sub}</div>}
    </div>
  )
}
```

`web/src/components/ui/Table.tsx`:
```tsx
import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from 'react'

export function Table({ head, children }: { head: ReactNode; children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto sm:mx-0">
      <table className="w-full min-w-[640px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line">{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

export function Th({
  children,
  numeric,
  className = '',
  ...rest
}: { children: ReactNode; numeric?: boolean } & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      {...rest}
      scope="col"
      className={`whitespace-nowrap px-3 py-2 text-[10px] t-caption font-medium text-ink-faint ${
        numeric ? 'text-right' : ''
      } ${className}`}
    >
      {children}
    </th>
  )
}

export function Td({
  children,
  numeric,
  className = '',
  ...rest
}: { children: ReactNode; numeric?: boolean } & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      {...rest}
      className={`whitespace-nowrap border-b border-line/60 px-3 py-2.5 text-[13px] ${
        numeric ? 'text-right' : ''
      } ${className}`}
    >
      {children}
    </td>
  )
}
```

`web/src/components/ui/Spinner.tsx`:
```tsx
export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={`inline-block size-3.5 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
    />
  )
}
```

- [ ] **Step 5b: Implement the spread decomposition bar — the hero of the product**

This is the one element allowed to be memorable, per the design system's restraint budget. Everything
else on every screen is quiet so this can be loud. It is also the product's central claim rendered as
a picture: four risks, priced separately, summing to a total.

`web/src/components/SpreadBar.tsx`:
```tsx
'use client'

import { Num } from './Num'

/**
 * A single stacked bar that resolves a spread into its four priced components, above the same
 * four numbers as rows. The bar shows PROPORTION; the rows show EXACT FIGURES. That duplication
 * is deliberate — a viewer who distrusts the picture checks the numbers, and vice versa.
 *
 * Colour comes from the validated categorical palette in globals.css. Fixed slot order, never
 * cycled. Credit is violet and never red: it is a premium the protocol earns, not a loss it takes,
 * and red means loss everywhere else in this interface.
 */

export type SpreadTerms = {
  baseBps: bigint
  utilTermBps: bigint
  timeRiskBps: bigint
  creditBps: bigint
  spreadBps: bigint
}

const SLOTS = [
  { key: 'baseBps', label: 'Base', varName: '--color-term-base',
    hint: "The protocol's operating floor." },
  { key: 'utilTermBps', label: 'Utilisation', varName: '--color-term-util',
    hint: 'Rises with how much of the vault is already committed.' },
  { key: 'timeRiskBps', label: 'Time', varName: '--color-term-time',
    hint: 'One standard deviation of NAV movement before settlement.' },
  { key: 'creditBps', label: 'Credit', varName: '--color-term-credit',
    hint: 'Expected loss if the issuer fails to settle.' },
] as const

export function SpreadBar({ terms, className = '' }: { terms: SpreadTerms; className?: string }) {
  const total = terms.spreadBps
  // Guard the divide: a zero-spread quote is legal (all four terms zero).
  const pct = (v: bigint) => (total === 0n ? 0 : Number((v * 10_000n) / total) / 100)

  const parts = SLOTS.map((slot) => {
    const value = terms[slot.key]
    return { ...slot, value, pct: pct(value) }
  })

  const components = terms.baseBps + terms.utilTermBps + terms.timeRiskBps + terms.creditBps

  return (
    <div className={className}>
      {/* The bar. 2px surface gaps between segments, per the dataviz mark spec. */}
      <div
        className="flex h-10 w-full overflow-hidden rounded-[--radius-control] bg-surface-2"
        role="img"
        aria-label={`Spread ${total} basis points: ${parts
          .map((p) => `${p.label} ${p.value}`)
          .join(', ')}`}
      >
        {parts.map((p, i) =>
          p.pct <= 0 ? null : (
            <div
              key={p.key}
              className="relative flex items-center justify-center overflow-hidden transition-[width] duration-[--dur-std] ease-[--ease-std]"
              style={{
                width: `${p.pct}%`,
                backgroundColor: `var(${p.varName})`,
                marginLeft: i === 0 ? 0 : 2,
              }}
              title={`${p.label} — ${p.value} bp`}
            >
              {/* Direct label only where it fits; otherwise the row below carries it. */}
              {p.pct >= 11 && (
                <span className="num t-caption font-medium text-white/95 tabular-nums">
                  {p.value.toString()}
                </span>
              )}
            </div>
          ),
        )}
      </div>

      {/* The same four values as rows, then the total. */}
      <dl className="mt-3">
        {parts.map((p) => (
          <div key={p.key} className="flex items-baseline gap-3 py-1">
            <span
              aria-hidden
              className="mt-[5px] size-2 shrink-0 rounded-full"
              style={{ backgroundColor: `var(${p.varName})` }}
            />
            <dt className="t-footnote text-ink-dim" title={p.hint}>
              {p.label}
            </dt>
            <div className="mx-1 h-px flex-1 self-center bg-line" />
            <dd>
              <Num size="footnote" tone={p.value === 0n ? 'faint' : 'default'}>
                {`${p.value} bp`}
              </Num>
            </dd>
          </div>
        ))}

        <div className="mt-1 flex items-baseline gap-3 border-t border-line pt-2.5">
          <dt className="t-footnote font-medium text-ink">Total spread</dt>
          <div className="mx-1 h-px flex-1 self-center bg-line" />
          <dd>
            <Num size="body" className="font-semibold">{`${total} bp`}</Num>
          </dd>
        </div>
      </dl>

      {/* A cheap invariant, surfaced rather than hidden: the four parts must equal the whole. */}
      {components !== total && (
        <p className="t-caption mt-2 text-loss">
          {`Components sum to ${components} bp but the chain reports ${total} bp — report this.`}
        </p>
      )}
    </div>
  )
}
```

**Legend and identity.** Four series means a legend is mandatory and colour alone may never carry
identity — the row list below the bar *is* the legend, always present, and the in-segment numbers
direct-label every segment wide enough to hold one. Narrow segments (a 2 bp sovereign credit term
next to a 380 bp one) drop their in-bar label and rely on the row, which is why the rows are not
optional.

- [ ] **Step 6: Typecheck and build**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/web
pnpm typecheck && pnpm build
```
Expected: both clean.

- [ ] **Step 7: Do NOT commit.** Report the file list and the format test count.

---

## Task 3: Contract data layer

**Files:**
- Create: `web/src/hooks/useProtocol.ts`, `web/src/hooks/useAssets.ts`, `web/src/hooks/useQuote.ts`, `web/src/hooks/useTx.ts`, `web/src/hooks/useRoles.ts`, `web/src/components/ChainGuard.tsx`, `web/src/components/TxButton.tsx`

**Interfaces:**
- Consumes: `@/lib/abis`, `@/providers/deployment`, wagmi query hooks.
- Produces:
  ```ts
  export type ProtocolState = {
    idle: bigint; outstanding: bigint; totalAssets: bigint
    utilisationBps: bigint          // CURRENT, from the vault
    maxUtilisationBps: bigint
    capacityUsdc: bigint
    sharePrice: bigint              // convertToAssets(1e6), i.e. assets per 1.000000 share
    totalSupply: bigint
    protocolFeeBps: bigint
    treasuryUsdc: bigint
    curve: { kinkBps: bigint; slope1Bps: bigint; slope2Bps: bigint }
    secondsPerDay: bigint
    isLoading: boolean
  }
  export function useProtocol(): ProtocolState

  export type AssetView = {
    token: Address; symbol: string; issuer: Address
    navPerToken: bigint; navUpdatedAt: bigint
    settlementWindow: bigint; baseSpreadBps: bigint; dailyVolBps: bigint
    eligible: boolean; enabled: boolean
    horizonDaysWad: bigint
    maxRedeemable: bigint
  }
  export function useAssets(): { assets: AssetView[]; isLoading: boolean }

  export function useQuote(token: Address | undefined, amount: bigint): {
    quote: Quote | undefined; isLoading: boolean; error: Error | null
  }
  export function useTx(): {
    send: (req: WriteReq) => void
    reset: () => void
    status: 'idle' | 'signing' | 'confirming' | 'success' | 'error'
    hash: `0x${string}` | undefined
    revert: { name: string; args: readonly unknown[] } | undefined
    message: string | undefined
  }
  export function useRoles(): { isRegistryAdmin: boolean; isDemoAdmin: boolean; isLoading: boolean }
  ```

**Non-obvious contract facts you must honour** (verified against the delivered Solidity — do not re-derive):

1. **`curve()` returns a tuple, not an object.** `Pricing.Curve public curve` generates an auto-getter with three separate `uint16` return values, so viem decodes it as `[number, number, number]`, not `{kinkBps, slope1Bps, slope2Bps}`. Destructure positionally: `[kinkBps, slope1Bps, slope2Bps]`. Getting this wrong yields `undefined` at runtime with no type error.
2. **`uint16`/`uint32`/`uint64` decode to `number`, not `bigint`.** viem only returns `bigint` for types wider than 48 bits. So `baseSpreadBps`, `dailyVolBps`, `settlementWindow`, `maxUtilisationBps`, `protocolFeeBps`, `secondsPerDay`, and `navUpdatedAt` all arrive as `number`. Wrap each in `BigInt(...)` at the boundary so nothing downstream mixes the two — mixing throws `TypeError: Cannot mix BigInt and other types`.
3. **`getAsset()` returns a struct**, so viem decodes it as an object keyed by field name: `{token, issuer, navPerToken, navUpdatedAt, settlementWindow, baseSpreadBps, dailyVolBps, eligible, enabled}`. Same for `quote()` and `getReceivable()`.
4. **`vault.utilisationBps()` returns 0 for an empty vault**, whereas `Pricing.projectedUtilisationBps` returns 10,000 for one. They are different functions answering different questions. Do not "reconcile" them.
5. **Share price:** the vault's share token has 6 decimals (it inherits USDC's). `convertToAssets(1_000_000n)` therefore gives assets per one whole share. There is no `sharePrice()` on the contract.
6. **`maxRedeemable(token)` reverts `AssetNotRegistered` for an unregistered address.** Only ever call it with a token that came out of the registry enumeration.
7. **`tokens(i)` is the public array getter**; pair it with `tokenCount()`. There is no `allTokens()`.

- [ ] **Step 1: Implement useProtocol**

`web/src/hooks/useProtocol.ts`:
```ts
'use client'

import { useReadContracts } from 'wagmi'
import { bridgeAbi, registryAbi, usdcAbi, vaultAbi } from '@/lib/abis'
import { useMaybeDeployment } from '@/providers/deployment'

const POLL = { refetchInterval: 1_000 } as const

export type ProtocolState = {
  idle: bigint
  outstanding: bigint
  totalAssets: bigint
  /** CURRENT utilisation from the vault. Not the same as quote().utilisationBps (projected). */
  utilisationBps: bigint
  maxUtilisationBps: bigint
  capacityUsdc: bigint
  /** assets per 1.000000 share (share token is 6dp, like USDC) */
  sharePrice: bigint
  totalSupply: bigint
  protocolFeeBps: bigint
  treasuryUsdc: bigint
  curve: { kinkBps: bigint; slope1Bps: bigint; slope2Bps: bigint }
  secondsPerDay: bigint
  isLoading: boolean
}

const EMPTY: ProtocolState = {
  idle: 0n,
  outstanding: 0n,
  totalAssets: 0n,
  utilisationBps: 0n,
  maxUtilisationBps: 0n,
  capacityUsdc: 0n,
  sharePrice: 1_000_000n,
  totalSupply: 0n,
  protocolFeeBps: 0n,
  treasuryUsdc: 0n,
  curve: { kinkBps: 8_000n, slope1Bps: 20n, slope2Bps: 200n },
  secondsPerDay: 86_400n,
  isLoading: true,
}

/**
 * The single source of the figures more than one route displays. Overview, LP and Holder all read
 * from here so they cannot disagree about utilisation, capacity or share price.
 */
export function useProtocol(): ProtocolState {
  const d = useMaybeDeployment()

  const vault = d && ({ address: d.vault, abi: vaultAbi } as const)
  const bridge = d && ({ address: d.bridge, abi: bridgeAbi } as const)
  const registry = d && ({ address: d.registry, abi: registryAbi } as const)

  const { data, isLoading } = useReadContracts({
    allowFailure: false,
    contracts: d
      ? [
          { ...vault!, functionName: 'idle' },
          { ...vault!, functionName: 'outstanding' },
          { ...vault!, functionName: 'totalAssets' },
          { ...vault!, functionName: 'utilisationBps' },
          { ...vault!, functionName: 'maxUtilisationBps' },
          { ...vault!, functionName: 'capacityUsdc' },
          { ...vault!, functionName: 'convertToAssets', args: [1_000_000n] },
          { ...vault!, functionName: 'totalSupply' },
          { ...bridge!, functionName: 'protocolFeeBps' },
          { ...bridge!, functionName: 'curve' },
          { ...registry!, functionName: 'secondsPerDay' },
          { address: d.usdc, abi: usdcAbi, functionName: 'balanceOf', args: [d.treasury] },
        ]
      : [],
    query: { ...POLL, enabled: Boolean(d) },
  })

  if (!d || !data) return EMPTY

  const [
    idle,
    outstanding,
    totalAssets,
    utilisationBps,
    maxUtilisationBps,
    capacityUsdc,
    sharePrice,
    totalSupply,
    protocolFeeBps,
    curveTuple,
    secondsPerDay,
    treasuryUsdc,
  ] = data as [
    bigint, bigint, bigint, bigint, number, bigint, bigint, bigint,
    number, readonly [number, number, number], number, bigint,
  ]

  return {
    idle,
    outstanding,
    totalAssets,
    utilisationBps,
    // uint16/uint32 come back as `number` from viem — widen at the boundary so nothing downstream
    // can accidentally mix BigInt with number.
    maxUtilisationBps: BigInt(maxUtilisationBps),
    capacityUsdc,
    sharePrice,
    totalSupply,
    protocolFeeBps: BigInt(protocolFeeBps),
    treasuryUsdc,
    // `Pricing.Curve public curve` auto-getter returns THREE values, so this is a tuple.
    curve: {
      kinkBps: BigInt(curveTuple[0]),
      slope1Bps: BigInt(curveTuple[1]),
      slope2Bps: BigInt(curveTuple[2]),
    },
    secondsPerDay: BigInt(secondsPerDay),
    isLoading,
  }
}
```

- [ ] **Step 2: Implement useAssets**

`web/src/hooks/useAssets.ts`:
```ts
'use client'

import { useReadContract, useReadContracts } from 'wagmi'
import type { Address } from 'viem'
import { bridgeAbi, registryAbi, rwaAbi } from '@/lib/abis'
import { useMaybeDeployment } from '@/providers/deployment'

const POLL = { refetchInterval: 1_000 } as const

export type AssetView = {
  token: Address
  symbol: string
  issuer: Address
  navPerToken: bigint
  navUpdatedAt: bigint
  settlementWindow: bigint
  baseSpreadBps: bigint
  dailyVolBps: bigint
  eligible: boolean
  enabled: boolean
  horizonDaysWad: bigint
  /** Conservative ceiling from the bridge; slightly understates the true maximum. */
  maxRedeemable: bigint
}

/**
 * Enumerates assets from the registry rather than from a hardcoded list. Two reasons: the admin can
 * register more, and bridge.maxRedeemable() REVERTS (AssetNotRegistered) for an address the registry
 * does not know, so a hardcoded list that drifts would break the page rather than show a zero.
 */
export function useAssets(): { assets: AssetView[]; isLoading: boolean } {
  const d = useMaybeDeployment()

  const { data: count } = useReadContract({
    address: d?.registry,
    abi: registryAbi,
    functionName: 'tokenCount',
    query: { ...POLL, enabled: Boolean(d) },
  })

  const n = count === undefined ? 0 : Number(count)

  const { data: tokenAddrs } = useReadContracts({
    allowFailure: false,
    contracts:
      d && n > 0
        ? Array.from({ length: n }, (_, i) => ({
            address: d.registry,
            abi: registryAbi,
            functionName: 'tokens' as const,
            args: [BigInt(i)] as const,
          }))
        : [],
    query: { enabled: Boolean(d) && n > 0 },
  })

  const tokens = (tokenAddrs ?? []) as readonly Address[]

  const { data: details, isLoading } = useReadContracts({
    allowFailure: false,
    contracts:
      d && tokens.length > 0
        ? tokens.flatMap((t) => [
            { address: d.registry, abi: registryAbi, functionName: 'getAsset' as const, args: [t] as const },
            { address: d.registry, abi: registryAbi, functionName: 'horizonDays' as const, args: [t] as const },
            { address: d.bridge, abi: bridgeAbi, functionName: 'maxRedeemable' as const, args: [t] as const },
            { address: t, abi: rwaAbi, functionName: 'symbol' as const },
          ])
        : [],
    query: { ...POLL, enabled: Boolean(d) && tokens.length > 0 },
  })

  if (!details) return { assets: [], isLoading: true }

  const assets: AssetView[] = tokens.map((token, i) => {
    const a = details[i * 4] as {
      issuer: Address
      navPerToken: bigint
      navUpdatedAt: number
      settlementWindow: number
      baseSpreadBps: number
      dailyVolBps: number
      eligible: boolean
      enabled: boolean
    }
    return {
      token,
      symbol: details[i * 4 + 3] as string,
      issuer: a.issuer,
      navPerToken: a.navPerToken,
      navUpdatedAt: BigInt(a.navUpdatedAt),
      settlementWindow: BigInt(a.settlementWindow),
      baseSpreadBps: BigInt(a.baseSpreadBps),
      dailyVolBps: BigInt(a.dailyVolBps),
      eligible: a.eligible,
      enabled: a.enabled,
      horizonDaysWad: details[i * 4 + 1] as bigint,
      maxRedeemable: details[i * 4 + 2] as bigint,
    }
  })

  return { assets, isLoading }
}
```

- [ ] **Step 3: Implement useQuote**

`web/src/hooks/useQuote.ts`:
```ts
'use client'

import { useReadContract } from 'wagmi'
import type { Address } from 'viem'
import { bridgeAbi } from '@/lib/abis'
import { useMaybeDeployment } from '@/providers/deployment'

export type Quote = {
  navValueWad: bigint
  navValueUsdc: bigint
  /** PROJECTED utilisation, including the trade being quoted. */
  utilisationBps: bigint
  baseBps: bigint
  utilTermBps: bigint
  timeRiskBps: bigint
  spreadBps: bigint
  payout: bigint
  capacityUsdc: bigint
}

/**
 * The authoritative quote. Always read from the chain, never computed locally — this is the number
 * the user is about to sign against, and packages/shared/pricing.ts is a mirror, not the source.
 */
export function useQuote(token: Address | undefined, amount: bigint) {
  const d = useMaybeDeployment()
  const enabled = Boolean(d && token && amount > 0n)

  const { data, isLoading, error } = useReadContract({
    address: d?.bridge,
    abi: bridgeAbi,
    functionName: 'quote',
    args: token && amount > 0n ? [token, amount] : undefined,
    query: { refetchInterval: 1_000, enabled },
  })

  return { quote: data as Quote | undefined, isLoading: enabled && isLoading, error }
}
```

- [ ] **Step 4: Implement useTx with custom-error decoding**

This is the hook that makes the demo's eligibility moment land: step 4 of the demo attempts rPRIV
and must show a decoded `NotEligibleRedeemer`, not a wall of hex.

`web/src/hooks/useTx.ts`:
```ts
'use client'

import { useCallback, useMemo, useState } from 'react'
import { BaseError, ContractFunctionRevertedError } from 'viem'
import type { Abi, Address } from 'viem'
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi'

export type WriteReq = {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
}

export type Revert = { name: string; args: readonly unknown[] }

/** Pull a decoded custom error out of viem's nested error chain. */
export function decodeRevert(err: unknown): Revert | undefined {
  if (!(err instanceof BaseError)) return undefined
  const found = err.walk((e) => e instanceof ContractFunctionRevertedError)
  if (!(found instanceof ContractFunctionRevertedError)) return undefined
  const name = found.data?.errorName ?? found.reason
  if (!name) return undefined
  return { name, args: found.data?.args ?? [] }
}

/** Human-readable text for the custom errors this UI can actually provoke. */
export function explainRevert(r: Revert): string {
  switch (r.name) {
    case 'NotEligibleRedeemer':
      return 'This asset is not redeemable: the protocol is not yet an eligible redeemer with its issuer.'
    case 'AssetDisabled':
      return 'This asset is currently disabled by the admin.'
    case 'InsufficientCapacity':
      return `Vault capacity is too low for this size. Payout would be ${r.args[0]}, capacity is ${r.args[1]}.`
    case 'SlippageExceeded':
      return `Payout ${r.args[0]} is below your minimum of ${r.args[1]}.`
    case 'SpreadTooHigh':
      return `Spread ${r.args[0]} bps exceeds the protocol maximum.`
    case 'PayoutTooSmall':
      return 'That amount rounds to a zero payout.'
    case 'SettlementWindowNotElapsed':
      return 'The settlement window has not elapsed yet. Use the admin override to settle now.'
    case 'ReceivableNotOpen':
      return 'That receivable is already settled.'
    case 'UtilisationTooHigh':
      return `This would push utilisation to ${r.args[0]} bps, above the cap of ${r.args[1]}.`
    case 'InsufficientIdle':
      return `The vault has only ${r.args[1]} idle USDC; ${r.args[0]} was requested.`
    case 'AssetNotRegistered':
      return 'That token is not registered with the protocol.'
    case 'EmptyVault':
      return 'The vault has no capital yet. An LP must deposit first.'
    case 'AccessControlUnauthorizedAccount':
      return 'The connected wallet does not hold the role required for this action.'
    default:
      return r.args.length > 0 ? `${r.name}(${r.args.map(String).join(', ')})` : r.name
  }
}

export function useTx() {
  const write = useWriteContract()
  const [dismissed, setDismissed] = useState(false)

  const receipt = useWaitForTransactionReceipt({
    hash: write.data,
    query: { enabled: Boolean(write.data) },
  })

  const send = useCallback(
    (req: WriteReq) => {
      setDismissed(false)
      // wagmi 3: mutation hooks expose .mutate — there is no destructurable `writeContract`.
      write.mutate({
        address: req.address,
        abi: req.abi,
        functionName: req.functionName,
        args: req.args,
      } as Parameters<typeof write.mutate>[0])
    },
    [write],
  )

  const reset = useCallback(() => {
    setDismissed(true)
    write.reset()
  }, [write])

  const revert = useMemo(() => decodeRevert(write.error), [write.error])

  const status = dismissed
    ? ('idle' as const)
    : write.isPending
      ? ('signing' as const)
      : write.error
        ? ('error' as const)
        : write.data && receipt.isLoading
          ? ('confirming' as const)
          : receipt.isSuccess
            ? ('success' as const)
            : ('idle' as const)

  const message = write.error
    ? revert
      ? explainRevert(revert)
      : write.error instanceof BaseError
        ? write.error.shortMessage
        : write.error.message
    : undefined

  return { send, reset, status, hash: write.data, revert, message }
}
```

- [ ] **Step 5: Implement useRoles**

`web/src/hooks/useRoles.ts`:
```ts
'use client'

import { useReadContracts } from 'wagmi'
import { bridgeAbi, registryAbi } from '@/lib/abis'
import { useConnection } from 'wagmi'
import { useMaybeDeployment } from '@/providers/deployment'

const ZERO_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000' as const

/**
 * Admin surfaces are gated on an on-chain role read, never on an address comparison, so the demo
 * still works from a different wallet.
 */
export function useRoles() {
  const d = useMaybeDeployment()
  const { address } = useConnection()
  const enabled = Boolean(d && address)

  const { data, isLoading } = useReadContracts({
    allowFailure: false,
    contracts:
      d && address
        ? [
            { address: d.registry, abi: registryAbi, functionName: 'hasRole', args: [ZERO_ROLE, address] },
            { address: d.bridge, abi: bridgeAbi, functionName: 'DEMO_ADMIN_ROLE' },
          ]
        : [],
    query: { enabled, refetchInterval: 5_000 },
  })

  const demoRole = data?.[1] as `0x${string}` | undefined

  const { data: demoHas } = useReadContracts({
    allowFailure: false,
    contracts:
      d && address && demoRole
        ? [{ address: d.bridge, abi: bridgeAbi, functionName: 'hasRole', args: [demoRole, address] }]
        : [],
    query: { enabled: Boolean(d && address && demoRole), refetchInterval: 5_000 },
  })

  return {
    isRegistryAdmin: Boolean(data?.[0]),
    isDemoAdmin: Boolean(demoHas?.[0]),
    isLoading: enabled && isLoading,
  }
}
```

- [ ] **Step 6: Implement ChainGuard and TxButton**

`web/src/components/ChainGuard.tsx`:
```tsx
'use client'

import type { ReactNode } from 'react'
import { useChains, useConnection, useSwitchChain } from 'wagmi'
import { useDeployments } from '@/providers/deployment'
import { Button } from './ui/Button'
import { Card } from './ui/Card'
import { ConnectButton } from './ConnectButton'

/**
 * Renders children only when we are connected to a chain we have a deployment for. Everything below
 * this can call useDeployment() without optional chaining.
 */
export function ChainGuard({ children }: { children: ReactNode }) {
  const { isConnected, chainId } = useConnection()
  const chains = useChains()
  const switchChain = useSwitchChain()
  const deployments = useDeployments()

  if (!isConnected) {
    return (
      <Card title="Connect a wallet">
        <p className="text-[13px] text-ink-dim">
          RedeemNow reads live protocol state from the chain. Connect an injected wallet to continue.
        </p>
        <div className="mt-4">
          <ConnectButton />
        </div>
      </Card>
    )
  }

  const deployed = chains.filter((c) => deployments[c.id])

  if (chainId === undefined || !deployments[chainId]) {
    return (
      <Card title="Switch network">
        <p className="text-[13px] text-ink-dim">
          {deployed.length === 0
            ? 'No deployment was found for any supported chain. Run the deploy script, then `pnpm --filter @redeemnow/shared sync`.'
            : 'This wallet is on a chain RedeemNow is not deployed to.'}
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {deployed.map((c) => (
            <Button
              key={c.id}
              variant="secondary"
              size="sm"
              disabled={switchChain.isPending}
              onClick={() => switchChain.mutate({ chainId: c.id })}
            >
              Switch to {c.name}
            </Button>
          ))}
        </div>
      </Card>
    )
  }

  return <>{children}</>
}
```

`web/src/components/TxButton.tsx`:
```tsx
'use client'

import type { ReactNode } from 'react'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import type { useTx } from '@/hooks/useTx'

/**
 * A write button that surfaces every transaction state inline, including a decoded custom error.
 * The revert path is load-bearing for the demo: attempting rPRIV must read as a deliberate
 * eligibility rule, not as a broken app.
 */
export function TxButton({
  tx,
  onClick,
  disabled,
  children,
  variant = 'primary',
  successLabel = 'Done',
}: {
  tx: ReturnType<typeof useTx>
  onClick: () => void
  disabled?: boolean
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
  successLabel?: string
}) {
  const busy = tx.status === 'signing' || tx.status === 'confirming'

  return (
    <div className="space-y-2">
      <Button
        variant={variant}
        disabled={disabled || busy}
        onClick={onClick}
        className="w-full"
      >
        {busy && <Spinner />}
        {tx.status === 'signing'
          ? 'Confirm in wallet…'
          : tx.status === 'confirming'
            ? 'Confirming…'
            : tx.status === 'success'
              ? successLabel
              : children}
      </Button>

      {tx.status === 'error' && tx.message && (
        <div className="rounded-md border border-loss/40 bg-loss-soft px-3 py-2">
          {tx.revert && (
            <p className="num text-[11px] font-medium text-loss">
              {tx.revert.name}
            </p>
          )}
          <p className="mt-0.5 text-[12px] text-loss">{tx.message}</p>
          <button
            type="button"
            onClick={tx.reset}
            className="mt-1.5 text-[11px] text-ink-dim underline hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {tx.status === 'success' && tx.hash && (
        <p className="num truncate text-[11px] text-gain" title={tx.hash}>
          {tx.hash}
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 7: Typecheck and build**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/web
pnpm typecheck && pnpm build
```
Expected: both clean.

**If `useReadContracts` type inference fights you** on the heterogeneous `contracts` array: the
`as [...]` cast in `useProtocol` is deliberate and sufficient. Do not add `any`, do not add
`@ts-expect-error`, and do not split the batch into twelve separate `useReadContract` calls — that
would put twelve RPC round-trips per second on the node.

- [ ] **Step 8: Do NOT commit.** Report the file list and any inference workaround you needed.

---

## Task 4: Overview route

**Files:**
- Create: `web/src/components/UtilisationCurve.tsx`, `web/src/components/ReceivableBook.tsx`
- Modify: `web/src/app/page.tsx` (replace the Task 1 placeholder wholesale)

**Interfaces:**
- Consumes: `useProtocol`, `useAssets`, `useQuote` (not needed here), `@redeemnow/shared/pricing` (for the curve chart's modelled line only), `format.ts`, the UI primitives.

**Spec §6 requirements for this route:** stat tiles (TVL, utilisation, outstanding, LP share price /
realised yield, protocol fees), per-asset live spread, utilisation curve chart with the current
point, receivable book table with countdown and status.

- [ ] **Step 1: Implement the utilisation curve chart**

Per Design Ruling 3: the plotted line is a **model of the configured curve** computed from the
validated local mirror (no on-chain call can give you the spread at utilisations the vault is not
at), and the live point is the real one. Label it that way.

`web/src/components/UtilisationCurve.tsx`:
```tsx
'use client'

import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { utilisationTermBps } from '@redeemnow/shared/pricing'

/**
 * The kinked utilisation curve. Recharts 3 notes:
 *  - ResponsiveContainer's computed size always wins over width/height on the chart, so we size the
 *    container and pass no dimensions to AreaChart.
 *  - ReferenceDot's `alwaysShow`/`isFront` were removed in v3; use `ifOverflow`.
 *  - CartesianGrid must share the axis ids, or grid lines silently vanish.
 */
export function UtilisationCurve({
  curve,
  currentBps,
}: {
  curve: { kinkBps: bigint; slope1Bps: bigint; slope2Bps: bigint }
  currentBps: bigint
}) {
  const data = useMemo(() => {
    const pts: { u: number; bps: number }[] = []
    for (let u = 0; u <= 10_000; u += 100) {
      pts.push({ u: u / 100, bps: Number(utilisationTermBps(BigInt(u), curve)) })
    }
    return pts
  }, [curve])

  // Safe Number() conversions: both are bps, bounded by 10_000 by construction.
  const currentPct = Number(currentBps > 10_000n ? 10_000n : currentBps) / 100
  const currentTerm = Number(utilisationTermBps(currentBps, curve))
  const kinkPct = Number(curve.kinkBps) / 100

  return (
    <div className="h-[220px] w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
          <defs>
            <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="u"
            tickFormatter={(v: number) => `${v}%`}
            stroke="var(--color-ink-faint)"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tickFormatter={(v: number) => `${v}`}
            stroke="var(--color-ink-faint)"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={38}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-line)',
              borderRadius: 8,
              fontSize: 12,
            }}
            labelFormatter={(v) => `Utilisation ${v}%`}
            formatter={(v: number) => [`${v} bps`, 'Utilisation term']}
          />
          <Area
            type="monotone"
            dataKey="bps"
            stroke="var(--color-accent)"
            strokeWidth={1.75}
            fill="url(#curveFill)"
            dot={false}
            isAnimationActive={false}
          />
          <ReferenceDot
            x={currentPct}
            y={currentTerm}
            r={5}
            fill="var(--color-warn)"
            stroke="var(--color-surface)"
            strokeWidth={2}
            ifOverflow="visible"
          />
        </AreaChart>
      </ResponsiveContainer>
      <p className="mt-1.5 text-[11px] text-ink-faint">
        Modelled from the on-chain curve parameters (kink {kinkPct}%). The marker is live vault
        utilisation, {currentPct.toFixed(2)}%.
      </p>
    </div>
  )
}
```

- [ ] **Step 2: Implement the receivable book**

`web/src/components/ReceivableBook.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'
import { useBlock, useReadContract, useReadContracts } from 'wagmi'
import type { Address } from 'viem'
import { bridgeAbi } from '@/lib/abis'
import { useDeployment } from '@/providers/deployment'
import { formatCountdown, formatToken, formatUsdc } from '@/lib/format'
import { Badge } from './ui/Badge'
import { Num } from './Num'
import { Table, Td, Th } from './ui/Table'

type Receivable = {
  id: bigint
  token: Address
  holder: Address
  amount: bigint
  navAtFront: bigint
  advanced: bigint
  expected: bigint
  openedAt: number
  settleAfter: number
  status: number
}

export function ReceivableBook({ symbols }: { symbols: Record<string, string> }) {
  const d = useDeployment()

  const { data: ids } = useReadContract({
    address: d.bridge,
    abi: bridgeAbi,
    functionName: 'openReceivableIds',
    query: { refetchInterval: 1_000 },
  })

  const openIds = (ids ?? []) as readonly bigint[]

  const { data } = useReadContracts({
    allowFailure: false,
    contracts: openIds.map((id) => ({
      address: d.bridge,
      abi: bridgeAbi,
      functionName: 'getReceivable' as const,
      args: [id] as const,
    })),
    query: { refetchInterval: 1_000, enabled: openIds.length > 0 },
  })

  // Chain time, not wall-clock: the demo advances the chain clock with evm_increaseTime, and a
  // countdown off Date.now() would disagree with the contract's own >= check.
  const { data: block } = useBlock({ watch: true })
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1_000)
    return () => clearInterval(t)
  }, [])

  const now = block?.timestamp ?? 0n
  const rows = (data ?? []) as readonly Receivable[]

  if (openIds.length === 0) {
    return (
      <p className="py-6 text-center text-[13px] text-ink-faint">
        No open receivables. Redeem an asset on the Holder page to open one.
      </p>
    )
  }

  return (
    <Table
      head={
        <>
          <Th>ID</Th>
          <Th>Asset</Th>
          <Th numeric>Amount</Th>
          <Th numeric>Advanced</Th>
          <Th numeric>Expected at NAV</Th>
          <Th numeric>Spread captured</Th>
          <Th numeric>Settles in</Th>
          <Th>Status</Th>
        </>
      }
    >
      {rows.map((r) => {
        const remaining = BigInt(r.settleAfter) - now
        const due = remaining <= 0n
        const captured = r.expected - r.advanced
        return (
          <tr key={r.id.toString()} className="hover:bg-surface-2/50">
            <Td>
              <Num size="sm" tone="dim">{`#${r.id}`}</Num>
            </Td>
            <Td>{symbols[r.token.toLowerCase()] ?? `${r.token.slice(0, 8)}…`}</Td>
            <Td numeric>
              <Num size="sm">{formatToken(r.amount)}</Num>
            </Td>
            <Td numeric>
              <Num size="sm">{formatUsdc(r.advanced)}</Num>
            </Td>
            <Td numeric>
              <Num size="sm" tone="dim">{formatUsdc(r.expected)}</Num>
            </Td>
            <Td numeric>
              <Num size="sm" tone={captured >= 0n ? 'gain' : 'loss'}>
                {formatUsdc(captured)}
              </Num>
            </Td>
            <Td numeric>
              <Num size="sm" tone={due ? 'warn' : 'dim'}>
                {formatCountdown(remaining)}
              </Num>
            </Td>
            <Td>
              <Badge tone={due ? 'warn' : 'accent'}>{due ? 'settleable' : 'open'}</Badge>
            </Td>
          </tr>
        )
      })}
    </Table>
  )
}
```

- [ ] **Step 3: Implement the live quote band — the Overview's hero**

Per the design system, the Overview does **not** open with a grid of stat tiles. A stat-tile grid is
the default treatment for every dashboard ever made and says nothing about this product. It opens with
a live quote band: choose an asset, and the spread resolves into its four components in front of you.
The tiles go below.

`web/src/components/QuoteBand.tsx`:
```tsx
'use client'

import { useEffect, useState } from 'react'
import { Num } from './Num'
import { SpreadBar } from './SpreadBar'
import { Badge } from './ui/Badge'
import { useAssets, type AssetView } from '@/hooks/useAssets'
import { useQuote } from '@/hooks/useQuote'
import { formatPct, formatUsdc, formatWad } from '@/lib/format'

/** A representative size per asset class, so the opening figure is never a rounding error. */
function sampleAmount(a: AssetView): bigint {
  // 1,000 units of a ~$1 asset, scaled down for a high-NAV equity.
  return a.navPerToken > 100n * 10n ** 18n ? 100n * 10n ** 18n : 5_000n * 10n ** 18n
}

export function QuoteBand() {
  const { assets } = useAssets()
  const [selected, setSelected] = useState<string | undefined>()

  useEffect(() => {
    if (!selected && assets.length > 0) {
      // Open on the asset that makes the point: the one with the largest credit term.
      const loudest = [...assets]
        .filter((a) => a.eligible && a.enabled)
        .sort((x, y) => Number(y.creditBps - x.creditBps))[0]
      setSelected((loudest ?? assets[0]!).token)
    }
  }, [assets, selected])

  const asset = assets.find((a) => a.token === selected)
  const amount = asset ? sampleAmount(asset) : 0n
  const { quote } = useQuote(asset?.token, amount)

  return (
    <section className="rounded-[--radius-sheet] border border-line bg-surface elev-1">
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-4 sm:px-5">
        <p className="t-footnote mr-auto text-ink-dim">Live spread</p>
        {/* Segmented control, Apple's pattern. */}
        <div className="flex gap-1 rounded-[--radius-control] bg-surface-2 p-1">
          {assets.map((a) => {
            const on = a.token === selected
            return (
              <button
                key={a.token}
                type="button"
                onClick={() => setSelected(a.token)}
                aria-pressed={on}
                className={`t-footnote rounded-[6px] px-3 py-1.5 transition-colors duration-[--dur-fast] ${
                  on ? 'bg-surface font-medium text-ink elev-1' : 'text-ink-dim hover:text-ink'
                }`}
              >
                {a.symbol}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-6 p-5 lg:grid-cols-[1fr_1.25fr] lg:gap-10">
        <div className="space-y-4">
          <div>
            <p className="t-footnote text-ink-dim">
              {asset ? `Exit ${formatWad(amount, 0)} ${asset.symbol} at NAV ${formatWad(asset.navPerToken)}` : 'Loading'}
            </p>
            <Num size="metric-lg">{quote ? formatUsdc(quote.payout) : '—'}</Num>
            <p className="t-footnote mt-1 text-ink-faint">
              paid in this block, against {quote ? formatUsdc(quote.navValueUsdc) : '—'} at NAV
            </p>
          </div>

          {asset && (
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">{asset.assetClassLabel}</Badge>
              {asset.eligible ? (
                <Badge tone="gain">Redeemable</Badge>
              ) : (
                <Badge tone="warn">Issuer eligibility pending</Badge>
              )}
              {quote && (
                <Badge tone="neutral">{`Settles in ${formatWad(asset.horizonDaysWad, 1)}d`}</Badge>
              )}
            </div>
          )}

          <p className="t-callout max-w-[46ch] text-ink-dim">
            Most tokenized assets settle redemptions at T+1 or later, and many cannot be redeemed at
            all without issuer onboarding. RedeemNow pays now and collects par at settlement.
          </p>
        </div>

        {quote ? (
          <SpreadBar terms={quote} />
        ) : (
          <div className="flex min-h-[220px] items-center justify-center">
            <p className="t-footnote text-ink-faint">Reading the chain…</p>
          </div>
        )}
      </div>
    </section>
  )
}
```
> `AssetView` needs an `assetClassLabel: string` — add it in `useAssets` by mapping the numeric
> `assetClass` enum to `['Treasury', 'Global bond', 'Private credit', 'Institutional fund', 'Equity',
> 'Commodity']`. Sentence case, not all-caps.

- [ ] **Step 3b: Implement the Overview page**

`web/src/app/page.tsx` (replace entirely). Order matters: hero, then tiles, then the curve and the
book. Do not reorder to put tiles first.

```tsx
'use client'

import { ChainGuard } from '@/components/ChainGuard'
import { Num } from '@/components/Num'
import { QuoteBand } from '@/components/QuoteBand'
import { ReceivableBook } from '@/components/ReceivableBook'
import { UtilisationCurve } from '@/components/UtilisationCurve'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { StatTile } from '@/components/ui/StatTile'
import { Table, Td, Th } from '@/components/ui/Table'
import { useAssets } from '@/hooks/useAssets'
import { useProtocol } from '@/hooks/useProtocol'
import { formatBps, formatPct, formatUsdc, formatWad } from '@/lib/format'

function Inner() {
  const p = useProtocol()
  const { assets } = useAssets()

  const yieldBps = p.sharePrice > 0n ? ((p.sharePrice - 1_000_000n) * 10_000n) / 1_000_000n : 0n
  const symbols = Object.fromEntries(assets.map((a) => [a.token.toLowerCase(), a.symbol]))

  return (
    <div className="space-y-6 py-8">
      <header className="max-w-[60ch]">
        <h1 className="t-large-title">Instant liquidity for tokenized assets</h1>
        <p className="t-body mt-2 text-ink-dim">
          Exit at NAV in one block instead of waiting for the issuer to settle.
        </p>
      </header>

      <QuoteBand />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatTile
          label="Total value locked"
          value={<Num size="metric">{formatUsdc(p.totalAssets)}</Num>}
          sub="USDC funding redemptions"
        />
        <StatTile
          label="Utilisation"
          note="Current utilisation: outstanding divided by total assets. The holder quote shows utilisation projected after a trade, which is a different figure."
          value={
            <Num size="metric" tone={p.utilisationBps > 8_000n ? 'warn' : 'default'}>
              {formatPct(p.utilisationBps)}
            </Num>
          }
          sub={`Capped at ${formatPct(p.maxUtilisationBps)}`}
        />
        <StatTile
          label="Outstanding"
          value={<Num size="metric">{formatUsdc(p.outstanding)}</Num>}
          sub="Advanced, awaiting settlement"
        />
        <StatTile
          label="Share price"
          value={
            <Num size="metric" tone={yieldBps > 0n ? 'gain' : yieldBps < 0n ? 'loss' : 'default'}>
              {formatUsdc(p.sharePrice, 6)}
            </Num>
          }
          sub={`${formatBps(yieldBps)} realised since inception`}
        />
        <StatTile
          label="Protocol fees"
          value={<Num size="metric">{formatUsdc(p.treasuryUsdc)}</Num>}
          sub={`${formatBps(p.protocolFeeBps)} of realised profit`}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card title="Assets" subtitle="Credit premium and exposure limit are set per asset">
          <Table
            head={
              <>
                <Th>Asset</Th>
                <Th>Class</Th>
                <Th numeric>NAV</Th>
                <Th numeric>Credit</Th>
                <Th numeric>Exposure used</Th>
                <Th>Status</Th>
              </>
            }
          >
            {assets.map((a) => {
              const used = a.exposureUsdc ?? 0n
              const cap = a.exposureCapUsdc ?? 0n
              const fill = cap === 0n ? 0 : Math.min(100, Number((used * 100n) / cap))
              return (
                <tr key={a.token} className="hover:bg-surface-2/50">
                  <Td className="font-medium">{a.symbol}</Td>
                  <Td><span className="t-footnote text-ink-dim">{a.assetClassLabel}</span></Td>
                  <Td numeric><Num size="footnote">{formatWad(a.navPerToken)}</Num></Td>
                  <Td numeric>
                    {/* Credit wears its own colour everywhere, including here. */}
                    <span className="num t-footnote" style={{ color: 'var(--color-term-credit)' }}>
                      {formatBps(a.creditBps)}
                    </span>
                  </Td>
                  <Td numeric>
                    <div className="flex items-center justify-end gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                        <div
                          className="h-full rounded-full transition-[width] duration-[--dur-std]"
                          style={{
                            width: `${fill}%`,
                            backgroundColor: fill > 85 ? 'var(--color-warn)' : 'var(--color-accent)',
                          }}
                        />
                      </div>
                      <Num size="caption" tone="dim">{formatUsdc(cap, 0)}</Num>
                    </div>
                  </Td>
                  <Td>
                    {!a.enabled ? (
                      <Badge tone="neutral">Disabled</Badge>
                    ) : a.eligible ? (
                      <Badge tone="gain">Redeemable</Badge>
                    ) : (
                      <Badge tone="warn">Eligibility pending</Badge>
                    )}
                  </Td>
                </tr>
              )
            })}
          </Table>
        </Card>

        <Card
          title="Utilisation curve"
          subtitle="The spread rises with utilisation, steeply past the kink"
        >
          <UtilisationCurve curve={p.curve} currentBps={p.utilisationBps} />
        </Card>
      </div>

      <Card title="Open receivables" subtitle="Redemptions funded and awaiting settlement">
        <ReceivableBook symbols={symbols} />
      </Card>
    </div>
  )
}

export default function OverviewPage() {
  return (
    <ChainGuard>
      <Inner />
    </ChainGuard>
  )
}
```
> `useAssets` must also expose `exposureUsdc` and `exposureCapUsdc` per asset, from
> `bridge.exposureUsdc(token)` and `bridge.assetExposureCapUsdc(token)`.

- [ ] **Step 4: Typecheck, build, and look at it**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/web
pnpm typecheck && pnpm build
```
Then run `pnpm dev` and fetch `http://localhost:3000`. Without a wallet you should see the
ChainGuard "Connect a wallet" card, not a crash. Report what you saw, then stop the server.

- [ ] **Step 5: Do NOT commit.**

---

## Task 5: Holder and LP routes

**Files:**
- Create: `web/src/app/holder/page.tsx`, `web/src/app/lp/page.tsx`, `web/src/components/QuotePanel.tsx`:
```tsx
'use client'

import { Num } from './Num'
import { SpreadBar } from './SpreadBar'
import { Badge } from './ui/Badge'
import { formatPct, formatUsdc } from '@/lib/format'
import type { Quote } from '@/hooks/useQuote'

/**
 * The quote. Structure, top to bottom: what the asset is worth at NAV, what you receive now, then
 * WHY the difference exists. The decomposition is the largest thing on the panel because it is the
 * product's whole claim.
 */
export function QuotePanel({
  quote,
  currentUtilisationBps,
  exposureCapUsdc,
}: {
  quote: Quote
  currentUtilisationBps: bigint
  exposureCapUsdc?: bigint
}) {
  const overCapacity = quote.payout > quote.capacityUsdc
  const overExposure = exposureCapUsdc !== undefined && quote.payout > exposureCapUsdc
  // Which limit actually binds? Showing both without saying which is the smaller is useless.
  const binding =
    exposureCapUsdc !== undefined && exposureCapUsdc < quote.capacityUsdc
      ? { label: 'this asset', value: exposureCapUsdc }
      : { label: 'the vault', value: quote.capacityUsdc }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <p className="t-footnote text-ink-dim">You receive now</p>
          <Num size="metric-lg" tone={overCapacity || overExposure ? 'loss' : 'default'}>
            {formatUsdc(quote.payout)}
          </Num>
        </div>
        <div className="text-right">
          <p className="t-footnote text-ink-dim">Value at NAV</p>
          <Num size="metric" tone="dim">{formatUsdc(quote.navValueUsdc)}</Num>
        </div>
      </div>

      <div>
        <p className="t-footnote mb-2.5 text-ink-dim">
          The difference is the spread, and it prices four separate risks.
        </p>
        <SpreadBar terms={quote} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {/* Design system rule 1: a utilisation figure is NEVER shown unlabelled, because two
            different correct values exist. This one is projected. */}
        <Badge tone={quote.utilisationBps > 8_000n ? 'warn' : 'neutral'}>
          {`Utilisation after this trade ${formatPct(quote.utilisationBps)}`}
        </Badge>
        <Badge tone="neutral">{`Now ${formatPct(currentUtilisationBps)}`}</Badge>
        <Badge tone={overCapacity || overExposure ? 'loss' : 'neutral'}>
          {`Limit ${formatUsdc(binding.value, 0)} — set by ${binding.label}`}
        </Badge>
      </div>

      {overExposure && (
        <p className="t-footnote text-loss">
          This size is over the per-asset exposure limit and would be rejected. The limit is tighter
          for assets carrying more credit risk. Reduce the amount, or wait for an open receivable on
          this asset to settle.
        </p>
      )}
      {overCapacity && !overExposure && (
        <p className="t-footnote text-loss">
          This size is over what the vault can fund right now. Reduce the amount, or add liquidity.
        </p>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Implement the Holder page**

`web/src/app/holder/page.tsx`:
```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { maxUint256 } from 'viem'
import { ChainGuard } from '@/components/ChainGuard'
import { Num } from '@/components/Num'
import { QuotePanel } from '@/components/QuotePanel'
import { TxButton } from '@/components/TxButton'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { useAllowance } from '@/hooks/useAllowance'
import { useAssets } from '@/hooks/useAssets'
import { useProtocol } from '@/hooks/useProtocol'
import { useQuote } from '@/hooks/useQuote'
import { useTx } from '@/hooks/useTx'
import { bridgeAbi, usdcAbi } from '@/lib/abis'
import { formatToken, formatWad, parseUnits } from '@/lib/format'
import { useDeployment } from '@/providers/deployment'

function Inner() {
  const d = useDeployment()
  const p = useProtocol()
  const { assets } = useAssets()
  const [selected, setSelected] = useState<string | undefined>()
  const [raw, setRaw] = useState('')

  // Default to the first redeemable asset once assets load.
  useEffect(() => {
    if (!selected && assets.length > 0) {
      setSelected((assets.find((a) => a.eligible && a.enabled) ?? assets[0]!).token)
    }
  }, [assets, selected])

  const asset = assets.find((a) => a.token === selected)

  const { amount, amountError } = useMemo(() => {
    try {
      return { amount: parseUnits(raw, 18), amountError: undefined }
    } catch (e) {
      return { amount: 0n, amountError: e instanceof Error ? e.message : 'invalid amount' }
    }
  }, [raw])

  const { quote } = useQuote(asset?.token, amount)
  const { balance, allowance, refetch } = useAllowance(asset?.token, d.bridge)

  const approveTx = useTx()
  const redeemTx = useTx()

  useEffect(() => {
    if (approveTx.status === 'success') refetch()
  }, [approveTx.status, refetch])

  const needsApproval = amount > 0n && allowance < amount
  const overBalance = amount > balance

  return (
    <div className="space-y-4 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Redeem an RWA</h1>
        <p className="mt-1 text-[13px] text-ink-dim">
          Deposit a tokenized asset and receive USDC in this block at NAV minus spread. The protocol
          collects NAV from the issuer at settlement.
        </p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <Card title="Your position">
          <div className="space-y-4">
            <div>
              <p className="mb-1.5 text-[11px] t-caption font-medium text-ink-faint">
                Asset
              </p>
              <div className="flex flex-wrap gap-2">
                {assets.map((a) => {
                  const active = a.token === selected
                  return (
                    <button
                      key={a.token}
                      type="button"
                      onClick={() => setSelected(a.token)}
                      className={`rounded-md border px-3 py-2 text-left transition-colors ${
                        active
                          ? 'border-accent bg-accent-soft'
                          : 'border-line bg-surface hover:bg-surface-2'
                      }`}
                    >
                      <span className="block text-[13px] font-medium">{a.symbol}</span>
                      <Num size="sm" tone="dim">{formatWad(a.navPerToken)}</Num>
                    </button>
                  )
                })}
              </div>
            </div>

            {asset && !asset.eligible && (
              <div className="rounded-md border border-warn/40 bg-warn-soft px-3 py-2.5">
                <Badge tone="warn">issuer eligibility pending</Badge>
                <p className="mt-1.5 text-[12px] text-warn">
                  RedeemNow is not yet an eligible redeemer with this asset&apos;s issuer, so it
                  cannot be redeemed. Attempting it reverts on chain — try it.
                </p>
              </div>
            )}

            <Input
              label="Amount"
              placeholder="0.0"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              suffix={asset?.symbol}
              error={amountError ?? (overBalance ? 'Exceeds your balance' : undefined)}
              hint={
                asset && (
                  <button
                    type="button"
                    onClick={() => setRaw(formatToken(balance, 4).replace(/,/g, ''))}
                    className="num text-[11px] text-ink-dim underline hover:text-ink"
                  >
                    {`balance ${formatToken(balance)}`}
                  </button>
                )
              }
            />

            {needsApproval ? (
              <TxButton
                tx={approveTx}
                successLabel="Approved"
                disabled={!asset || amount === 0n || overBalance}
                onClick={() =>
                  asset &&
                  approveTx.send({
                    address: asset.token,
                    abi: usdcAbi,
                    functionName: 'approve',
                    args: [d.bridge, maxUint256],
                  })
                }
              >
                {`Approve ${asset?.symbol ?? ''}`}
              </TxButton>
            ) : (
              <TxButton
                tx={redeemTx}
                successLabel="Redeemed"
                disabled={!asset || amount === 0n || overBalance}
                onClick={() =>
                  asset &&
                  redeemTx.send({
                    address: d.bridge,
                    abi: bridgeAbi,
                    functionName: 'redeem',
                    // minPayout 0: the quote is refreshed every second and the demo wants the
                    // revert reasons to come from the protocol's own rules, not from slippage.
                    args: [asset.token, amount, 0n],
                  })
                }
              >
                Redeem now
              </TxButton>
            )}
          </div>
        </Card>

        <Card title="Quote" subtitle="Read live from the chain every second">
          {quote && amount > 0n ? (
            <QuotePanel quote={quote} currentUtilisationBps={p.utilisationBps} />
          ) : (
            <p className="py-10 text-center text-[13px] text-ink-faint">
              Enter an amount to see the live spread decomposition.
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}

export default function HolderPage() {
  return (
    <ChainGuard>
      <Inner />
    </ChainGuard>
  )
}
```

- [ ] **Step 4: Implement the LP page**

`web/src/app/lp/page.tsx`:
```tsx
'use client'

import { useEffect, useMemo, useState } from 'react'
import { maxUint256 } from 'viem'
import { useConnection, useReadContracts } from 'wagmi'
import { ChainGuard } from '@/components/ChainGuard'
import { Num } from '@/components/Num'
import { TxButton } from '@/components/TxButton'
import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { StatTile } from '@/components/ui/StatTile'
import { useAllowance } from '@/hooks/useAllowance'
import { useProtocol } from '@/hooks/useProtocol'
import { useTx } from '@/hooks/useTx'
import { usdcAbi, vaultAbi } from '@/lib/abis'
import { formatBps, formatPct, formatUsdc, parseUnits } from '@/lib/format'
import { useDeployment } from '@/providers/deployment'

function Inner() {
  const d = useDeployment()
  const p = useProtocol()
  const { address } = useConnection()
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit')
  const [raw, setRaw] = useState('')

  const { data } = useReadContracts({
    allowFailure: false,
    contracts: address
      ? [
          { address: d.vault, abi: vaultAbi, functionName: 'balanceOf', args: [address] },
          { address: d.vault, abi: vaultAbi, functionName: 'maxWithdraw', args: [address] },
        ]
      : [],
    query: { enabled: Boolean(address), refetchInterval: 1_000 },
  })

  const shares = (data?.[0] as bigint | undefined) ?? 0n
  const maxWithdraw = (data?.[1] as bigint | undefined) ?? 0n
  const positionValue = (shares * p.sharePrice) / 1_000_000n
  const yieldBps = p.sharePrice > 0n ? ((p.sharePrice - 1_000_000n) * 10_000n) / 1_000_000n : 0n

  const { amount, amountError } = useMemo(() => {
    try {
      return { amount: parseUnits(raw, 6), amountError: undefined }
    } catch (e) {
      return { amount: 0n, amountError: e instanceof Error ? e.message : 'invalid amount' }
    }
  }, [raw])

  const { balance: usdcBalance, allowance, refetch } = useAllowance(d.usdc, d.vault)
  const approveTx = useTx()
  const actionTx = useTx()

  useEffect(() => {
    if (approveTx.status === 'success') refetch()
  }, [approveTx.status, refetch])

  const needsApproval = mode === 'deposit' && amount > 0n && allowance < amount
  const cap = mode === 'deposit' ? usdcBalance : maxWithdraw
  const overCap = amount > cap

  return (
    <div className="space-y-4 py-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Provide liquidity</h1>
        <p className="mt-1 text-[13px] text-ink-dim">
          Fund instant redemptions and earn the spread. Capital is committed for the length of one
          settlement window at a time.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile
          label="Your position"
          value={<Num size="xl">{formatUsdc(positionValue)}</Num>}
          sub={`${formatUsdc(shares)} rnUSDC`}
        />
        <StatTile
          label="Share price"
          value={
            <Num size="xl" tone={yieldBps > 0n ? 'gain' : yieldBps < 0n ? 'loss' : 'default'}>
              {formatUsdc(p.sharePrice, 6)}
            </Num>
          }
          sub={`realised ${formatBps(yieldBps)}`}
        />
        <StatTile
          label="Withdrawable now"
          note="Bounded by idle capital: USDC already advanced to holders cannot be withdrawn until the issuer settles."
          value={<Num size="xl">{formatUsdc(maxWithdraw)}</Num>}
          sub={`${formatUsdc(p.idle)} idle in vault`}
        />
        <StatTile
          label="Utilisation"
          note="Current, not projected."
          value={
            <Num size="xl" tone={p.utilisationBps > 8_000n ? 'warn' : 'default'}>
              {formatPct(p.utilisationBps)}
            </Num>
          }
          sub={`cap ${formatPct(p.maxUtilisationBps)}`}
        />
      </div>

      <Card className="max-w-[460px]">
        <div className="mb-4 flex gap-1 rounded-md border border-line bg-surface-2/50 p-1">
          {(['deposit', 'withdraw'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                setMode(m)
                setRaw('')
              }}
              className={`flex-1 rounded px-3 py-1.5 text-[12px] font-medium capitalize transition-colors ${
                mode === m ? 'bg-surface text-ink shadow-sm' : 'text-ink-dim hover:text-ink'
              }`}
            >
              {m}
            </button>
          ))}
        </div>

        <div className="space-y-4">
          <Input
            label={`${mode} amount`}
            placeholder="0.00"
            value={raw}
            onChange={(e) => setRaw(e.target.value)}
            suffix="USDC"
            error={amountError ?? (overCap ? 'Exceeds available' : undefined)}
            hint={
              <button
                type="button"
                onClick={() => setRaw(formatUsdc(cap, 6).replace(/,/g, ''))}
                className="num text-[11px] text-ink-dim underline hover:text-ink"
              >
                {`max ${formatUsdc(cap)}`}
              </button>
            }
          />

          {needsApproval ? (
            <TxButton
              tx={approveTx}
              successLabel="Approved"
              disabled={amount === 0n || overCap}
              onClick={() =>
                approveTx.send({
                  address: d.usdc,
                  abi: usdcAbi,
                  functionName: 'approve',
                  args: [d.vault, maxUint256],
                })
              }
            >
              Approve USDC
            </TxButton>
          ) : (
            <TxButton
              tx={actionTx}
              successLabel={mode === 'deposit' ? 'Deposited' : 'Withdrawn'}
              disabled={amount === 0n || overCap || !address}
              onClick={() =>
                address &&
                actionTx.send(
                  mode === 'deposit'
                    ? {
                        address: d.vault,
                        abi: vaultAbi,
                        functionName: 'deposit',
                        args: [amount, address],
                      }
                    : {
                        address: d.vault,
                        abi: vaultAbi,
                        functionName: 'withdraw',
                        args: [amount, address, address],
                      },
                )
              }
            >
              {mode === 'deposit' ? 'Deposit USDC' : 'Withdraw USDC'}
            </TxButton>
          )}
        </div>
      </Card>
    </div>
  )
}

export default function LpPage() {
  return (
    <ChainGuard>
      <Inner />
    </ChainGuard>
  )
}
```

- [ ] **Step 5: Typecheck and build**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/web
pnpm typecheck && pnpm build
```
Expected: both clean. Remove any unused import the compiler flags (e.g. `Button` if a page ends up
not using it) rather than suppressing the warning.

- [ ] **Step 6: Do NOT commit.**

---

## Task 6: Admin route and end-to-end demo rehearsal

**Files:**
- Create: `web/src/app/admin/page.tsx`
- Modify: whatever Tasks 4-5 left rough, as the rehearsal reveals it

**Interfaces:**
- Consumes: `useRoles`, `useProtocol`, `useAssets`, `useTx`, all ABIs.

**Spec §6 requirements:** set NAV, set the demo clock (`secondsPerDay`), settle now (demo override),
mint demo USDC / RWA to the connected wallet, fund the issuer, pause/unpause. Visible only when the
wallet holds the admin role.

**Role facts:** the deploy script grants the deployer `DEFAULT_ADMIN_ROLE` and `NAV_UPDATER_ROLE` on
the registry, `DEMO_ADMIN_ROLE` and `PAUSER_ROLE` on the bridge, `PAUSER_ROLE` on the vault, and
`MINTER_ROLE` on MockUSDC and each MockRWAToken. `settle(id)` is permissionless once the window has
elapsed and `DEMO_ADMIN_ROLE`-only before it.

- [ ] **Step 1: Implement the Admin page**

`web/src/app/admin/page.tsx`:
```tsx
'use client'

import { useState } from 'react'
import { useConnection, useReadContract } from 'wagmi'
import { ChainGuard } from '@/components/ChainGuard'
import { Num } from '@/components/Num'
import { TxButton } from '@/components/TxButton'
import { Badge } from '@/components/ui/Badge'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import { useAssets } from '@/hooks/useAssets'
import { useProtocol } from '@/hooks/useProtocol'
import { useRoles } from '@/hooks/useRoles'
import { useTx } from '@/hooks/useTx'
import { bridgeAbi, registryAbi, rwaAbi, usdcAbi } from '@/lib/abis'
import { formatUsdc, formatWad, parseUnits } from '@/lib/format'
import { useDeployment } from '@/providers/deployment'

function safeParse(raw: string, decimals: number): bigint {
  try {
    return parseUnits(raw, decimals)
  } catch {
    return 0n
  }
}

function Inner() {
  const d = useDeployment()
  const p = useProtocol()
  const { assets } = useAssets()
  const { address } = useConnection()
  const { isRegistryAdmin, isDemoAdmin, isLoading } = useRoles()

  const [navToken, setNavToken] = useState<string | undefined>()
  const [navRaw, setNavRaw] = useState('')
  const [clockRaw, setClockRaw] = useState('')
  const [settleId, setSettleId] = useState('')
  const [mintUsdcRaw, setMintUsdcRaw] = useState('100000')
  const [fundRaw, setFundRaw] = useState('500000')

  const navTx = useTx()
  const clockTx = useTx()
  const settleTx = useTx()
  const mintUsdcTx = useTx()
  const mintRwaTx = useTx()
  const fundTx = useTx()
  const pauseTx = useTx()

  const { data: openIds } = useReadContract({
    address: d.bridge,
    abi: bridgeAbi,
    functionName: 'openReceivableIds',
    query: { refetchInterval: 1_000 },
  })

  const selectedAsset = assets.find((a) => a.token === navToken) ?? assets[0]

  if (isLoading) {
    return <p className="py-10 text-[13px] text-ink-faint">Checking roles…</p>
  }

  if (!isRegistryAdmin && !isDemoAdmin) {
    return (
      <Card title="Admin only">
        <p className="text-[13px] text-ink-dim">
          The connected wallet{' '}
          <span className="num">{address ? `${address.slice(0, 10)}…` : ''}</span> holds neither the
          registry admin role nor the bridge demo-admin role. Connect the deployer wallet.
        </p>
      </Card>
    )
  }

  return (
    <div className="space-y-4 py-6">
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Demo controls</h1>
        {isRegistryAdmin && <Badge tone="accent">registry admin</Badge>}
        {isDemoAdmin && <Badge tone="accent">demo admin</Badge>}
      </div>
      <p className="-mt-2 text-[13px] text-ink-dim">
        Everything here is an on-chain transaction. The settle override emits{' '}
        <span className="num">DemoOverride</span>, so a demo shortcut is never mistaken for normal
        settlement.
      </p>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Set NAV" subtitle="Simulate a price move before settlement">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {assets.map((a) => (
                <button
                  key={a.token}
                  type="button"
                  onClick={() => {
                    setNavToken(a.token)
                    setNavRaw(formatWad(a.navPerToken, 6).replace(/,/g, ''))
                  }}
                  className={`rounded-md border px-2.5 py-1.5 text-[12px] ${
                    selectedAsset?.token === a.token
                      ? 'border-accent bg-accent-soft'
                      : 'border-line bg-surface hover:bg-surface-2'
                  }`}
                >
                  {a.symbol}
                </button>
              ))}
            </div>
            <Input
              label="NAV per token"
              value={navRaw}
              onChange={(e) => setNavRaw(e.target.value)}
              suffix="USD"
              hint={
                selectedAsset && (
                  <span className="num text-[11px] text-ink-faint">
                    {`now ${formatWad(selectedAsset.navPerToken)}`}
                  </span>
                )
              }
            />
            <TxButton
              tx={navTx}
              successLabel="NAV updated"
              disabled={!selectedAsset || safeParse(navRaw, 18) === 0n}
              onClick={() =>
                selectedAsset &&
                navTx.send({
                  address: d.registry,
                  abi: registryAbi,
                  functionName: 'setNav',
                  args: [selectedAsset.token, safeParse(navRaw, 18)],
                })
              }
            >
              Set NAV
            </TxButton>
          </div>
        </Card>

        <Card
          title="Demo clock"
          subtitle="secondsPerDay scales the pricing horizon; 60 makes a 120s window read as 2 days"
        >
          <div className="space-y-3">
            <Input
              label="Seconds per day"
              value={clockRaw}
              onChange={(e) => setClockRaw(e.target.value)}
              placeholder="60"
              hint={
                <span className="num text-[11px] text-ink-faint">
                  {`now ${p.secondsPerDay}`}
                </span>
              }
            />
            <div className="flex gap-2">
              {['60', '3600', '86400'].map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setClockRaw(v)}
                  className="num rounded-md border border-line px-2.5 py-1.5 text-[11px] text-ink-dim hover:text-ink"
                >
                  {v}
                </button>
              ))}
            </div>
            <TxButton
              tx={clockTx}
              successLabel="Clock updated"
              disabled={!/^\d+$/.test(clockRaw.trim()) || clockRaw.trim() === '0'}
              onClick={() =>
                clockTx.send({
                  address: d.registry,
                  abi: registryAbi,
                  functionName: 'setSecondsPerDay',
                  args: [Number(clockRaw.trim())],
                })
              }
            >
              Set demo clock
            </TxButton>
          </div>
        </Card>

        <Card
          title="Settle now"
          subtitle="Bypass the settlement window. Emits DemoOverride on chain."
        >
          <div className="space-y-3">
            <Input
              label="Receivable ID"
              value={settleId}
              onChange={(e) => setSettleId(e.target.value)}
              placeholder="1"
              hint={
                <span className="num text-[11px] text-ink-faint">
                  {`open: ${
                    ((openIds ?? []) as readonly bigint[]).map((i) => `#${i}`).join(' ') || 'none'
                  }`}
                </span>
              }
            />
            <div className="flex flex-wrap gap-2">
              {((openIds ?? []) as readonly bigint[]).map((id) => (
                <button
                  key={id.toString()}
                  type="button"
                  onClick={() => setSettleId(id.toString())}
                  className="num rounded-md border border-line px-2.5 py-1.5 text-[11px] text-ink-dim hover:text-ink"
                >
                  {`#${id}`}
                </button>
              ))}
            </div>
            <TxButton
              tx={settleTx}
              variant="secondary"
              successLabel="Settled"
              disabled={!/^\d+$/.test(settleId.trim())}
              onClick={() =>
                settleTx.send({
                  address: d.bridge,
                  abi: bridgeAbi,
                  functionName: 'settle',
                  args: [BigInt(settleId.trim())],
                })
              }
            >
              Settle receivable
            </TxButton>
          </div>
        </Card>

        <Card title="Demo funding" subtitle="Mint test assets to the connected wallet">
          <div className="space-y-4">
            <div className="space-y-2">
              <Input
                label="Mint USDC to me"
                value={mintUsdcRaw}
                onChange={(e) => setMintUsdcRaw(e.target.value)}
                suffix="USDC"
              />
              <TxButton
                tx={mintUsdcTx}
                variant="secondary"
                successLabel="Minted"
                disabled={!address || safeParse(mintUsdcRaw, 6) === 0n}
                onClick={() =>
                  address &&
                  mintUsdcTx.send({
                    address: d.usdc,
                    abi: usdcAbi,
                    functionName: 'mint',
                    args: [address, safeParse(mintUsdcRaw, 6)],
                  })
                }
              >
                Mint USDC
              </TxButton>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] t-caption font-medium text-ink-faint">
                Mint 1,000 of an RWA to me
              </p>
              <div className="flex flex-wrap gap-2">
                {assets.map((a) => (
                  <button
                    key={a.token}
                    type="button"
                    disabled={!address}
                    onClick={() =>
                      address &&
                      mintRwaTx.send({
                        address: a.token,
                        abi: rwaAbi,
                        functionName: 'mint',
                        args: [address, 1_000n * 10n ** 18n],
                      })
                    }
                    className="rounded-md border border-line px-2.5 py-1.5 text-[12px] text-ink-dim hover:text-ink disabled:opacity-50"
                  >
                    {a.symbol}
                  </button>
                ))}
              </div>
              {mintRwaTx.status === 'error' && mintRwaTx.message && (
                <p className="text-[12px] text-loss">{mintRwaTx.message}</p>
              )}
            </div>

            <div className="space-y-2">
              <Input
                label="Fund the issuer"
                value={fundRaw}
                onChange={(e) => setFundRaw(e.target.value)}
                suffix="USDC"
                hint={<span className="text-[11px] text-ink-faint">needs USDC approval first</span>}
              />
              <TxButton
                tx={fundTx}
                variant="secondary"
                successLabel="Funded"
                disabled={safeParse(fundRaw, 6) === 0n}
                onClick={() =>
                  fundTx.send({
                    address: d.issuer,
                    abi: [
                      {
                        type: 'function',
                        name: 'fund',
                        stateMutability: 'nonpayable',
                        inputs: [{ name: 'amount', type: 'uint256' }],
                        outputs: [],
                      },
                    ],
                    functionName: 'fund',
                    args: [safeParse(fundRaw, 6)],
                  })
                }
              >
                Fund issuer
              </TxButton>
            </div>
          </div>
        </Card>

        <Card title="Circuit breaker" subtitle="Pause the bridge to stop new redemptions">
          <div className="flex gap-2">
            <TxButton
              tx={pauseTx}
              variant="danger"
              successLabel="Done"
              onClick={() =>
                pauseTx.send({ address: d.bridge, abi: bridgeAbi, functionName: 'pause' })
              }
            >
              Pause bridge
            </TxButton>
            <TxButton
              tx={pauseTx}
              variant="secondary"
              successLabel="Done"
              onClick={() =>
                pauseTx.send({ address: d.bridge, abi: bridgeAbi, functionName: 'unpause' })
              }
            >
              Unpause
            </TxButton>
          </div>
        </Card>

        <Card title="Vault state" subtitle="Live">
          <dl className="space-y-1.5">
            {(
              [
                ['Total assets', formatUsdc(p.totalAssets)],
                ['Idle', formatUsdc(p.idle)],
                ['Outstanding', formatUsdc(p.outstanding)],
                ['Capacity', formatUsdc(p.capacityUsdc)],
                ['Treasury', formatUsdc(p.treasuryUsdc)],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex items-baseline justify-between gap-4">
                <dt className="text-[12px] text-ink-dim">{k}</dt>
                <dd>
                  <Num size="sm">{v}</Num>
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </div>
  )
}

export default function AdminPage() {
  return (
    <ChainGuard>
      <Inner />
    </ChainGuard>
  )
}
```
> The `fund` ABI is inlined because `fund` is on `MockIssuer` and may or may not appear in the
> generated `issuerAbi` depending on the include glob. If `issuerAbi` does contain `fund`, use it
> and delete the inline literal. Check, do not assume.

- [ ] **Step 2: Typecheck and build**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/web
pnpm typecheck && pnpm build
```
Expected: both clean.

- [ ] **Step 3: End-to-end demo rehearsal against Anvil**

This is the real gate for the whole plan. You are rehearsing spec §8 step by step.

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis
export PATH="$PATH:$HOME/.foundry/bin"

# Clean chain
lsof -nP -iTCP:8545 -sTCP:LISTEN >/dev/null 2>&1 || \
  (cd contracts && anvil --chain-id 31337 --block-time 1 > /tmp/anvil.log 2>&1 &) && sleep 3

cd contracts
cp -n .env.example .env 2>/dev/null || true
forge script script/Deploy.s.sol --rpc-url anvil --broadcast -v
cd ..
pnpm --filter @redeemnow/shared sync

cd web && pnpm dev
```

Then verify each of these by fetching the pages and reading the HTML/console. A browser wallet is
not available to you, so you **cannot** click through the signing flow — verify what you can without
one, and report precisely which steps need the user:

| Check | How |
|---|---|
| `/` returns 200 and renders the ChainGuard connect card | fetch it |
| `/holder`, `/lp`, `/admin` all return 200, no 500, no unhandled exception | fetch each |
| No `node:fs` / server-only import error in the console or build output | check both |
| Recharts renders without a React 19 warning | check the console on `/` |
| The dark theme is applied on first paint (no light flash) | `<html class="dark" data-theme="dark">` present in the initial HTML |
| Fonts loaded | `--font-inter` / `--font-mono-stack` present in the HTML |

Then confirm the contract-side numbers the UI will display, using `cast`, so a wrong figure is
caught here rather than on stage:
```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/contracts
export PATH="$PATH:$HOME/.foundry/bin"
BRIDGE=$(jq -r .bridge deployments/31337.json)
VAULT=$(jq -r .vault deployments/31337.json)
RTSLA=$(jq -r .rTSLA deployments/31337.json)
RPRIV=$(jq -r .rPRIV deployments/31337.json)

# Before any deposit the vault is empty: capacity 0, utilisation 0.
cast call "$VAULT" 'capacityUsdc()(uint256)' --rpc-url anvil
cast call "$VAULT" 'utilisationBps()(uint256)' --rpc-url anvil

# quote() must be callable and return 9 fields; rPRIV must be quotable but not redeemable.
cast call "$BRIDGE" 'quote(address,uint256)((uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint256))' \
  "$RTSLA" 300000000000000000000 --rpc-url anvil
cast call "$BRIDGE" 'curve()(uint16,uint16,uint16)' --rpc-url anvil
```
Record the outputs in your report. The `curve()` call is there specifically to confirm Task 3's
tuple-not-object claim — if it returns three values, the hook is right.

- [ ] **Step 4: Fix what the rehearsal broke**

Any page that 500s, any hook that throws, any number that renders as `NaN`, `undefined`, or with a
float artifact is in scope. Do not paper over a wrong number with a fallback — find out why it is
wrong. Report every fix.

- [ ] **Step 5: Run the one unit test file again**

```bash
cd /Users/velocity/Desktop/Workspaces/Personal/Monad-Metropolis/web
pnpm vitest run test/format.test.ts
```
Expected: still passing. Do not run a bare `vitest run`.

- [ ] **Step 6: Do NOT commit.** Confirm `git log --oneline | head -1` is `53354f8`.

---

## Demo runbook (write this file as the last step of Task 6)

Create `docs/DEMO.md` with the exact sequence below, so the demo is not reconstructed from memory
at the event. Sizes are from spec §8 and were computed against the delivered contracts — do not
change them without recomputing.

```
Terminal 1:  cd contracts && anvil --chain-id 31337 --block-time 1
Terminal 2:  cd contracts && forge script script/Deploy.s.sol --rpc-url anvil --broadcast
             pnpm --filter @redeemnow/shared sync
Terminal 3:  cd keeper && pnpm keeper settle
Terminal 4:  cd keeper && pnpm keeper nav-sim
Terminal 5:  cd web && pnpm dev     -> http://localhost:3000

Wallet: import Anvil account 0 into the browser wallet, add network 31337 / http://127.0.0.1:8545.

1. /lp      Deposit 100,000 USDC.  Capacity then reads 95,000 (95% cap).
2. /holder  Redeem 1,000 rTBILL — spread 4 bps. Talk about the SPREAD and the instant payout.
            Do NOT show the yield number here: LP profit is $0.31 and reads as "nothing happened".
3. /holder  Redeem 300 rTSLA (~$74,550) — spread 287 bps, payout ~$72,410.
            Utilisation jumps to 7455 bps and the curve marker moves. This is the headline leg.
            Do NOT try 2,000 rTSLA: ~$497k exceeds capacity and reverts.
            maxRedeemable(rTSLA) reports ~382 as the conservative ceiling.
4. /holder  Select rPRIV, attempt redeem -> reverts NotEligibleRedeemer, shown decoded.
            This is the eligibility story and the most important thirty seconds of the demo.
5. Wait for the keeper (120 s window) or use /admin "Settle now".
            On the rTSLA leg: LPs earn $1,604.69, treasury takes $534.90.
6. /         Show the receivable book emptying and the share price stepping up.

Known talking points to volunteer before anyone asks:
- The spread prices utilisation and NAV volatility. Issuer credit risk and funding carry are the
  next two terms, not yet in the model.
- The 287 bps on the rTSLA leg is mostly the utilisation term — a statement about vault size, not
  about risk.
- There is no default/write-down path yet for an unpayable receivable.
```

---

## Deferred to a fourth plan, deliberately not built

Recorded so the gaps are known rather than discovered:

- Default / write-down path for an unpayable receivable (Plan 1's parked Important-3). Without it,
  the vault carries an impaired asset at face value and first-movers exit at a fictitious price.
- JIT-liquidity mitigation (lockup or streamed profit) — Plan 1's parked Important-2.
- Fee on net book P&L rather than gross per-receivable profit — Plan 1's parked Important-4.
- `openReceivableIds()` pagination; the array grows without bound and both the keeper and the
  receivable book read all of it every tick.
- Multi-issuer routing via `Asset.issuer` (currently dead data; the bridge routes to one immutable
  issuer).
- Monad testnet deployment. Requires a faucet-funded key, which is the user's action.
