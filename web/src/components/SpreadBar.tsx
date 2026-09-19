'use client'

import { Num } from './Num'

/**
 * A single stacked bar that resolves a spread into its four priced components, above the same
 * four numbers as rows. The bar shows PROPORTION; the rows show EXACT FIGURES. That duplication
 * is deliberate — a viewer who distrusts the picture checks the numbers, and vice versa.
 *
 * Colour comes from the validated categorical palette in globals.css. Fixed slot order, never
 * cycled. Credit is violet and never red: it is a premium the protocol earns, not a loss it takes,
 * and red means loss everywhere else in this interface.
 */

export type SpreadTerms = {
  baseBps: bigint
  utilTermBps: bigint
  timeRiskBps: bigint
  creditBps: bigint
  spreadBps: bigint
}

const SLOTS = [
  { key: 'baseBps', label: 'Base', varName: '--color-term-base',
    hint: "The protocol's operating floor." },
  { key: 'utilTermBps', label: 'Utilisation', varName: '--color-term-util',
    hint: 'Rises with how much of the vault is already committed.' },
  { key: 'timeRiskBps', label: 'Time', varName: '--color-term-time',
    hint: 'One standard deviation of NAV movement before settlement.' },
  { key: 'creditBps', label: 'Credit', varName: '--color-term-credit',
    hint: 'Expected loss if the issuer fails to settle.' },
] as const

export function SpreadBar({ terms, className = '' }: { terms: SpreadTerms; className?: string }) {
  const total = terms.spreadBps
  // Guard the divide: a zero-spread quote is legal (all four terms zero).
  const pct = (v: bigint) => (total === 0n ? 0 : Number((v * 10_000n) / total) / 100)

  const parts = SLOTS.map((slot) => {
    const value = terms[slot.key]
    return { ...slot, value, pct: pct(value) }
  })

  const components = terms.baseBps + terms.utilTermBps + terms.timeRiskBps + terms.creditBps

  return (
    <div className={className}>
      {/* The bar. 2px surface gaps between segments, per the dataviz mark spec. */}
      <div
        className="flex h-10 w-full overflow-hidden rounded-control bg-surface-2"
        role="img"
        aria-label={`Spread ${total} basis points: ${parts
          .map((p) => `${p.label} ${p.value}`)
          .join(', ')}`}
      >
        {parts.map((p, i) =>
          p.pct <= 0 ? null : (
            <div
              key={p.key}
              className="relative flex items-center justify-center overflow-hidden transition-[width] duration-(--dur-std) ease-std"
              style={{
                width: `${p.pct}%`,
                backgroundColor: `var(${p.varName})`,
                marginLeft: i === 0 ? 0 : 2,
              }}
              title={`${p.label} — ${p.value} bp`}
            >
              {/* Direct label only where it fits; otherwise the row below carries it. */}
              {p.pct >= 11 && (
                <span className="num t-caption font-medium text-white/95 tabular-nums">
                  {p.value.toString()}
                </span>
              )}
            </div>
          ),
        )}
      </div>

      {/* The same four values as rows, then the total. */}
      <dl className="mt-3">
        {parts.map((p) => (
          <div key={p.key} className="flex items-baseline gap-3 py-1">
            <span
              aria-hidden
              className="mt-[5px] size-2 shrink-0 rounded-full"
              style={{ backgroundColor: `var(${p.varName})` }}
            />
            <dt className="t-footnote text-ink-dim" title={p.hint}>
              {p.label}
            </dt>
            <div className="mx-1 h-px flex-1 self-center bg-line" />
            <dd>
              <Num size="footnote" tone={p.value === 0n ? 'faint' : 'default'}>
                {`${p.value} bp`}
              </Num>
            </dd>
          </div>
        ))}

        <div className="mt-1 flex items-baseline gap-3 border-t border-line pt-2.5">
          <dt className="t-footnote font-medium text-ink">Total spread</dt>
          <div className="mx-1 h-px flex-1 self-center bg-line" />
          <dd>
            <Num size="body" className="font-semibold">{`${total} bp`}</Num>
          </dd>
        </div>
      </dl>

      {/* A cheap invariant, surfaced rather than hidden: the four parts must equal the whole. */}
      {components !== total && (
        <p className="t-caption mt-2 text-loss">
          {`Components sum to ${components} bp but the chain reports ${total} bp — report this.`}
        </p>
      )}
    </div>
  )
}
