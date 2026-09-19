'use client'

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { maxUint256 } from 'viem'
import { useConnection } from 'wagmi'
import { AssetRail } from '@/components/AssetRail'
import { DeploymentGate } from '@/components/ChainGuard'
import { ConnectGate } from '@/components/ConnectGate'
import { Meter } from '@/components/Meter'
import { Num } from '@/components/Num'
import { QuotePanel } from '@/components/QuotePanel'
import { ReceivableBook } from '@/components/ReceivableBook'
import { TxButton } from '@/components/TxButton'
import { Badge } from '@/components/kit/Badge'
import { Card } from '@/components/kit/Card'
import { Input } from '@/components/kit/Field'
import { useAllowance } from '@/hooks/useAllowance'
import { useAssets, type AssetView } from '@/hooks/useAssets'
import { useProtocol } from '@/hooks/useProtocol'
import { useQuote } from '@/hooks/useQuote'
import { useTx } from '@/hooks/useTx'
import { bridgeAbi, rwaAbi } from '@/lib/abis'
import { formatPct, formatToken, formatUsdc, formatWad, parseUnits } from '@/lib/format'
import { defaultAsset, sampleAmountInput } from '@/lib/sample'
import { useDeployment } from '@/providers/deployment'

function Inner() {
  const d = useDeployment()
  const p = useProtocol()
  const { assets } = useAssets()
  const { isConnected } = useConnection()
  const [selected, setSelected] = useState<string | undefined>()
  const [raw, setRaw] = useState('')

  // Seed the amount from the same sample size the Overview's quote band opens with, so the page
  // arrives with a LIVE QUOTE on screen instead of an empty panel asking to be filled in. Nothing
  // here needs a wallet: the quote, the limits and the book are all public chain state.
  const seed = (a: AssetView) => {
    setSelected(a.token)
    setRaw(sampleAmountInput(a))
  }

  useEffect(() => {
    if (selected) return
    const first = defaultAsset(assets)
    if (first) seed(first)
  }, [assets, selected])

  const asset = assets.find((a) => a.token === selected)

  const { amount, amountError } = useMemo(() => {
    try {
      return { amount: parseUnits(raw, 18), amountError: undefined }
    } catch (e) {
      return { amount: 0n, amountError: e instanceof Error ? e.message : 'invalid amount' }
    }
  }, [raw])

  const { quote } = useQuote(asset?.token, amount)
  const { balance, allowance, refetch } = useAllowance(asset?.token, d.bridge)

  const approveTx = useTx()
  const redeemTx = useTx()

  useEffect(() => {
    if (approveTx.status === 'success') refetch()
  }, [approveTx.status, refetch])

  const needsApproval = amount > 0n && allowance < amount
  const overBalance = isConnected && amount > balance

  const used = asset?.exposureUsdc ?? 0n
  const cap = asset?.exposureCapUsdc ?? 0n
  const headroom = cap > used ? cap - used : 0n
  const spreadUsdc = quote ? quote.navValueUsdc - quote.payout : 0n
  const horizon = asset ? formatWad(asset.horizonDaysWad, 1) : '—'

  return (
    <div className="space-y-6 pt-8 pb-4">
      <header className="max-w-[62ch]">
        <h1 className="t-large-title">Redeem an RWA</h1>
        <p className="t-body mt-2 text-ink-dim">
          Deposit a tokenized asset and receive USDC in this block at NAV minus spread. The protocol
          collects NAV from the issuer at settlement.
        </p>
      </header>

      <section>
        <p className="t-footnote mb-2 text-ink-dim">Asset</p>
        <AssetRail assets={assets} selected={selected} onSelect={(t) => {
          const next = assets.find((a) => a.token === t)
          if (next) seed(next)
        }} />
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,380px)_1fr]">
        <div className="space-y-4">
        <Card title="Redeem" subtitle="Paid out in USDC, in this block">
          <div className="space-y-4">
            {asset && !asset.eligible && (
              <div className="rounded-control border border-warn/40 bg-warn-soft px-3.5 py-3">
                <Badge tone="warn">Issuer eligibility pending</Badge>
                <p className="t-caption mt-2 text-warn">
                  RedeemNow is not yet an eligible redeemer with this asset&apos;s issuer, so it
                  cannot be redeemed. Attempting it reverts on chain — try it.
                </p>
              </div>
            )}

            <Input
              label="Amount"
              placeholder="0.0"
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              suffix={asset?.symbol}
              error={amountError ?? (overBalance ? 'Exceeds your balance' : undefined)}
              hint={
                asset &&
                isConnected && (
                  <button
                    type="button"
                    onClick={() => setRaw(formatToken(balance, 4).replace(/,/g, ''))}
                    className="num t-caption text-ink-dim underline hover:text-ink"
                  >
                    {`balance ${formatToken(balance)}`}
                  </button>
                )
              }
            />

            {/* Only the submit control is gated. The field above stays live because it drives the
                quote, which is a public read. */}
            <ConnectGate action="redeem">
              {needsApproval ? (
                <TxButton
                  tx={approveTx}
                  successLabel="Approved"
                  disabled={!asset || amount === 0n || overBalance}
                  onClick={() =>
                    asset &&
                    approveTx.send({
                      address: asset.token,
                      abi: rwaAbi,
                      functionName: 'approve',
                      args: [d.bridge, maxUint256],
                    })
                  }
                >
                  {`Approve ${asset?.symbol ?? ''}`}
                </TxButton>
              ) : (
                <TxButton
                  tx={redeemTx}
                  successLabel="Redeemed"
                  disabled={!asset || amount === 0n || overBalance}
                  onClick={() =>
                    asset &&
                    redeemTx.send({
                      address: d.bridge,
                      abi: bridgeAbi,
                      functionName: 'redeem',
                      // minPayout 0: the quote is refreshed every second and the demo wants the
                      // revert reasons to come from the protocol's own rules, not from slippage.
                      args: [asset.token, amount, 0n],
                    })
                  }
                >
                  Redeem now
                </TxButton>
              )}
            </ConnectGate>
          </div>
        </Card>

        {/* Tight where the quote is airy: these are the constraints, not the subject. */}
        <Card title="Limits on this trade" contentClassName="px-5 py-2">
          <dl className="divide-y divide-line">
            <Limit
              term={asset ? `Room under ${asset.symbol}'s cap` : 'Room under the asset cap'}
              value={formatUsdc(headroom, 0)}
              foot={`${formatUsdc(used, 0)} of ${formatUsdc(cap, 0)} used`}
              meter={<Meter used={used} cap={cap} />}
            />
            <Limit
              term="Vault capacity now"
              value={formatUsdc(p.capacityUsdc, 0)}
              foot={`${formatUsdc(p.outstanding, 0)} of ${formatUsdc(p.totalAssets, 0)} advanced`}
              meter={<Meter used={p.outstanding} cap={p.totalAssets} />}
            />
            <Limit
              term="Utilisation now"
              value={formatPct(p.utilisationBps)}
              foot={`the quote prices ${quote ? formatPct(quote.utilisationBps) : '—'} after this trade`}
            />
            <Limit term="Settles in" value={`${horizon} days`} foot="at the issuer's window" />
          </dl>
        </Card>
        </div>

        <div className="space-y-4">
        <Card title="Quote" subtitle="Read live from the chain every second">
          {quote && amount > 0n ? (
            <QuotePanel
              quote={quote}
              currentUtilisationBps={p.utilisationBps}
              exposureCapUsdc={asset?.exposureCapUsdc}
              exposureUsdc={asset?.exposureUsdc}
            />
          ) : (
            <p className="t-footnote py-10 text-center text-ink-faint">
              {amountError
                ? 'That amount cannot be parsed.'
                : 'Enter an amount to price a redemption.'}
            </p>
          )}
        </Card>

        <Card
          title="What happens at settlement"
          subtitle="The same trade, followed through to the end"
        >
        <div className="grid gap-x-10 gap-y-6 sm:grid-cols-3">
          <Step head="Now">
            <Num size="body" className="font-semibold">
              {quote ? formatUsdc(quote.payout) : '—'}
            </Num>{' '}
            USDC leaves the vault and reaches the holder in this block. The asset moves to the
            bridge, which now carries the issuer&apos;s obligation.
          </Step>
          <Step head={`In ${horizon} days`}>
            The issuer pays the protocol{' '}
            <Num size="body" className="font-semibold">
              {quote ? formatUsdc(quote.navValueUsdc) : '—'}
            </Num>{' '}
            USDC — par at today&apos;s NAV. Until then the advance sits in the book below as an open
            receivable.
          </Step>
          <Step head="Then">
            The difference,{' '}
            <Num size="body" className="font-semibold">
              {formatUsdc(spreadUsdc)}
            </Num>{' '}
            USDC, is booked: {formatPct(p.protocolFeeBps)} to the protocol treasury, the rest lifts
            the LP share price.
          </Step>
        </div>
        </Card>
        </div>
      </div>

      <Card
        title="Redemptions awaiting settlement"
        subtitle="Every advance the bridge is currently carrying"
      >
        <ReceivableBook
          symbols={Object.fromEntries(assets.map((a) => [a.token.toLowerCase(), a.symbol]))}
          highlightToken={selected}
          empty="Nothing is outstanding. Redeem above and this book fills in the same block."
        />
      </Card>
    </div>
  )
}

function Limit({
  term,
  value,
  foot,
  meter,
}: {
  term: string
  value: string
  foot: string
  meter?: ReactNode
}) {
  return (
    <div className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <dt className="t-footnote text-ink-dim">{term}</dt>
        <dd>
          <Num size="callout" className="font-medium">
            {value}
          </Num>
        </dd>
      </div>
      {meter && <div className="mt-2">{meter}</div>}
      <p className="t-caption mt-1.5 text-ink-faint">{foot}</p>
    </div>
  )
}

function Step({ head, children }: { head: string; children: ReactNode }) {
  return (
    <div className="border-t border-line pt-3 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-5 sm:first:border-l-0 sm:first:pl-0">
      <p className="t-footnote font-medium text-ink">{head}</p>
      <p className="t-callout mt-1.5 text-ink-dim">{children}</p>
    </div>
  )
}

export default function HolderPage() {
  return (
    <DeploymentGate>
      <Inner />
    </DeploymentGate>
  )
}
