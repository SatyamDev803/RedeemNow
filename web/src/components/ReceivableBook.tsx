'use client'

import { useEffect, useState } from 'react'
import { useBlock, useReadContract, useReadContracts } from 'wagmi'
import type { Address } from 'viem'
import { bridgeAbi } from '@/lib/abis'
import { useDeployment, useReadChainId } from '@/providers/deployment'
import { formatCountdown, formatToken, formatUsdc } from '@/lib/format'
import { Badge } from '@/components/kit/Badge'
import { Num } from './Num'
import { Table, Td, Th } from '@/components/kit/Table'

/**
 * `RedemptionBridge.Receivable`, exactly as the generated ABI declares it. `openedAt` and
 * `settleAfter` are `uint64` on chain, and viem decodes anything wider than 48 bits to `bigint` —
 * so they arrive as bigint, not number, and the countdown subtracts them directly.
 */
type Receivable = {
  id: bigint
  token: Address
  holder: Address
  amount: bigint
  navAtFront: bigint
  advanced: bigint
  expected: bigint
  openedAt: bigint
  settleAfter: bigint
  /** enum Status { Open, Settled, Impaired } — uint8, so `number`. */
  status: number
}

export function ReceivableBook({
  symbols,
  highlightToken,
  empty,
}: {
  symbols: Record<string, string>
  /** Rows for this token are tinted — used on Holder, where one asset is selected. */
  highlightToken?: string
  /** One line explaining why there is nothing, per the rule that no section ends in blank space. */
  empty?: string
}) {
  const d = useDeployment()
  const chainId = useReadChainId()

  const { data: ids } = useReadContract({
    chainId,
    address: d.bridge,
    abi: bridgeAbi,
    functionName: 'openReceivableIds',
    query: { refetchInterval: 1_000 },
  })

  const openIds = (ids ?? []) as readonly bigint[]

  // One batched call for every open receivable. N separate useReadContract calls at a 1s poll would
  // be N round-trips per tick and would fall over on a live demo node.
  const { data } = useReadContracts({
    allowFailure: false,
    chainId,
    contracts: openIds.map((id) => ({
      address: d.bridge,
      abi: bridgeAbi,
      functionName: 'getReceivable' as const,
      args: [id] as const,
    })),
    query: { refetchInterval: 1_000, enabled: openIds.length > 0 },
  })

  // Chain time, not wall-clock: the demo advances the chain clock with evm_increaseTime, and a
  // countdown off Date.now() would disagree with the contract's own >= check.
  const { data: block } = useBlock({ chainId, watch: true })
  const [, setTick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1_000)
    return () => clearInterval(t)
  }, [])

  const now = block?.timestamp ?? 0n
  const rows = (data ?? []) as readonly Receivable[]

  if (ids === undefined) {
    return <p className="t-footnote py-6 text-center text-ink-faint">Reading the chain…</p>
  }

  if (openIds.length === 0) {
    return (
      <p className="t-footnote py-6 text-center text-ink-faint">
        {empty ?? 'No open receivables. Redeem an asset on the Holder page to open one.'}
      </p>
    )
  }

  return (
    <Table
      head={
        <>
          <Th>ID</Th>
          <Th>Asset</Th>
          <Th numeric>Amount</Th>
          <Th numeric>Advanced</Th>
          <Th numeric>Expected at NAV</Th>
          <Th numeric>Spread captured</Th>
          <Th numeric>Settles in</Th>
          <Th>Status</Th>
        </>
      }
    >
      {rows.map((r) => {
        const remaining = r.settleAfter - now
        const due = remaining <= 0n
        const captured = r.expected - r.advanced
        return (
          <tr
            key={r.id.toString()}
            className={
              highlightToken && r.token.toLowerCase() === highlightToken.toLowerCase()
                ? 'bg-brand-soft/50'
                : 'hover:bg-surface-2/50'
            }
          >
            <Td>
              <Num size="footnote" tone="dim">{`#${r.id}`}</Num>
            </Td>
            <Td>{symbols[r.token.toLowerCase()] ?? `${r.token.slice(0, 8)}…`}</Td>
            <Td numeric>
              <Num size="footnote">{formatToken(r.amount)}</Num>
            </Td>
            <Td numeric>
              <Num size="footnote">{formatUsdc(r.advanced)}</Num>
            </Td>
            <Td numeric>
              <Num size="footnote" tone="dim">{formatUsdc(r.expected)}</Num>
            </Td>
            <Td numeric>
              <Num size="footnote" tone={captured >= 0n ? 'gain' : 'loss'}>
                {formatUsdc(captured)}
              </Num>
            </Td>
            <Td numeric>
              <Num size="footnote" tone={due ? 'warn' : 'dim'}>
                {formatCountdown(remaining)}
              </Num>
            </Td>
            <Td>
              <Badge tone={due ? 'warn' : 'accent'}>{due ? 'settleable' : 'open'}</Badge>
            </Td>
          </tr>
        )
      })}
    </Table>
  )
}
