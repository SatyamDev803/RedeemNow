'use client'

import { useEffect, useState } from 'react'
import { Num } from './Num'
import { SpreadBar } from './SpreadBar'
import { Badge } from '@/components/kit/Badge'
import { useAssets } from '@/hooks/useAssets'
import { useQuote } from '@/hooks/useQuote'
import { formatUsdc, formatWad } from '@/lib/format'
import { defaultAsset, sampleAmountWad } from '@/lib/sample'

/**
 * The Overview's hero, and the one loud element on the page.
 *
 * It is a raised sheet — larger radius, the only elev-2 on the route, deliberately more air than
 * anything below it — because a spread coming apart into its four reasons is this product's whole
 * claim. The stat strip beneath is flat and quiet on purpose.
 */
export function QuoteBand() {
  const { assets } = useAssets()
  const [selected, setSelected] = useState<string | undefined>()

  useEffect(() => {
    // Open on the asset that makes the point: the one with the largest credit term.
    if (!selected) setSelected(defaultAsset(assets)?.token)
  }, [assets, selected])

  const asset = assets.find((a) => a.token === selected)
  const amount = asset ? sampleAmountWad(asset) : 0n
  const { quote } = useQuote(asset?.token, amount)

  return (
    <section className="overflow-hidden rounded-sheet bg-surface elev-2">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-3.5 sm:px-7">
        <p className="t-footnote mr-auto text-ink-dim">Live spread</p>
        {/* Segmented control, Apple's pattern: sunken track, surface thumb with elev-1. */}
        <div className="flex flex-wrap justify-end gap-1 rounded-control bg-surface-2 p-1">
          {assets.map((a) => {
            const on = a.token === selected
            return (
              <button
                key={a.token}
                type="button"
                onClick={() => setSelected(a.token)}
                aria-pressed={on}
                className={`t-footnote min-w-[68px] flex-1 rounded-[6px] px-3 py-1.5 transition-colors duration-(--dur-fast) ease-std ${
                  on ? 'bg-surface font-medium text-ink elev-1' : 'text-ink-dim hover:text-ink'
                }`}
              >
                {a.symbol}
              </button>
            )
          })}
        </div>
      </div>

      <div className="grid gap-8 px-5 py-6 sm:px-7 sm:py-8 lg:grid-cols-[1fr_1.15fr] lg:gap-14">
        <div className="flex flex-col gap-5">
          <div>
            <p className="t-footnote text-ink-dim">
              {asset
                ? `Exit ${formatWad(amount, 0)} ${asset.symbol} at NAV ${formatWad(asset.navPerToken)}`
                : 'Reading the chain…'}
            </p>
            <div className="mt-1.5 flex items-baseline gap-2">
              <Num size="metric-lg">{quote ? formatUsdc(quote.payout) : '—'}</Num>
              <span className="t-callout text-ink-faint">USDC</span>
            </div>
            <p className="t-footnote mt-1.5 text-ink-faint">
              paid in this block, against {quote ? formatUsdc(quote.navValueUsdc) : '—'} at NAV
            </p>
          </div>

          {asset && (
            <div className="flex flex-wrap gap-2">
              <Badge tone="neutral">{asset.assetClassLabel}</Badge>
              {asset.eligible ? (
                <Badge tone="gain">Redeemable</Badge>
              ) : (
                <Badge tone="warn">Issuer eligibility pending</Badge>
              )}
              {quote && (
                <Badge tone="neutral">{`Settles in ${formatWad(asset.horizonDaysWad, 1)}d`}</Badge>
              )}
            </div>
          )}

          <p className="t-callout mt-auto max-w-[46ch] text-ink-dim">
            Most tokenized assets settle redemptions at T+1 or later, and many cannot be redeemed at
            all without issuer onboarding. RedeemNow pays now and collects par at settlement.
          </p>
        </div>

        {quote ? (
          <SpreadBar terms={quote} />
        ) : (
          <div className="flex min-h-[220px] items-center justify-center">
            <p className="t-footnote text-ink-faint">Reading the chain…</p>
          </div>
        )}
      </div>
    </section>
  )
}
