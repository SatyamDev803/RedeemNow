'use client'

import { useReadContract, useReadContracts } from 'wagmi'
import type { Address } from 'viem'
import { bridgeAbi, registryAbi, rwaAbi } from '@/lib/abis'
import { useMaybeDeployment, useReadChainId } from '@/providers/deployment'

const POLL = { refetchInterval: 1_000 } as const

/**
 * `IRWARegistry.AssetClass` enum order, verified against contracts/src/interfaces/IRWARegistry.sol:
 * Treasury, GlobalBond, PrivateCredit, InstitutionalFund, Equity, Commodity. Sentence case per the
 * design system's "no all-caps labels" ruling — this is prose, not a badge eyebrow.
 */
const ASSET_CLASS_LABELS = [
  'Treasury',
  'Global bond',
  'Private credit',
  'Institutional fund',
  'Equity',
  'Commodity',
] as const

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
  /** Expected-loss premium for this asset, in bps. The fourth spread term on a quote. */
  creditBps: bigint
  /** Per-asset exposure ceiling, expressed as bps of vault totalAssets. */
  maxExposureBps: bigint
  assetClass: number
  assetClassLabel: string
  /** Bridge's current outstanding exposure to this asset, in USDC. */
  exposureUsdc: bigint
  /** `assetExposureCapUsdc(token)` — the USDC-denominated cap `maxExposureBps` currently implies. */
  exposureCapUsdc: bigint
}

/**
 * Enumerates assets from the registry rather than from a hardcoded list. Two reasons: the admin can
 * register more, and bridge.maxRedeemable() REVERTS (AssetNotRegistered) for an address the registry
 * does not know, so a hardcoded list that drifts would break the page rather than show a zero.
 */
export function useAssets(): { assets: AssetView[]; isLoading: boolean } {
  const d = useMaybeDeployment()
  // Public reads over the http transport — no wallet required. See useReadChainId.
  const chainId = useReadChainId()

  const { data: count } = useReadContract({
    chainId,
    address: d?.registry,
    abi: registryAbi,
    functionName: 'tokenCount',
    query: { ...POLL, enabled: Boolean(d) },
  })

  const n = count === undefined ? 0 : Number(count)

  const { data: tokenAddrs } = useReadContracts({
    allowFailure: false,
    chainId,
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

  // Six reads per token, batched into one call: the registry's asset config, its horizon, the
  // bridge's conservative redemption ceiling, the token's symbol, and the two exposure figures
  // (current + cap) that make the per-asset credit-risk limit legible. Splitting this into N
  // separate useReadContract calls would multiply RPC round-trips per poll tick.
  const { data: details, isLoading } = useReadContracts({
    allowFailure: false,
    chainId,
    contracts:
      d && tokens.length > 0
        ? tokens.flatMap((t) => [
            { address: d.registry, abi: registryAbi, functionName: 'getAsset' as const, args: [t] as const },
            { address: d.registry, abi: registryAbi, functionName: 'horizonDays' as const, args: [t] as const },
            { address: d.bridge, abi: bridgeAbi, functionName: 'maxRedeemable' as const, args: [t] as const },
            { address: t, abi: rwaAbi, functionName: 'symbol' as const },
            { address: d.bridge, abi: bridgeAbi, functionName: 'exposureUsdc' as const, args: [t] as const },
            {
              address: d.bridge,
              abi: bridgeAbi,
              functionName: 'assetExposureCapUsdc' as const,
              args: [t] as const,
            },
          ])
        : [],
    query: { ...POLL, enabled: Boolean(d) && tokens.length > 0 },
  })

  if (!details) return { assets: [], isLoading: true }

  const STRIDE = 6

  const assets: AssetView[] = tokens.map((token, i) => {
    const base = i * STRIDE
    const a = details[base] as {
      issuer: Address
      navPerToken: bigint
      // uint64 decodes to `bigint` at runtime (viem's cutoff is size > 48 bits) — unlike the
      // uint16/uint32 fields below, this one needs no widening.
      navUpdatedAt: bigint
      settlementWindow: number
      baseSpreadBps: number
      dailyVolBps: number
      creditBps: number
      maxExposureBps: number
      assetClass: number
      eligible: boolean
      enabled: boolean
    }
    const assetClass = a.assetClass
    return {
      token,
      symbol: details[base + 3] as string,
      issuer: a.issuer,
      navPerToken: a.navPerToken,
      navUpdatedAt: a.navUpdatedAt,
      // uint32/uint16 arrive as `number` from viem — widen at the boundary so nothing downstream
      // can accidentally mix BigInt with number.
      settlementWindow: BigInt(a.settlementWindow),
      baseSpreadBps: BigInt(a.baseSpreadBps),
      dailyVolBps: BigInt(a.dailyVolBps),
      eligible: a.eligible,
      enabled: a.enabled,
      horizonDaysWad: details[base + 1] as bigint,
      maxRedeemable: details[base + 2] as bigint,
      creditBps: BigInt(a.creditBps),
      maxExposureBps: BigInt(a.maxExposureBps),
      // uint8 enum — small unsigned integer by construction, kept as `number` (not BigInt) per the
      // AssetView contract: it indexes ASSET_CLASS_LABELS and drives no money/NAV/spread math.
      assetClass,
      assetClassLabel: ASSET_CLASS_LABELS[assetClass] ?? `Class ${assetClass}`,
      exposureUsdc: details[base + 4] as bigint,
      exposureCapUsdc: details[base + 5] as bigint,
    }
  })

  return { assets, isLoading }
}
