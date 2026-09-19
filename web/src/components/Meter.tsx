'use client'

import { cn } from '@/lib/utils'

/**
 * A used-of-capacity bar.
 *
 * The ratio is computed in bigint and only then narrowed to a Number — the result is a percentage
 * clamped to 0..100, i.e. a bar width in pixels, never money.
 */
export function ratioPct(used: bigint, cap: bigint): number {
  if (cap <= 0n) return 0
  const clamped = used > cap ? cap : used < 0n ? 0n : used
  return Number((clamped * 1_000n) / cap) / 10
}

export function Meter({
  used,
  cap,
  className,
  height = 'h-1.5',
}: {
  used: bigint
  cap: bigint
  className?: string
  height?: string
}) {
  const pct = ratioPct(used, cap)
  return (
    <div className={cn('overflow-hidden rounded-full bg-surface-2', height, className)}>
      <div
        className="h-full rounded-full transition-[width] duration-(--dur-std) ease-std"
        style={{
          width: `${pct}%`,
          // Amber past 85% for the same reason utilisation is amber in the decomposition:
          // a limit filling up is a temperature reading.
          backgroundColor: pct > 85 ? 'var(--color-warn)' : 'var(--color-brand)',
        }}
      />
    </div>
  )
}
