'use client'

import { useEffect, useRef, useState } from 'react'
import { useConnect, useConnection, useConnectors, useDisconnect } from 'wagmi'

function short(addr: string) {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/**
 * Wallet connect.
 *
 * wagmi 3 has EIP-6963 discovery on by default, so every installed wallet announces itself as its
 * OWN connector — MetaMask, Rabby, Phantom and the generic `injected()` fallback all arrive with
 * `type === 'injected'`. The previous version did `connectors.find(c => c.type === 'injected')`,
 * which silently picked whichever happened to be first: MetaMask was never offered by name, and
 * with several wallets installed it could open the wrong one.
 *
 * So: list what was actually discovered, by name and icon, and let the person choose. With exactly
 * one wallet, skip the menu and connect straight away — a picker with one entry is friction.
 */
export function ConnectButton() {
  const { address, isConnected } = useConnection()
  const connect = useConnect()
  const disconnect = useDisconnect()
  const connectors = useConnectors()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // De-duplicate: the generic `injected()` connector describes the same extension that EIP-6963
  // already announced by name, so leaving both in shows "MetaMask" next to a vaguer "Injected".
  const named = connectors.filter((c) => c.id !== 'injected')
  const choices = named.length > 0 ? named : connectors

  // Discovery is async and runs on the client, so `choices` is empty on the server and for the
  // first client frame. Rendering "no wallet found" during that window would be wrong, hence the
  // mounted flag.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

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

  const btn =
    't-caption rounded-control bg-brand px-3 py-1.5 font-medium text-brand-ink transition-colors ' +
    'duration-(--dur-fast) ease-std hover:bg-brand-hover disabled:opacity-50'

  // No wallet extension at all. A disabled button that does nothing reads as a broken app, so say
  // what is missing and where to get it.
  if (mounted && choices.length === 0) {
    return (
      <a
        href="https://metamask.io/download/"
        target="_blank"
        rel="noreferrer noopener"
        className="t-caption rounded-control border border-line bg-surface px-3 py-1.5 font-medium text-ink-dim transition-colors duration-(--dur-fast) ease-std hover:text-ink"
        title="No browser wallet detected"
      >
        Install a wallet
      </a>
    )
  }

  if (choices.length === 1 && choices[0]) {
    const only = choices[0]
    return (
      <button
        type="button"
        disabled={connect.isPending}
        onClick={() => connect.mutate({ connector: only })}
        className={btn}
      >
        {connect.isPending ? 'Connecting…' : `Connect ${only.name}`}
      </button>
    )
  }

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        disabled={connect.isPending}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={btn}
      >
        {connect.isPending ? 'Connecting…' : 'Connect wallet'}
      </button>

      {open && (
        <div
          role="menu"
          className="elev-2 absolute right-0 z-50 mt-1.5 w-56 overflow-hidden rounded-card border border-line bg-surface py-1"
        >
          {choices.map((c) => (
            <button
              key={c.uid}
              role="menuitem"
              type="button"
              onClick={() => {
                setOpen(false)
                connect.mutate({ connector: c })
              }}
              className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] text-ink transition-colors duration-(--dur-fast) ease-std hover:bg-surface-2"
            >
              {c.icon ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.icon} alt="" aria-hidden className="size-4 rounded" />
              ) : (
                <span aria-hidden className="size-4 rounded bg-surface-2" />
              )}
              {c.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
