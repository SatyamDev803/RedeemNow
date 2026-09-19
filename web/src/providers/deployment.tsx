'use client'

import { createContext, useContext, type ReactNode } from 'react'
import { useChains, useConnection, type Register } from 'wagmi'
import type { Deployment } from '@redeemnow/shared/deployments'

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

/**
 * The chain whose PUBLIC state we read.
 *
 * Every figure on Overview, and all the market context on Holder and LP, is public chain state
 * reachable through the configured http transport. None of it needs a wallet, so a disconnected
 * visitor must still see a full dashboard. The rule:
 *
 *  - connected to a chain we have a deployment for -> read that chain (what the user will sign on);
 *  - otherwise -> the first configured chain we have a deployment for.
 *
 * Callers pass this id to every read so wagmi picks the http transport rather than the connector.
 */
/** The chain ids this app is configured for — `10143 | 31337`, as wagmi's hooks demand. */
export type ReadChainId = Register['config']['chains'][number]['id']

export function useReadChainId(): ReadChainId | undefined {
  const all = useContext(Ctx)
  const { chainId } = useConnection()
  const chains = useChains()
  const chain =
    chains.find((c) => c.id === chainId && all[c.id]) ?? chains.find((c) => all[c.id])
  // wagmi widens both `useChains()[n].id` and `useConnection().chainId` to `number`, while its
  // read hooks want the config's literal union. Every candidate here came out of our own config,
  // so the narrowing is sound.
  return chain?.id as ReadChainId | undefined
}

/** The deployment for the chain we read from. Undefined only when nothing is deployed anywhere. */
export function useMaybeDeployment(): Deployment | undefined {
  const all = useContext(Ctx)
  const id = useReadChainId()
  return id === undefined ? undefined : all[id]
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

/**
 * Is the connected wallet on a chain we can actually transact against? Writes — and only writes —
 * depend on this. Reads use the fallback above.
 */
export function useCanTransact(): { connected: boolean; rightChain: boolean } {
  const all = useContext(Ctx)
  const { isConnected, chainId } = useConnection()
  return {
    connected: isConnected,
    rightChain: chainId !== undefined && Boolean(all[chainId]),
  }
}
