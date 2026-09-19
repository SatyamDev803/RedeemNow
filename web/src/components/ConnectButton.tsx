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
        className="hash t-caption rounded-control border border-line bg-surface px-2.5 py-1.5 text-ink-dim transition-colors duration-(--dur-fast) ease-std hover:text-ink"
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
      className="t-caption rounded-control bg-brand px-3 py-1.5 font-medium text-brand-ink transition-colors duration-(--dur-fast) ease-std hover:bg-brand-hover disabled:opacity-50"
    >
      {connect.isPending ? 'Connecting…' : 'Connect wallet'}
    </button>
  )
}
