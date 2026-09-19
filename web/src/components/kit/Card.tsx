import type { ReactNode } from 'react'
import { Card as ShadCard, CardContent, CardHeader } from '@/components/ui/Card'
import { cn } from '@/lib/utils'

/**
 * The app's card. Composed on shadcn's primitive rather than replacing it, so we keep shadcn's
 * structure and data-slot hooks while presenting the title/subtitle/actions API the pages already
 * speak. shadcn is meant to be owned and composed — this is that layer.
 *
 * Note the file lives under components/kit/, not components/ui/. macOS is case-INSENSITIVE, so a
 * `ui/Card.tsx` of ours and shadcn's `ui/card.tsx` are the same file, and `shadcn add` silently
 * overwrites. Keeping our layer in its own directory makes that collision impossible.
 */
export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  contentClassName,
}: {
  title?: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  contentClassName?: string
}) {
  return (
    <ShadCard className={cn('gap-0 overflow-hidden py-0', className)}>
      {(title || actions) && (
        <CardHeader className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="min-w-0">
            {title && (
              <h2 className="t-title-3 truncate text-ink">{title}</h2>
            )}
            {subtitle && <p className="t-footnote mt-1 text-ink-faint">{subtitle}</p>}
          </div>
          {actions}
        </CardHeader>
      )}
      <CardContent className={cn('px-5 py-5', contentClassName)}>{children}</CardContent>
    </ShadCard>
  )
}
