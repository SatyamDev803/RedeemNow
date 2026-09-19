'use client'

import { Num } from './Num'
import { SpreadBar } from './SpreadBar'
import { Badge } from '@/components/kit/Badge'
import { formatPct, formatUsdc } from '@/lib/format'
import type { Quote } from '@/hooks/useQuote'

/**
 * The quote. Structure, top to bottom: what the asset is worth at NAV, what you receive now, then
 * WHY the difference exists. The decomposition is the largest thing on the panel because it is the
 * product's whole claim.
 */
export function QuotePanel({
  quote,
  currentUtilisationBps,
  exposureCapUsdc,
  exposureUsdc,
}: {
  quote: Quote
  currentUtilisationBps: bigint
  exposureCapUsdc?: bigint
  exposureUsdc?: bigint
}) {
  const overCapacity = quote.payout > quote.capacityUsdc

  // The contract's check is `exposureUsdc[token] + payout > cap`, so the figure that actually
  // constrains this trade is the REMAINING headroom under the cap, not the cap itself. Comparing
  // against the raw cap under-warns on any asset that already carries exposure — which in the
  // scripted demo is exactly the state the rCREDIT cap is shown binding in: 8,000 cap, 5,166.77
  // already used, so the true ceiling for the next trade is 2,833.23.
  const assetHeadroom =
    exposureCapUsdc === undefined
      ? undefined
      : exposureCapUsdc > (exposureUsdc ?? 0n)
        ? exposureCapUsdc - (exposureUsdc ?? 0n)
        : 0n

  const overExposure = assetHeadroom !== undefined && quote.payout > assetHeadroom
  // Which limit actually binds? Showing both without saying which is the smaller is useless.
  const binding =
    assetHeadroom !== undefined && assetHeadroom < quote.capacityUsdc
      ? { label: "this asset's cap", value: assetHeadroom }
      : { label: "the vault's capacity", value: quote.capacityUsdc }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <p className="t-footnote text-ink-dim">You receive now</p>
          <Num size="metric-lg" tone={overCapacity || overExposure ? 'loss' : 'default'}>
            {formatUsdc(quote.payout)}
          </Num>
        </div>
        <div className="text-right">
          <p className="t-footnote text-ink-dim">Value at NAV</p>
          <Num size="metric" tone="dim">
            {formatUsdc(quote.navValueUsdc)}
          </Num>
        </div>
      </div>

      <div>
        <p className="t-footnote mb-2.5 text-ink-dim">
          The difference is the spread, and it prices four separate risks.
        </p>
        <SpreadBar terms={quote} />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {/* Design system rule 1: a utilisation figure is NEVER shown unlabelled, because two
            different correct values exist. This one is projected. */}
        <Badge tone={quote.utilisationBps > 8_000n ? 'warn' : 'neutral'}>
          {`Utilisation after this trade ${formatPct(quote.utilisationBps)}`}
        </Badge>
        <Badge tone="neutral">{`Now ${formatPct(currentUtilisationBps)}`}</Badge>
        <Badge tone={overCapacity || overExposure ? 'loss' : 'neutral'}>
          {`Room left under ${binding.label} ${formatUsdc(binding.value, 0)}`}
        </Badge>
      </div>

      {overExposure && (
        <p className="t-footnote text-loss">
          This size is over the per-asset exposure limit and would be rejected. The limit is tighter
          for assets carrying more credit risk. Reduce the amount, or wait for an open receivable on
          this asset to settle.
        </p>
      )}
      {overCapacity && !overExposure && (
        <p className="t-footnote text-loss">
          This size is over what the vault can fund right now. Reduce the amount, or add liquidity.
        </p>
      )}
    </div>
  )
}
