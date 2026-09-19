'use client'

import { useMemo } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceDot,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { utilisationTermBps } from '@redeemnow/shared/pricing'

/**
 * The kinked utilisation curve.
 *
 * Design Ruling 3: the plotted line is a MODEL of the configured curve, computed from the
 * validated local mirror of Pricing.sol — no on-chain call can tell you the spread at utilisations
 * the vault is not currently at. The ReferenceDot is the one real reading. The caption says so.
 *
 * Recharts 3 notes:
 *  - ResponsiveContainer's computed size always wins over width/height on the chart, so we size the
 *    container and pass no dimensions to AreaChart.
 *  - ReferenceDot's `alwaysShow`/`isFront` were removed in v3; use `ifOverflow`.
 *  - CartesianGrid must share the axis ids, or grid lines silently vanish. Both axes here are the
 *    default ids, so the grid inherits them.
 */
export function UtilisationCurve({
  curve,
  currentBps,
}: {
  curve: { kinkBps: bigint; slope1Bps: bigint; slope2Bps: bigint }
  currentBps: bigint
}) {
  const data = useMemo(() => {
    const pts: { u: number; bps: number }[] = []
    for (let u = 0; u <= 10_000; u += 100) {
      pts.push({ u: u / 100, bps: Number(utilisationTermBps(BigInt(u), curve)) })
    }
    return pts
  }, [curve])

  // Safe Number() conversions: these are chart pixel coordinates, and every value is a bps figure
  // bounded by 10_000 by construction. No money, NAV or payout math happens here.
  const currentPct = Number(currentBps > 10_000n ? 10_000n : currentBps) / 100
  const currentTerm = Number(utilisationTermBps(currentBps, curve))
  const kinkPct = Number(curve.kinkBps) / 100

  return (
    <div className="w-full">
      {/* The chart owns a fixed box; the caption sits OUTSIDE it, or ResponsiveContainer
          measures a parent whose height the caption is also consuming. */}
      <div className="h-[232px] w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
          <defs>
            {/* The one place a gradient is allowed: under the curve, where it encodes magnitude. */}
            <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.22} />
              <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="var(--color-line)" strokeDasharray="2 4" vertical={false} />
          <XAxis
            dataKey="u"
            // Every 10% rather than recharts' every-other-point default: fewer ticks, all round.
            ticks={[0, 20, 40, 60, 80, 100]}
            tickFormatter={(v: number) => `${v}%`}
            stroke="var(--color-ink-faint)"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
          />
          <YAxis
            // The axis was rendering `20 / 65 / 10 / 55 / 0`: a negative left margin pulled the
            // axis band outside the SVG viewport and clipped the leading digit off every tick
            // (220 -> 20, 165 -> 65, 110 -> 10). A zero margin plus a width that actually fits
            // three digits is the fix — and round ticks beat recharts' 0/55/110/165/220 default
            // on an axis whose job is to be read at a glance from a stage.
            ticks={[0, 50, 100, 150, 200]}
            domain={[0, 'dataMax']}
            tickFormatter={(v: number) => `${v}`}
            stroke="var(--color-ink-faint)"
            tick={{ fontSize: 12 }}
            tickLine={false}
            axisLine={false}
            tickMargin={6}
            width={34}
          />
          <Tooltip
            contentStyle={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-line)',
              borderRadius: 8,
              fontSize: 12,
            }}
            cursor={{ stroke: 'var(--color-line-firm)', strokeWidth: 1 }}
            labelFormatter={(v) => `Utilisation ${String(v)}%`}
            formatter={(v) => [`${String(v)} bps`, 'Utilisation term']}
          />
          <Area
            type="monotone"
            dataKey="bps"
            stroke="var(--color-brand)"
            strokeWidth={2}
            fill="url(#curveFill)"
            dot={false}
            isAnimationActive={false}
          />
          <ReferenceDot
            x={currentPct}
            y={currentTerm}
            r={5}
            fill="var(--color-warn)"
            stroke="var(--color-surface)"
            strokeWidth={2}
            ifOverflow="visible"
          />
        </AreaChart>
      </ResponsiveContainer>
      </div>
      <p className="t-caption mt-2.5 max-w-[60ch] text-ink-faint">
        Utilisation term in bp. Modelled from the on-chain curve parameters (kink {kinkPct}%); the
        marker is the live vault reading, {currentPct.toFixed(2)}%.
      </p>
    </div>
  )
}
