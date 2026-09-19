'use client'

import { useReadContract } from 'wagmi'
import type { Address } from 'viem'
import { bridgeAbi } from '@/lib/abis'
import { useMaybeDeployment, useReadChainId } from '@/providers/deployment'

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
  /** Expected-loss premium, the fourth spread term. spreadBps = baseBps + utilTermBps + timeRiskBps + creditBps. */
  creditBps: bigint
}

/**
 * The authoritative quote. Always read from the chain, never computed locally — this is the number
 * the user is about to sign against, and packages/shared/pricing.ts is a mirror, not the source.
 *
 * Note: every field of `RedemptionBridge.Quote` is declared `uint256` on chain, so all of them
 * (including `creditBps`, appended last in the struct) already decode to `bigint` from viem — no
 * `BigInt(...)` widening is needed here, unlike the registry's `Asset.creditBps` (`uint16`).
 */
export function useQuote(token: Address | undefined, amount: bigint) {
  const d = useMaybeDeployment()
  const chainId = useReadChainId()
  const enabled = Boolean(d && token && amount > 0n)

  const { data, isLoading, error } = useReadContract({
    chainId,
    address: d?.bridge,
    abi: bridgeAbi,
    functionName: 'quote',
    args: token && amount > 0n ? [token, amount] : undefined,
    query: { refetchInterval: 1_000, enabled },
  })

  return { quote: data as Quote | undefined, isLoading: enabled && isLoading, error }
}
