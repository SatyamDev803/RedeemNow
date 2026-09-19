'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useBlockNumber, useChains } from 'wagmi'
import { ConnectButton } from './ConnectButton'
import { useReadChainId } from '@/providers/deployment'
import { useTheme } from '@/providers/theme'

const LINKS = [
  { href: '/', label: 'Overview' },
  { href: '/holder', label: 'Holder' },
  { href: '/lp', label: 'LP' },
  { href: '/admin', label: 'Admin' },
] as const

/**
 * The live-chain readout. It earns its place twice: it tells an operator which chain the figures
 * on screen came from, and it makes visible — before anyone connects anything — that this
 * dashboard is reading a chain rather than waiting for a wallet.
 */
function ChainChip() {
  const chainId = useReadChainId()
  const chains = useChains()
  const chain = chains.find((c) => c.id === chainId)
  const { data: block } = useBlockNumber({
    chainId,
    query: { enabled: chainId !== undefined, refetchInterval: 2_000 },
  })

  if (!chain) return null

  return (
    <div
      className="hidden items-center gap-2 rounded-full border border-line bg-surface px-2.5 py-1 md:flex"
      title={`Reading ${chain.name} (chain ${chain.id})`}
    >
      <span
        aria-hidden
        className={`size-1.5 rounded-full ${block === undefined ? 'bg-ink-faint' : 'bg-gain'}`}
      />
      <span className="t-caption text-ink-dim">{chain.name}</span>
      <span className="num t-caption text-ink-faint">
        {block === undefined ? '—' : `#${block.toString()}`}
      </span>
    </div>
  )
}

export function Nav() {
  const path = usePathname()
  const { theme, toggle } = useTheme()

  return (
    <header className="material-bar sticky top-0 z-20 border-b border-line">
      <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-x-5 gap-y-3 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-baseline gap-2.5">
          <span className="t-callout font-semibold tracking-tight">RedeemNow</span>
          <span className="hidden h-3 w-px bg-line sm:block" />
          <span className="t-caption hidden text-ink-faint sm:inline">instant RWA redemption</span>
        </Link>

        <nav className="order-3 -mx-1 flex w-full gap-0.5 overflow-x-auto sm:order-none sm:w-auto">
          {LINKS.map((l) => {
            const active = l.href === '/' ? path === '/' : path.startsWith(l.href)
            return (
              <Link
                key={l.href}
                href={l.href}
                aria-current={active ? 'page' : undefined}
                className={`t-footnote shrink-0 rounded-control px-3 py-1.5 transition-colors duration-(--dur-fast) ease-std ${
                  active
                    ? 'bg-surface-2 font-medium text-ink'
                    : 'text-ink-dim hover:bg-surface-2/60 hover:text-ink'
                }`}
              >
                {l.label}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <ChainChip />
          <button
            type="button"
            onClick={toggle}
            aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
            className="t-caption rounded-control border border-line px-2.5 py-1.5 text-ink-dim transition-colors duration-(--dur-fast) ease-std hover:text-ink"
          >
            {theme === 'dark' ? 'Light' : 'Dark'}
          </button>
          <ConnectButton />
        </div>
      </div>
    </header>
  )
}
