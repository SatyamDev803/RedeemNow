import type { ReactNode } from 'react'
import { Badge as ShadBadge } from '@/components/ui/Badge'
import { cn } from '@/lib/utils'

/**
 * Tone, not variant. The app labels a badge by what it MEANS — a gain, a loss, a warning — and the
 * mapping to colour lives here, once. shadcn's own variants are presentational and deliberately
 * not exposed to call sites: a page should never be in a position to paint a loss green.
 */
export type Tone = 'neutral' | 'accent' | 'gain' | 'loss' | 'warn'

const TONES: Record<Tone, string> = {
  neutral: 'border-border bg-surface-2 text-ink-dim',
  accent: 'border-brand/30 bg-brand-soft text-brand',
  gain: 'border-gain/30 bg-gain-soft text-gain',
  loss: 'border-loss/30 bg-loss-soft text-loss',
  warn: 'border-warn/30 bg-warn-soft text-warn',
}

export function Badge({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: Tone
  className?: string
}) {
  return (
    <ShadBadge
      variant="outline"
      className={cn(
        't-caption gap-1 rounded-full border px-2.5 py-0.5 font-medium',
        TONES[tone],
        className,
      )}
    >
      {children}
    </ShadBadge>
  )
}
