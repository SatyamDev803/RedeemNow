'use client'

import { DeploymentGate } from '@/components/ChainGuard'
import { Meter } from '@/components/Meter'
import { Num } from '@/components/Num'
import { QuoteBand } from '@/components/QuoteBand'
import { ReceivableBook } from '@/components/ReceivableBook'
import { UtilisationCurve } from '@/components/UtilisationCurve'
import { Badge } from '@/components/kit/Badge'
import { Card } from '@/components/kit/Card'
import { StatStrip } from '@/components/kit/StatStrip'
import { Table, Td, Th } from '@/components/kit/Table'
import { useAssets } from '@/hooks/useAssets'
import { useProtocol } from '@/hooks/useProtocol'
import { formatBps, formatPct, formatUsdc, formatWad } from '@/lib/format'
import { useMaybeDeployment } from '@/providers/deployment'

function Inner() {
  const p = useProtocol()
  const { assets } = useAssets()
  const d = useMaybeDeployment()

  // `treasuryUsdc` is balanceOf(treasury), which equals accrued protocol fees only when the
  // treasury is an address that holds nothing else. Deploy.s.sol now defaults it to a distinct
  // account; a deployment made before that change still has treasury == deployer, where the figure
  // is the deployer's whole USDC balance. Say so rather than print a number that is off by 10x.
  const treasuryIsDeployer =
    d !== undefined && d.treasury.toLowerCase() === d.deployer.toLowerCase()

  const yieldBps = p.sharePrice > 0n ? ((p.sharePrice - 1_000_000n) * 10_000n) / 1_000_000n : 0n
  const symbols = Object.fromEntries(assets.map((a) => [a.token.toLowerCase(), a.symbol]))

  return (
    <div className="space-y-6 pt-8 pb-4">
      <header className="max-w-[60ch]">
        <h1 className="t-large-title">Instant liquidity for tokenized assets</h1>
        <p className="t-body mt-2 text-ink-dim">
          Exit at NAV in one block instead of waiting for the issuer to settle. Everything below is
          live chain state and needs no wallet.
        </p>
      </header>

      {/* The hero. A spread coming apart into its reasons is the most characteristic thing in this
          product's world, so it is what a viewer sees first — and the only raised sheet here. */}
      <QuoteBand />

      {/* Quiet by design: one flat surface divided by hairlines, not five competing cards. */}
      <StatStrip
        items={[
          {
            label: 'Total value locked',
            value: <Num size="metric">{formatUsdc(p.totalAssets)}</Num>,
            sub: 'USDC funding redemptions',
          },
          {
            label: 'Utilisation',
            note: 'Current utilisation: outstanding divided by total assets. The holder quote shows utilisation projected after a trade, which is a different figure.',
            value: (
              <Num size="metric" tone={p.utilisationBps > 8_000n ? 'warn' : 'default'}>
                {formatPct(p.utilisationBps)}
              </Num>
            ),
            sub: `Capped at ${formatPct(p.maxUtilisationBps)}`,
          },
          {
            label: 'Outstanding',
            value: <Num size="metric">{formatUsdc(p.outstanding)}</Num>,
            sub: 'Advanced, awaiting settlement',
          },
          {
            label: 'Share price',
            value: (
              <Num size="metric" tone={yieldBps > 0n ? 'gain' : yieldBps < 0n ? 'loss' : 'default'}>
                {formatUsdc(p.sharePrice, 6)}
              </Num>
            ),
            sub: `${formatBps(yieldBps)} realised since inception`,
          },
          {
            label: 'Protocol fees',
            note: treasuryIsDeployer
              ? 'This deployment set the treasury to the deployer address, so its USDC balance is the deployer’s whole balance rather than accrued fees. Redeploy to separate them.'
              : 'USDC held at the protocol treasury: the protocol’s share of the spread, realised at settlement. The treasury is a distinct address, so this figure is fees and nothing else.',
            value: (
              <Num size="metric" tone={treasuryIsDeployer ? 'faint' : 'default'}>
                {formatUsdc(p.treasuryUsdc)}
              </Num>
            ),
            sub: treasuryIsDeployer
              ? 'treasury shares the deployer address here, so this is not fees alone'
              : `${formatBps(p.protocolFeeBps)} of realised profit`,
          },
        ]}
      />

      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <Card title="Assets" subtitle="Credit premium and exposure limit are set per asset">
          {assets.length === 0 ? (
            <p className="t-footnote py-6 text-center text-ink-faint">Reading the registry…</p>
          ) : (
            <Table
              head={
                <>
                  <Th>Asset</Th>
                  <Th>Class</Th>
                  <Th numeric>NAV</Th>
                  <Th numeric>Credit</Th>
                  {/* The old header said "Exposure used" and printed the CAP. Both figures now
                      appear, in that order, and the bar is the ratio between them. */}
                  <Th numeric>Exposure used / cap</Th>
                  <Th>Status</Th>
                </>
              }
            >
              {assets.map((a) => (
                <tr key={a.token} className="hover:bg-surface-2/50">
                  <Td className="font-medium">{a.symbol}</Td>
                  <Td>
                    <span className="t-callout text-ink-dim">{a.assetClassLabel}</span>
                  </Td>
                  <Td numeric>
                    <Num size="callout">{formatWad(a.navPerToken)}</Num>
                  </Td>
                  <Td numeric>
                    {/* Credit wears its own colour everywhere, including here. Never red: it is a
                        premium the protocol earns, not a loss it takes. */}
                    <span className="num t-callout" style={{ color: 'var(--color-term-credit)' }}>
                      {formatBps(a.creditBps)}
                    </span>
                  </Td>
                  <Td numeric>
                    <div className="flex items-center justify-end gap-2.5">
                      <Meter used={a.exposureUsdc} cap={a.exposureCapUsdc} className="w-14" />
                      <span className="num t-callout whitespace-nowrap">
                        {formatUsdc(a.exposureUsdc, 0)}
                        <span className="text-ink-faint">
                          {` / ${formatUsdc(a.exposureCapUsdc, 0)}`}
                        </span>
                      </span>
                    </div>
                  </Td>
                  <Td>
                    {!a.enabled ? (
                      <Badge tone="neutral">Disabled</Badge>
                    ) : a.eligible ? (
                      <Badge tone="gain">Redeemable</Badge>
                    ) : (
                      <Badge tone="warn">Eligibility pending</Badge>
                    )}
                  </Td>
                </tr>
              ))}
            </Table>
          )}
        </Card>

        <Card
          title="Utilisation curve"
          subtitle="The spread rises with utilisation, steeply past the kink"
        >
          <UtilisationCurve curve={p.curve} currentBps={p.utilisationBps} />
        </Card>
      </div>

      <Card title="Open receivables" subtitle="Redemptions funded and awaiting settlement">
        <ReceivableBook symbols={symbols} />
      </Card>
    </div>
  )
}

export default function OverviewPage() {
  return (
    <DeploymentGate>
      <Inner />
    </DeploymentGate>
  )
}
