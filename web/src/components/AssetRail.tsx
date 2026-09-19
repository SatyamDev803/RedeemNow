'use client'

import { Num } from './Num'
import type { AssetView } from '@/hooks/useAssets'
import { formatBps, formatWad } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * The asset picker, as an even grid of pressable cards.
 *
 * It used to be a `flex-wrap` of intrinsically-sized buttons, which broke 4-then-1 into a ragged
 * block. A fixed column count wraps predictably at every breakpoint, and the extra width buys room
 * for the two figures that actually drive the choice — NAV and the credit premium.
 */
export function AssetRail({
  assets,
  selected,
  onSelect,
}: {
  assets: AssetView[]
  selected: string | undefined
  onSelect: (token: string) => void
}) {
  if (assets.length === 0) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-[76px] rounded-card border border-line bg-surface-2/40" />
        ))}
      </div>
    )
  }

  return (
    <div role="group" aria-label="Asset" className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
      {assets.map((a) => {
        const on = a.token === selected
        return (
          <button
            key={a.token}
            type="button"
            onClick={() => onSelect(a.token)}
            aria-pressed={on}
            className={cn(
              'rounded-card border px-3.5 py-3 text-left transition-colors duration-(--dur-fast) ease-std',
              on
                ? 'border-brand bg-brand-soft'
                : 'border-line bg-surface hover:border-line-firm hover:bg-surface-2/60',
            )}
          >
            <div className="flex items-center gap-1.5">
              <span className="t-callout font-semibold tracking-tight">{a.symbol}</span>
              {!a.enabled ? (
                <span aria-label="disabled" className="size-1.5 rounded-full bg-ink-faint" />
              ) : !a.eligible ? (
                <span aria-label="eligibility pending" className="size-1.5 rounded-full bg-warn" />
              ) : null}
            </div>
            <p className="t-caption mt-0.5 truncate text-ink-faint">{a.assetClassLabel}</p>
            <div className="mt-2 flex items-baseline justify-between gap-2">
              <Num size="caption" tone="dim">
                {formatWad(a.navPerToken)}
              </Num>
              <span
                className="num t-caption"
                style={{ color: 'var(--color-term-credit)' }}
                title="Credit premium"
              >
                {formatBps(a.creditBps)}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
