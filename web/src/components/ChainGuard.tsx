'use client'

import type { ReactNode } from 'react'
import { useChains, useConnection, useSwitchChain } from 'wagmi'
import { useDeployments } from '@/providers/deployment'
import { Button } from './ui/Button'
import { ConnectButton } from './ConnectButton'

/**
 * Renders children only when a signer is present on a chain we have a deployment for.
 *
 * This is now used by ONE route: /admin, an operations console where every control is a
 * transaction behind an on-chain role, so there is nothing to show a visitor without a wallet.
 * Overview, Holder and LP read public chain state and are not gated at all — only their submit
 * controls are, through <ConnectGate/>.
 */
export function ChainGuard({ children }: { children: ReactNode }) {
  const { isConnected, chainId } = useConnection()
  const chains = useChains()
  const switchChain = useSwitchChain()
  const deployments = useDeployments()
  const deployed = chains.filter((c) => deployments[c.id])

  if (!isConnected) {
    return (
      <Panel
        title="Connect to operate"
        body="Every control on this page is a transaction behind an on-chain role. The public dashboard needs no wallet — Overview, Holder and LP are live without one."
      >
        <ConnectButton />
      </Panel>
    )
  }

  if (chainId === undefined || !deployments[chainId]) {
    return (
      <Panel
        title="Switch network"
        body={
          deployed.length === 0
            ? 'No deployment was found for any supported chain. Run the deploy script, then `pnpm --filter @redeemnow/shared sync`.'
            : 'This wallet is on a chain RedeemNow is not deployed to.'
        }
      >
        <div className="flex flex-wrap gap-2">
          {deployed.map((c) => (
            <Button
              key={c.id}
              variant="secondary"
              disabled={switchChain.isPending}
              onClick={() => switchChain.mutate({ chainId: c.id })}
            >
              Switch to {c.name}
            </Button>
          ))}
        </div>
      </Panel>
    )
  }

  return <>{children}</>
}

/**
 * Nothing deployed anywhere is a developer-environment failure, not a user state — but it must not
 * be a thrown exception on a page that otherwise needs no wallet.
 */
export function DeploymentGate({ children }: { children: ReactNode }) {
  const deployments = useDeployments()
  if (Object.keys(deployments).length === 0) {
    return (
      <Panel
        title="No deployment found"
        body="No deployment file exists for any supported chain. Run the deploy script, then `pnpm --filter @redeemnow/shared sync`."
      >
        {null}
      </Panel>
    )
  }
  return <>{children}</>
}

function Panel({
  title,
  body,
  children,
}: {
  title: string
  body: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-[72vh] items-center justify-center py-10">
      <div className="w-full max-w-[420px] rounded-sheet border border-line bg-surface px-6 py-7 elev-1">
        <h2 className="t-title-3">{title}</h2>
        <p className="t-footnote mt-2 text-ink-dim">{body}</p>
        {children && <div className="mt-5">{children}</div>}
      </div>
    </div>
  )
}
