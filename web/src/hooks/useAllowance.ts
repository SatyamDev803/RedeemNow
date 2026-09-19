'use client'

import { useCallback } from 'react'
import { useConnection, useReadContracts } from 'wagmi'
import type { Address } from 'viem'
import { usdcAbi } from '@/lib/abis'
import { useMaybeDeployment } from '@/providers/deployment'

const POLL = { refetchInterval: 1_000 } as const

/**
 * The connected wallet's balance of `token` and its allowance to `spender`, batched into one
 * multicall. Both routes that spend a token need the pair together — a balance without an
 * allowance cannot tell you whether to show Approve or the action button.
 *
 * `usdcAbi` stands in as the generic ERC20 view interface here: `balanceOf` and `allowance` have
 * identical selectors and return shapes in both generated token ABIs, and a view call decodes no
 * custom errors, so the choice is immaterial for reads. Writes are different — those pass the
 * token's own generated ABI so useTx can decode ERC20InsufficientAllowance and friends by name.
 *
 * Returns 0n for both while disconnected or before the first read resolves, so callers never see
 * undefined and "needs approval" is the safe default rather than a crash.
 */
export function useAllowance(
  token: Address | undefined,
  spender: Address | undefined,
): { balance: bigint; allowance: bigint; isLoading: boolean; refetch: () => void } {
  const d = useMaybeDeployment()
  const { address } = useConnection()
  const enabled = Boolean(d && token && spender && address)

  const { data, isLoading, refetch } = useReadContracts({
    allowFailure: false,
    contracts:
      token && spender && address
        ? [
            { address: token, abi: usdcAbi, functionName: 'balanceOf', args: [address] } as const,
            {
              address: token,
              abi: usdcAbi,
              functionName: 'allowance',
              args: [address, spender],
            } as const,
          ]
        : [],
    query: { ...POLL, enabled },
  })

  // refetch() from TanStack returns a promise; callers only ever want the side effect, and an
  // unhandled rejection from a poll that will retry anyway is noise.
  const refresh = useCallback(() => {
    void refetch()
  }, [refetch])

  return {
    balance: (data?.[0] as bigint | undefined) ?? 0n,
    allowance: (data?.[1] as bigint | undefined) ?? 0n,
    isLoading: enabled && isLoading,
    refetch: refresh,
  }
}
