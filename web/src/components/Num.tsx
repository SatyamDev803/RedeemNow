'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * A figure in the sans face with TABULAR FIGURES — deliberately not a monospace family.
 * Apple sets numerals this way in Stocks, Numbers and Wallet: columns still align, but the
 * numbers stay in the same typographic voice as their labels. A monospace face here would
 * read as a terminal, which is the opposite of this product's register.
 *
 * Flashes once when the value changes, which is what makes a 1-second polling dashboard
 * feel live. One-shot, never looping, and disabled under prefers-reduced-motion.
 */
export function Num({
  children,
  className = '',
  tone = 'default',
  size = 'body',
}: {
  children: string
  className?: string
  tone?: 'default' | 'dim' | 'faint' | 'gain' | 'loss' | 'warn' | 'accent'
  size?: 'caption' | 'footnote' | 'callout' | 'body' | 'metric' | 'metric-lg'
}) {
  const [flash, setFlash] = useState(false)
  const prev = useRef(children)

  useEffect(() => {
    if (prev.current === children) return
    prev.current = children
    setFlash(true)
    const t = setTimeout(() => setFlash(false), 240)
    return () => clearTimeout(t)
  }, [children])

  const tones = {
    default: 'text-ink',
    dim: 'text-ink-dim',
    faint: 'text-ink-faint',
    gain: 'text-gain',
    loss: 'text-loss',
    warn: 'text-warn',
    accent: 'text-brand',
  } as const

  const sizes = {
    caption: 't-caption num',
    footnote: 't-footnote num',
    callout: 't-callout num',
    body: 't-body num',
    metric: 't-metric',
    'metric-lg': 't-metric-lg',
  } as const

  return (
    <span className={`${sizes[size]} ${tones[tone]} ${flash ? 'tick' : ''} ${className}`}>
      {children}
    </span>
  )
}

/** An address or transaction hash. The ONE place a monospace face is correct. */
export function Hash({ value, chars = 6 }: { value: string; chars?: number }) {
  return (
    <span className="hash t-footnote text-ink-dim" title={value}>
      {value.length > chars * 2 + 2 ? `${value.slice(0, chars)}…${value.slice(-4)}` : value}
    </span>
  )
}
