'use client'

import type { ReactNode } from 'react'
import { useChains, useConnect, useConnectors, useSwitchChain } from 'wagmi'
import { Button } from './ui/Button'
import { useCanTransact, useDeployments } from '@/providers/deployment'

/**
 * Wraps the ONE part of a page that genuinely needs a signer: the submit control.
 *
 * Everything else on Holder and LP — the asset rail, the live quote, capacity, the book — is
 * public chain state and renders unconditionally. So this never takes over a page. Disconnected,
 * it renders a control the same size and in the same place as the button it stands in for, which
 * is why the page does not reflow when a wallet connects.
 */
export function ConnectGate({ children, action }: { children: ReactNode; action: string }) {
  const { connected, rightChain } = useCanTransact()
  const connect = useConnect()
  const connectors = useConnectors()
  const chains = useChains()
  const deployments = useDeployments()
  const switchChain = useSwitchChain()

  if (connected && rightChain) return <>{children}</>

  if (connected && !rightChain) {
    const target = chains.find((c) => deployments[c.id])
    return (
      <div className="space-y-2">
        <Button
          variant="secondary"
          className="h-11 w-full rounded-control text-[15px]"
          disabled={!target || switchChain.isPending}
          onClick={() => target && switchChain.mutate({ chainId: target.id })}
        >
          {target ? `Switch to ${target.name}` : 'No supported network'}
        </Button>
        <p className="t-caption text-ink-faint">
          This wallet is on a network RedeemNow is not deployed to. The figures above are read from{' '}
          {target?.name ?? 'the deployed chain'}.
        </p>
      </div>
    )
  }

  const injected = connectors.find((c) => c.type === 'injected') ?? connectors[0]

  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        className="h-11 w-full rounded-control text-[15px]"
        disabled={connect.isPending || !injected}
        onClick={() => injected && connect.mutate({ connector: injected })}
      >
        {connect.isPending ? 'Connecting…' : `Connect wallet to ${action}`}
      </Button>
      <p className="t-caption text-ink-faint">
        {injected
          ? 'Everything on this page is live chain state; a wallet is needed only to sign.'
          : 'No injected wallet was found in this browser.'}
      </p>
    </div>
  )
}
