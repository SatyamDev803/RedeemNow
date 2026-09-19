'use client'

import type { InputHTMLAttributes, ReactNode } from 'react'
import { useId } from 'react'
import { Input as ShadInput } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

/**
 * A labelled amount field.
 *
 * The label is a real <label htmlFor>, NOT a wrapper element. The previous version nested the hint
 * — which is a <button> ("max") — inside the <label>, producing invalid HTML and an ambiguous
 * accessible name: a screen reader read the button's text as part of the field's label, and
 * clicking the hint could focus the input instead of firing the button.
 */
export function Field({
  label,
  hint,
  suffix,
  error,
  className,
  id,
  ...rest
}: {
  label?: string
  hint?: ReactNode
  suffix?: ReactNode
  error?: string
} & InputHTMLAttributes<HTMLInputElement>) {
  const autoId = useId()
  const inputId = id ?? autoId
  const errorId = `${inputId}-error`

  return (
    <div className="block">
      {(label || hint) && (
        <div className="mb-1.5 flex items-baseline justify-between gap-2">
          {label && (
            <label htmlFor={inputId} className="t-footnote text-ink-dim">
              {label}
            </label>
          )}
          {hint}
        </div>
      )}
      <div
        className={cn(
          'flex items-center gap-2 rounded-control border bg-surface px-3.5 py-3 transition-colors',
          'focus-within:border-brand focus-within:ring-[3px] focus-within:ring-brand/20',
          error ? 'border-loss' : 'border-line-firm',
        )}
      >
        <ShadInput
          {...rest}
          id={inputId}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? errorId : undefined}
          className={cn(
            // The bordered well is OURS; the inner input must be invisible. shadcn's stock
            // `dark:bg-input/30` would otherwise paint a lighter rectangle inside it.
            'num t-body h-auto border-0 bg-transparent p-0 text-ink shadow-none dark:bg-transparent',
            'focus-visible:ring-0 focus-visible:border-0',
            className,
          )}
        />
        {suffix && <span className="t-footnote shrink-0 text-ink-faint">{suffix}</span>}
      </div>
      {error && (
        <p id={errorId} className="t-caption mt-1.5 text-loss">
          {error}
        </p>
      )}
    </div>
  )
}

export { Field as Input }
