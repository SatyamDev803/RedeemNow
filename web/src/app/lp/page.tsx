'use client'

import { useEffect, useMemo, useState } from 'react'
import { maxUint256 } from 'viem'
import { useConnection, useReadContracts } from 'wagmi'
import { DeploymentGate } from '@/components/ChainGuard'
import { ConnectGate } from '@/components/ConnectGate'
import { Num } from '@/components/Num'
import { ReceivableBook } from '@/components/ReceivableBook'
import { TxButton } from '@/components/TxButton'
import { UtilisationCurve } from '@/components/UtilisationCurve'
import { Card } from '@/components/kit/Card'
import { Input } from '@/components/kit/Field'
import { StatStrip } from '@/components/kit/StatStrip'
import { useAssets } from '@/hooks/useAssets'
import { useAllowance } from '@/hooks/useAllowance'
import { useProtocol } from '@/hooks/useProtocol'
import { useTx } from '@/hooks/useTx'
import { usdcAbi, vaultAbi } from '@/lib/abis'
import { formatBps, formatPct, formatUsdc, parseUnits } from '@/lib/format'
import { useDeployment, useReadChainId } from '@/providers/deployment'

function Inner() {
  const d = useDeployment()
  const p = useProtocol()
  const chainId = useReadChainId()
  const { assets } = useAssets()
  const { address } = useConnection()
  const [mode, setMode] = useState<'deposit' | 'withdraw'>('deposit')
  const [raw, setRaw] = useState('')

  // Both position reads batched into one multicall — two separate hooks at a 1s poll would double
  // the round-trips for no reason.
  const { data } = useReadContracts({
    allowFailure: false,
    chainId,
    contracts: address
      ? [
          { address: d.vault, abi: vaultAbi, functionName: 'balanceOf', args: [address] },
          { address: d.vault, abi: vaultAbi, functionName: 'maxWithdraw', args: [address] },
        ]
      : [],
    query: { enabled: Boolean(address), refetchInterval: 1_000 },
  })

  const shares = (data?.[0] as bigint | undefined) ?? 0n
  const maxWithdraw = (data?.[1] as bigint | undefined) ?? 0n
  const positionValue = (shares * p.sharePrice) / 1_000_000n
  const yieldBps = p.sharePrice > 0n ? ((p.sharePrice - 1_000_000n) * 10_000n) / 1_000_000n : 0n

  const { amount, amountError } = useMemo(() => {
    try {
      return { amount: parseUnits(raw, 6), amountError: undefined }
    } catch (e) {
      return { amount: 0n, amountError: e instanceof Error ? e.message : 'invalid amount' }
    }
  }, [raw])

  const { balance: usdcBalance, allowance, refetch } = useAllowance(d.usdc, d.vault)
  const approveTx = useTx()
  const actionTx = useTx()

  useEffect(() => {
    if (approveTx.status === 'success') refetch()
  }, [approveTx.status, refetch])

  const needsApproval = mode === 'deposit' && amount > 0n && allowance < amount
  const cap = mode === 'deposit' ? usdcBalance : maxWithdraw
  const overCap = Boolean(address) && amount > cap

  return (
    <div className="space-y-6 pt-8 pb-4">
      <header className="max-w-[62ch]">
        <h1 className="t-large-title">Provide liquidity</h1>
        <p className="t-body mt-2 text-ink-dim">
          Fund instant redemptions and earn the spread. Capital is committed for the length of one
          settlement window at a time.
        </p>
      </header>

      <StatStrip
        items={[
          {
            label: 'Your position',
            value: <Num size="metric">{address ? formatUsdc(positionValue) : '—'}</Num>,
            sub: address ? `${formatUsdc(shares)} rnUSDC` : 'connect a wallet to see your shares',
          },
          {
            label: 'Share price',
            value: (
              <Num size="metric" tone={yieldBps > 0n ? 'gain' : yieldBps < 0n ? 'loss' : 'default'}>
                {formatUsdc(p.sharePrice, 6)}
              </Num>
            ),
            sub: `realised ${formatBps(yieldBps)} since inception`,
          },
          {
            label: 'Withdrawable now',
            note: 'Bounded by idle capital: USDC already advanced to holders cannot be withdrawn until the issuer settles.',
            value: <Num size="metric">{address ? formatUsdc(maxWithdraw) : '—'}</Num>,
            sub: `${formatUsdc(p.idle)} idle in the vault`,
          },
          {
            label: 'Utilisation',
            note: 'Current, not projected. The holder quote shows utilisation after the trade it is pricing.',
            value: (
              <Num size="metric" tone={p.utilisationBps > 8_000n ? 'warn' : 'default'}>
                {formatPct(p.utilisationBps)}
              </Num>
            ),
            sub: `cap ${formatPct(p.maxUtilisationBps)}`,
          },
        ]}
      />

      {/* A wide, low band between the strip above and the two-column row below: the rhythm of the
          page changes here on purpose, rather than stacking another equal-weight card. */}
      <Card title="Where the capital sits" subtitle="Every LP dollar is either advanced or idle">
        <CapitalSplit
          outstanding={p.outstanding}
          idle={p.idle}
          total={p.totalAssets}
          capacity={p.capacityUsdc}
          maxUtilisationBps={p.maxUtilisationBps}
        />
      </Card>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        <Card title={mode === 'deposit' ? 'Add liquidity' : 'Withdraw liquidity'}>
          <div className="space-y-4">
            {/* Segmented control, Apple's pattern: sunken track, surface thumb with elev-1. */}
            <div className="flex gap-1 rounded-control bg-surface-2 p-1">
              {(['deposit', 'withdraw'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setMode(m)
                    setRaw('')
                  }}
                  aria-pressed={mode === m}
                  className={`t-footnote flex-1 rounded-[6px] px-3 py-1.5 font-medium capitalize transition-colors duration-(--dur-fast) ease-std ${
                    mode === m ? 'bg-surface text-ink elev-1' : 'text-ink-dim hover:text-ink'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>

            <Input
              label={mode === 'deposit' ? 'Deposit amount' : 'Withdraw amount'}
              placeholder="0.00"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              suffix="USDC"
              error={amountError ?? (overCap ? 'Exceeds available' : undefined)}
              hint={
                address && (
                  <button
                    type="button"
                    onClick={() => setRaw(formatUsdc(cap, 6).replace(/,/g, ''))}
                    className="num t-caption text-ink-dim underline hover:text-ink"
                  >
                    {`max ${formatUsdc(cap)}`}
                  </button>
                )
              }
            />

            <ConnectGate action={mode === 'deposit' ? 'deposit' : 'withdraw'}>
              {needsApproval ? (
                <TxButton
                  tx={approveTx}
                  successLabel="Approved"
                  disabled={amount === 0n || overCap}
                  onClick={() =>
                    approveTx.send({
                      address: d.usdc,
                      abi: usdcAbi,
                      functionName: 'approve',
                      args: [d.vault, maxUint256],
                    })
                  }
                >
                  Approve USDC
                </TxButton>
              ) : (
                <TxButton
                  tx={actionTx}
                  successLabel={mode === 'deposit' ? 'Deposited' : 'Withdrawn'}
                  disabled={amount === 0n || overCap || !address}
                  onClick={() =>
                    address &&
                    actionTx.send(
                      mode === 'deposit'
                        ? {
                            address: d.vault,
                            abi: vaultAbi,
                            functionName: 'deposit',
                            args: [amount, address],
                          }
                        : {
                            address: d.vault,
                            abi: vaultAbi,
                            functionName: 'withdraw',
                            args: [amount, address, address],
                          },
                    )
                  }
                >
                  {mode === 'deposit' ? 'Deposit USDC' : 'Withdraw USDC'}
                </TxButton>
              )}
            </ConnectGate>

            <p className="t-caption border-t border-line pt-3 text-ink-faint">
              Deposits mint rnUSDC at the current share price. The share price rises as receivables
              settle and falls if one is written down — it is the LP&apos;s whole P&amp;L.
            </p>
          </div>
        </Card>

        <Card
          title="What the spread pays"
          subtitle="The utilisation term rises with how much of the vault is already committed"
        >
          <UtilisationCurve curve={p.curve} currentBps={p.utilisationBps} />
        </Card>
      </div>

      <Card
        title="What the capital is funding"
        subtitle="Open advances and the spread each one has captured"
      >
        <ReceivableBook
          symbols={Object.fromEntries(assets.map((a) => [a.token.toLowerCase(), a.symbol]))}
          empty="Nothing is advanced right now, so all LP capital is idle and earning nothing."
        />
      </Card>
    </div>
  )
}

/**
 * Advanced against idle, as one bar, with the utilisation cap marked.
 *
 * Amber for the advanced portion is not a decorative choice: this bar IS utilisation, and amber is
 * what utilisation wears in the spread decomposition. The two readings agree by construction.
 */
function CapitalSplit({
  outstanding,
  idle,
  total,
  capacity,
  maxUtilisationBps,
}: {
  outstanding: bigint
  idle: bigint
  total: bigint
  capacity: bigint
  maxUtilisationBps: bigint
}) {
  const advancedPct = total === 0n ? 0 : Number((outstanding * 1_000n) / total) / 10
  const capPct = Number(maxUtilisationBps) / 100

  return (
    <div>
      <div className="relative h-3 w-full overflow-hidden rounded-full bg-surface-2">
        <div
          className="h-full rounded-full transition-[width] duration-(--dur-std) ease-std"
          style={{ width: `${advancedPct}%`, backgroundColor: 'var(--color-term-util)' }}
        />
        <div
          aria-hidden
          className="absolute top-0 h-full w-px bg-ink-faint"
          style={{ left: `${capPct}%` }}
          title={`Utilisation cap ${capPct}%`}
        />
      </div>

      <div className="mt-4 grid gap-px overflow-hidden rounded-control bg-line sm:grid-cols-3">
        <Figure
          label="Advanced to holders"
          value={formatUsdc(outstanding)}
          foot="awaiting settlement"
          swatch="var(--color-term-util)"
        />
        <Figure label="Idle" value={formatUsdc(idle)} foot="available to advance or withdraw" />
        <Figure
          label="Deployable now"
          value={formatUsdc(capacity)}
          foot={`idle, bounded by the ${formatPct(maxUtilisationBps)} utilisation cap`}
        />
      </div>
    </div>
  )
}

function Figure({
  label,
  value,
  foot,
  swatch,
}: {
  label: string
  value: string
  foot: string
  swatch?: string
}) {
  return (
    <div className="bg-surface px-4 py-3">
      <div className="flex items-center gap-1.5">
        {swatch && (
          <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: swatch }} />
        )}
        <span className="t-footnote text-ink-dim">{label}</span>
      </div>
      <div className="mt-1">
        <Num size="body" className="font-semibold">
          {value}
        </Num>
      </div>
      <p className="t-caption mt-0.5 text-ink-faint">{foot}</p>
    </div>
  )
}

export default function LpPage() {
  return (
    <DeploymentGate>
      <Inner />
    </DeploymentGate>
  )
}
