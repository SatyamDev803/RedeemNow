'use client'

import { useReadContracts } from 'wagmi'
import { bridgeAbi, registryAbi, usdcAbi, vaultAbi } from '@/lib/abis'
import { useMaybeDeployment, useReadChainId } from '@/providers/deployment'

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
  // Explicit chainId: these are public reads served by the configured http transport, so they
  // must work with no wallet injected at all — not merely with a wallet that is disconnected.
  const chainId = useReadChainId()

  const vault = d && ({ address: d.vault, abi: vaultAbi } as const)
  const bridge = d && ({ address: d.bridge, abi: bridgeAbi } as const)
  const registry = d && ({ address: d.registry, abi: registryAbi } as const)

  const { data, isLoading } = useReadContracts({
    allowFailure: false,
    chainId,
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
