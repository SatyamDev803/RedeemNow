import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

export type Stat = {
  label: string
  /** Pass a <Num> so the figure ticks when the poll returns a new value. */
  value: ReactNode
  sub?: ReactNode
  /** A short clarifier. Use it whenever the label alone could be read two ways. */
  note?: string
}

/**
 * A row of figures on ONE surface, divided by hairlines — an instrument panel, not a row of
 * identical cards.
 *
 * This is the deliberate counterpart to the hero: the hero is a raised sheet, the strip is flat and
 * quiet, and a viewer's eye lands on the hero first. Five separately-bordered, separately-shadowed
 * cards gave every figure the same weight, which is exactly what made the page read as a template.
 *
 * The hairlines are the container's own background showing through a 1px grid gap, so they stay
 * perfect however the grid wraps — `divide-x` breaks on the second row of a wrapped grid.
 */
export function StatStrip({ items, className }: { items: Stat[]; className?: string }) {
  return (
    <div
      className={cn(
        // Flex-wrap, not a grid: a five-up grid leaves a hole in the last row at two and three
        // columns. Wrapped flex items stretch to fill instead, so the strip stays a solid block of
        // surface at every width.
        'flex flex-wrap gap-px overflow-hidden rounded-card bg-line p-px',
        className,
      )}
    >
      {items.map((s) => (
        <div key={s.label} className="min-w-0 flex-1 basis-[180px] bg-surface px-5 py-4">
          <div className="flex items-baseline gap-1.5">
            <span className="t-footnote text-ink-dim">{s.label}</span>
            {s.note && (
              <Tooltip>
                <TooltipTrigger
                  aria-label={`About ${s.label}`}
                  className="rounded-full text-[11px] leading-none text-ink-faint/70 hover:text-ink-dim focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none"
                >
                  &#9432;
                </TooltipTrigger>
                <TooltipContent className="t-caption max-w-[260px] leading-snug">
                  {s.note}
                </TooltipContent>
              </Tooltip>
            )}
          </div>
          <div className="mt-2">{s.value}</div>
          {s.sub && <div className="t-caption mt-1.5 text-ink-faint">{s.sub}</div>}
        </div>
      ))}
    </div>
  )
}
