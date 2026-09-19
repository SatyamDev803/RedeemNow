import type { ReactNode } from 'react'

export function StatTile({
  label,
  value,
  sub,
  note,
}: {
  label: string
  /** Pass a <Num> so the figure ticks. */
  value: ReactNode
  sub?: ReactNode
  /** A short clarifier. Use it whenever the label alone could be read two ways. */
  note?: string
}) {
  return (
    <div className="rounded-card border border-line bg-surface px-4 py-3.5">
      <div className="flex items-baseline gap-1.5">
        <span className="text-[11px] t-caption font-medium text-ink-faint">
          {label}
        </span>
        {note && (
          <span className="text-[10px] text-ink-faint/70" title={note}>
            ⓘ
          </span>
        )}
      </div>
      <div className="mt-1.5">{value}</div>
      {sub && <div className="mt-1 text-[11px] text-ink-faint">{sub}</div>}
    </div>
  )
}
