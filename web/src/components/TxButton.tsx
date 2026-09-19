'use client'

import type { ReactNode } from 'react'
import { Button } from './ui/Button'
import { Spinner } from './ui/Spinner'
import type { useTx } from '@/hooks/useTx'

/**
 * A write button that surfaces every transaction state inline, including a decoded custom error.
 * The revert path is load-bearing for the demo: attempting rPRIV must read as a deliberate
 * eligibility rule, not as a broken app.
 */
export function TxButton({
  tx,
  onClick,
  disabled,
  children,
  variant = 'primary',
  successLabel = 'Done',
}: {
  tx: ReturnType<typeof useTx>
  onClick: () => void
  disabled?: boolean
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger'
  successLabel?: string
}) {
  const busy = tx.status === 'signing' || tx.status === 'confirming'

  return (
    <div className="space-y-2">
      <Button
        variant={variant}
        disabled={disabled || busy}
        onClick={onClick}
        className="w-full"
      >
        {busy && <Spinner />}
        {tx.status === 'signing'
          ? 'Confirm in wallet…'
          : tx.status === 'confirming'
            ? 'Confirming…'
            : tx.status === 'success'
              ? successLabel
              : children}
      </Button>

      {tx.status === 'error' && tx.message && (
        <div className="rounded-md border border-loss/40 bg-loss-soft px-3 py-2">
          {tx.revert && (
            <p className="num text-[11px] font-medium text-loss">
              {tx.revert.name}
            </p>
          )}
          <p className="mt-0.5 text-[12px] text-loss">{tx.message}</p>
          <button
            type="button"
            onClick={tx.reset}
            className="mt-1.5 text-[11px] text-ink-dim underline hover:text-ink"
          >
            Dismiss
          </button>
        </div>
      )}

      {tx.status === 'success' && tx.hash && (
        <p className="num truncate text-[11px] text-gain" title={tx.hash}>
          {tx.hash}
        </p>
      )}
    </div>
  )
}
