import type { ReactNode } from 'react'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

/**
 * A single figure with its label. `note` is a real tooltip now rather than a `title` attribute —
 * a native title never appears on touch, never appears for keyboard users, and takes a second to
 * show. The clarifier matters most on `Utilisation`, where two different correct values exist.
 */
export function StatTile({
  label,
  value,
  sub,
  note,
  className,
}: {
  label: string
  /** Pass a <Num> so the figure ticks. */
  value: ReactNode
  sub?: ReactNode
  /** A short clarifier. Use it whenever the label alone could be read two ways. */
  note?: string
  className?: string
}) {
  return (
    <div
      className={cn(
        'rounded-card border border-border bg-surface px-4 py-3.5 transition-colors',
        className,
      )}
    >
      <div className="flex items-baseline gap-1.5">
        <span className="t-footnote text-ink-dim">{label}</span>
        {note && (
          <Tooltip>
            <TooltipTrigger
              aria-label={`About ${label}`}
              className="rounded-full text-[11px] leading-none text-ink-faint/70 hover:text-ink-dim focus-visible:ring-[3px] focus-visible:ring-brand/30 focus-visible:outline-none"
            >
              &#9432;
            </TooltipTrigger>
            <TooltipContent className="t-caption max-w-[260px] leading-snug">
              {note}
            </TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="mt-1.5">{value}</div>
      {sub && <div className="t-caption mt-1.5 text-ink-faint">{sub}</div>}
    </div>
  )
}
