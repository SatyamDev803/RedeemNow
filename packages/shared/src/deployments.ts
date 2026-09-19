// SERVER-ONLY: this module reads node:fs at import time (loadDeployment stats and reads
// deployments/<chainId>.json off disk). It is re-exported from `./index.ts`'s barrel, which makes
// that barrel server-only too — a `"use client"` module must import `@redeemnow/shared/chains` or
// `@redeemnow/shared/pricing` directly instead of the package root, or bundling will pull node:fs
// into client code (or fail outright).
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAddress } from 'viem'
import type { Address } from 'viem'

export const RWA_KEYS = ['rTBILL', 'rJAAA', 'rCREDIT', 'rTSLA', 'rPRIV'] as const
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
///
/// Cached per chainId across calls — the dashboard reads this per request and re-parsing the JSON
/// every time would be wasteful. A long-running process (the keeper, a dev server that never
/// restarts) that redeploys mid-process must invalidate that cache or it will keep serving stale
/// addresses: pass `{ fresh: true }` for a one-off bypass, or call `clearDeploymentCache()` after a
/// redeploy so subsequent calls re-read the file.
/// Validate an already-parsed deployment object.
///
/// Exists so a bundler can STATICALLY import the JSON and hand it here, rather than going through
/// `loadDeployment`'s runtime `readFileSync`. Next.js cannot trace a dynamic fs read into a
/// serverless bundle, so on a hosted deploy the file is simply absent and every chain looks
/// undeployed — a failure that only shows up in production.
export function parseDeployment(chainId: number, parsed: unknown): Deployment {
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
    try {
      out[k] = getAddress(v)
    } catch (err) {
      throw new Error(
        `deployment for chain ${chainId} has a malformed address for "${k}": ${v}`,
        { cause: err },
      )
    }
  }
  return out
}

export function loadDeployment(chainId: number, opts?: { fresh?: boolean }): Deployment {
  if (!opts?.fresh) {
    const hit = cache.get(chainId)
    if (hit) return hit
  }

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
    try {
      out[k] = getAddress(v)
    } catch (err) {
      throw new Error(
        `deployment for chain ${chainId} has a malformed address for "${k}": ${v}`,
        { cause: err },
      )
    }
  }

  cache.set(chainId, out)
  return out
}

/// Drops all cached deployments so the next `loadDeployment` call re-reads from disk. Call this
/// (or pass `{ fresh: true }`) from a long-running process — e.g. the keeper — after a redeploy;
/// otherwise it keeps serving addresses from the previous deployment for the rest of its process
/// lifetime.
export function clearDeploymentCache(): void {
  cache.clear()
}
