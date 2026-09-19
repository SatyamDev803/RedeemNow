import 'server-only'
// Deliberately NOT importing from the '@redeemnow/shared' barrel: packages/shared/src/index.ts
// re-exports its siblings with explicit '.js' extensions (the TS/Node ESM convention, which tsc
// and vitest resolve to the sibling '.ts' file). Turbopack does not perform that substitution for
// a transpiled workspace package, so `next build` fails to resolve './chains.js' etc. through the
// barrel. Both of these live under their own subpath exports in packages/shared/package.json, so
// importing them directly avoids ever touching index.ts and its broken relative imports.
import { parseDeployment, type Deployment } from '@redeemnow/shared/deployments'
import { supportedChains } from '@redeemnow/shared/chains'

// STATIC imports, not `loadDeployment`'s runtime readFileSync.
//
// `loadDeployment` resolves a path relative to its own module URL and reads it with fs at call
// time. That works locally and fails on a hosted deploy: Next.js traces the files a serverless
// function needs by following static imports, and it cannot see through a dynamic fs read, so the
// JSON is simply absent from the bundle. The symptom is the worst kind — the build succeeds, the
// site loads, and every chain reports "no deployment", which looks like a chain problem rather
// than a packaging one.
//
// Importing the JSON makes the addresses part of the bundle, verifiably, at build time.
import monadTestnet from '@redeemnow/shared/deployments/10143.json'
import anvilLocal from '@redeemnow/shared/deployments/31337.json'

const RAW: Record<number, unknown> = {
  10143: monadTestnet,
  31337: anvilLocal,
}

/**
 * Every deployment we have addresses for. A chain with no deployment is omitted rather than fatal,
 * so the app still runs against whichever chains are actually deployed.
 */
export function getDeployments(): Record<number, Deployment> {
  const out: Record<number, Deployment> = {}
  for (const chain of supportedChains) {
    const raw = RAW[chain.id]
    if (!raw) continue
    try {
      out[chain.id] = parseDeployment(chain.id, raw)
    } catch {
      // A malformed file should not take the whole app down; the chain is simply unavailable.
    }
  }
  return out
}
