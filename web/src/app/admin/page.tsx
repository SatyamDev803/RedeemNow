'use client'

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { maxUint256, type Address } from 'viem'
import { useBlock, useConnection, useReadContracts } from 'wagmi'
import { ChainGuard } from '@/components/ChainGuard'
import { Hash, Num } from '@/components/Num'
import { TxButton } from '@/components/TxButton'
import { Badge } from '@/components/kit/Badge'
import { Card } from '@/components/kit/Card'
import { Input } from '@/components/kit/Field'
import { Table, Td, Th } from '@/components/kit/Table'
import { useAllowance } from '@/hooks/useAllowance'
import { useAssets, type AssetView } from '@/hooks/useAssets'
import { useProtocol } from '@/hooks/useProtocol'
import { useRoles } from '@/hooks/useRoles'
import { useTx } from '@/hooks/useTx'
import { bridgeAbi, issuerAbi, registryAbi, rwaAbi, usdcAbi, vaultAbi } from '@/lib/abis'
import { formatBps, formatCountdown, formatUsdc, formatWad, parseUnits } from '@/lib/format'
import { useDeployment } from '@/providers/deployment'

/**
 * `enum Status { Open, Settled, Impaired }` on RedemptionBridge — Impaired was APPENDED, so
 * Open stays 0 and Settled stays 1. Verified against contracts/src/RedemptionBridge.sol.
 */
const OPEN = 0
const SETTLED = 1
const IMPAIRED = 2

/** The demo never opens many receivables; cap the ledger multicall so it cannot grow unbounded. */
const LEDGER_MAX = 40

/**
 * `RedemptionBridge.Receivable`. `openedAt` and `settleAfter` are `uint64` on chain and viem
 * decodes anything wider than 48 bits to `bigint`, so they arrive as bigint, never number.
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
  /** uint8 enum — a small unsigned integer by construction, so `number`. */
  status: number
}

function safeParse(raw: string, decimals: number): bigint {
  try {
    return parseUnits(raw, decimals)
  } catch {
    return 0n
  }
}

const isUint = (raw: string) => /^\d+$/.test(raw.trim()) && raw.trim() !== '0'

// ---------------------------------------------------------------------------
// Roles beyond the three useRoles covers.
//
// Every control on this page is gated on an on-chain `hasRole` read (Design Ruling 5), including
// the ones useRoles does not carry: setNav is NAV_UPDATER_ROLE on the registry (NOT the registry's
// DEFAULT_ADMIN_ROLE), pause/unpause is PAUSER_ROLE on each of the bridge and the vault
// separately, and the demo mints are MINTER_ROLE on MockUSDC and on each MockRWAToken.
// ---------------------------------------------------------------------------

/** Role ids are immutable constants — read once, never polled. */
const CONST_QUERY = { staleTime: Number.POSITIVE_INFINITY, gcTime: Number.POSITIVE_INFINITY } as const

function useAdminRoles(assets: AssetView[]) {
  const d = useDeployment()
  const { address } = useConnection()

  const { data: ids } = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: d.registry, abi: registryAbi, functionName: 'NAV_UPDATER_ROLE' },
      { address: d.bridge, abi: bridgeAbi, functionName: 'PAUSER_ROLE' },
      { address: d.vault, abi: vaultAbi, functionName: 'PAUSER_ROLE' },
      { address: d.usdc, abi: usdcAbi, functionName: 'MINTER_ROLE' },
    ],
    query: CONST_QUERY,
  })

  const navRole = ids?.[0] as `0x${string}` | undefined
  const bridgePauser = ids?.[1] as `0x${string}` | undefined
  const vaultPauser = ids?.[2] as `0x${string}` | undefined
  // MockUSDC and MockRWAToken both declare `MINTER_ROLE = keccak256("MINTER_ROLE")`, so the id read
  // off USDC is the same id the RWA tokens check. Verified in both mock sources.
  const minterRole = ids?.[3] as `0x${string}` | undefined

  const ready = Boolean(address && navRole && bridgePauser && vaultPauser && minterRole)
  const tokens = assets.map((a) => a.token)

  const { data } = useReadContracts({
    allowFailure: false,
    contracts:
      ready && address
        ? [
            { address: d.registry, abi: registryAbi, functionName: 'hasRole', args: [navRole!, address] },
            { address: d.bridge, abi: bridgeAbi, functionName: 'hasRole', args: [bridgePauser!, address] },
            { address: d.vault, abi: vaultAbi, functionName: 'hasRole', args: [vaultPauser!, address] },
            { address: d.usdc, abi: usdcAbi, functionName: 'hasRole', args: [minterRole!, address] },
          ]
        : [],
    query: { enabled: ready, refetchInterval: 5_000 },
  })

  // The per-token minter checks are a SEPARATE multicall on purpose: wagmi's contracts inference
  // cannot reconcile a fixed heterogeneous tuple with an appended mapped array, and widening the
  // abi to `Abi` to force it would throw away the return typing on every other entry.
  const { data: tokenMint } = useReadContracts({
    allowFailure: false,
    contracts:
      ready && address
        ? tokens.map((t) => ({
            address: t,
            abi: rwaAbi,
            functionName: 'hasRole' as const,
            args: [minterRole!, address] as const,
          }))
        : [],
    query: { enabled: ready && tokens.length > 0, refetchInterval: 5_000 },
  })

  const tokenKey = tokens.join(',')
  const tokenMinter = useMemo(() => {
    const map: Record<string, boolean> = {}
    tokenKey
      .split(',')
      .filter(Boolean)
      .forEach((t, i) => {
        map[t.toLowerCase()] = Boolean(tokenMint?.[i])
      })
    return map
  }, [tokenMint, tokenKey])

  return {
    canSetNav: Boolean(data?.[0]),
    canPauseBridge: Boolean(data?.[1]),
    canPauseVault: Boolean(data?.[2]),
    canMintUsdc: Boolean(data?.[3]),
    canMintToken: (t: Address) => Boolean(tokenMinter[t.toLowerCase()]),
  }
}

/** Every receivable the bridge has ever opened, plus the live pause flags and the impair delay. */
function useLedger() {
  const d = useDeployment()

  const { data: head } = useReadContracts({
    allowFailure: false,
    contracts: [
      { address: d.bridge, abi: bridgeAbi, functionName: 'nextId' },
      { address: d.bridge, abi: bridgeAbi, functionName: 'impairAfter' },
      { address: d.bridge, abi: bridgeAbi, functionName: 'paused' },
      { address: d.vault, abi: vaultAbi, functionName: 'paused' },
    ],
    query: { refetchInterval: 1_000 },
  })

  const nextId = (head?.[0] as bigint | undefined) ?? 1n
  // impairAfter is uint32, so viem hands back `number`. Widen at the boundary.
  const impairAfter = head === undefined ? 0n : BigInt(head[1] as number)

  const ids = useMemo(() => {
    const first = nextId > BigInt(LEDGER_MAX) ? nextId - BigInt(LEDGER_MAX) : 1n
    const out: bigint[] = []
    for (let i = first; i < nextId; i++) out.push(i)
    return out
  }, [nextId])

  // One multicall for the whole ledger. N separate reads at a 1s poll would be N round-trips a tick.
  const { data } = useReadContracts({
    allowFailure: false,
    contracts: ids.map((id) => ({
      address: d.bridge,
      abi: bridgeAbi,
      functionName: 'getReceivable' as const,
      args: [id] as const,
    })),
    query: { refetchInterval: 1_000, enabled: ids.length > 0 },
  })

  return {
    rows: (data ?? []) as readonly Receivable[],
    impairAfter,
    bridgePaused: Boolean(head?.[2]),
    vaultPaused: Boolean(head?.[3]),
    isLoading: head === undefined,
  }
}

// ---------------------------------------------------------------------------
// Presentation helpers
// ---------------------------------------------------------------------------

/**
 * A control the wallet may not use. It stays on screen, visibly inert, with the reason stated —
 * an investor asking "what if you are not the risk admin?" gets the answer from the screen rather
 * than from a revert. Never hide a permissioned control and never let it fail silently.
 */
function Gate({ ok, need, children }: { ok: boolean; need: string; children: ReactNode }) {
  return (
    <div>
      <div className={ok ? '' : 'pointer-events-none select-none opacity-40'} aria-disabled={!ok}>
        {children}
      </div>
      {!ok && (
        <p className="t-caption mt-2 text-warn">
          {`Requires ${need}. The connected wallet does not hold it, so this control is disabled.`}
        </p>
      )}
    </div>
  )
}

function RoleChip({ held, label, where }: { held: boolean; label: string; where: string }) {
  return (
    <div className="rounded-control flex items-center justify-between gap-3 bg-surface-2 px-3 py-2">
      <div>
        <p className="t-footnote font-medium">{label}</p>
        <p className="t-caption text-ink-faint">{where}</p>
      </div>
      <Badge tone={held ? 'gain' : 'neutral'}>{held ? 'held' : 'not held'}</Badge>
    </div>
  )
}

function StatusBadge({ status }: { status: number }) {
  if (status === IMPAIRED) return <Badge tone="loss">impaired</Badge>
  if (status === SETTLED) return <Badge tone="neutral">settled</Badge>
  return <Badge tone="accent">open</Badge>
}

/** A row of chips that picks one asset. Same affordance the Holder route uses. */
function AssetChips({
  assets,
  selected,
  onSelect,
}: {
  assets: AssetView[]
  selected: Address | undefined
  onSelect: (a: AssetView) => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {assets.map((a) => {
        const active = a.token === selected
        return (
          <button
            key={a.token}
            type="button"
            onClick={() => onSelect(a)}
            className={`rounded-control border px-3 py-2 text-left transition-colors duration-(--dur-fast) ease-std ${
              active ? 'border-brand bg-brand-soft' : 'border-line bg-surface hover:bg-surface-2'
            }`}
          >
            <span className="t-footnote block font-medium">{a.symbol}</span>
            <Num size="caption" tone="dim">
              {formatWad(a.navPerToken)}
            </Num>
          </button>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------

function Inner() {
  const d = useDeployment()
  const p = useProtocol()
  const { assets } = useAssets()
  const { address } = useConnection()
  const { isRegistryAdmin, isDemoAdmin, isRiskAdmin, isLoading } = useRoles()
  const extra = useAdminRoles(assets)
  const ledger = useLedger()

  // Chain time, not wall clock: the demo advances the chain with anvil_increaseTime, and a
  // countdown off Date.now() would disagree with the contract's own timestamp comparison.
  const { data: block } = useBlock({ watch: true })
  const now = block?.timestamp ?? 0n

  const [selectedToken, setSelectedToken] = useState<Address | undefined>()
  const [navRaw, setNavRaw] = useState('')
  const [creditRaw, setCreditRaw] = useState('')
  const [exposureRaw, setExposureRaw] = useState('')
  const [clockRaw, setClockRaw] = useState('')
  const [mintUsdcRaw, setMintUsdcRaw] = useState('100000')
  const [mintRwaRaw, setMintRwaRaw] = useState('1000')
  const [fundRaw, setFundRaw] = useState('500000')
  const [caseId, setCaseId] = useState<bigint | undefined>()
  const [recoverRaw, setRecoverRaw] = useState('')

  const navTx = useTx()
  const creditTx = useTx()
  const exposureTx = useTx()
  const enabledTx = useTx()
  const clockTx = useTx()
  const settleTx = useTx()
  const mintUsdcTx = useTx()
  const mintRwaTx = useTx()
  const approveIssuerTx = useTx()
  const fundTx = useTx()
  const bridgePauseTx = useTx()
  const vaultPauseTx = useTx()
  const impairTx = useTx()
  const approveBridgeTx = useTx()
  const recoverTx = useTx()

  const issuerAllowance = useAllowance(d.usdc, d.issuer)
  const bridgeAllowance = useAllowance(d.usdc, d.bridge)

  useEffect(() => {
    if (approveIssuerTx.status === 'success') issuerAllowance.refetch()
  }, [approveIssuerTx.status, issuerAllowance])

  useEffect(() => {
    if (approveBridgeTx.status === 'success') bridgeAllowance.refetch()
  }, [approveBridgeTx.status, bridgeAllowance])

  // Default the asset picker to the first registered asset, and seed the editable fields from
  // chain state so the operator edits a real value rather than an empty box.
  const asset = assets.find((a) => a.token === selectedToken) ?? assets[0]
  useEffect(() => {
    if (!selectedToken && assets[0]) setSelectedToken(assets[0].token)
  }, [assets, selectedToken])

  // Seed the editable parameter fields from chain state ONCE per asset selection. `asset` is a new
  // object every poll tick, so the ref guard is what stops a 1-second refetch from overwriting
  // whatever the operator is halfway through typing.
  const seededFor = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!asset || seededFor.current === asset.token) return
    seededFor.current = asset.token
    setNavRaw(formatWad(asset.navPerToken, 6))
    setCreditRaw(asset.creditBps.toString())
    setExposureRaw(asset.maxExposureBps.toString())
  }, [asset])

  const seededClock = useRef(false)
  useEffect(() => {
    if (seededClock.current || p.isLoading) return
    seededClock.current = true
    setClockRaw(p.secondsPerDay.toString())
  }, [p.isLoading, p.secondsPerDay])

  const rows = ledger.rows
  const selectedCase = rows.find((r) => r.id === caseId)

  // The newest thing needing attention: an impaired receivable if there is one, else the newest
  // open one. Chosen so the page opens on the interesting case instead of on nothing.
  useEffect(() => {
    if (caseId !== undefined && rows.some((r) => r.id === caseId)) return
    const impaired = [...rows].reverse().find((r) => r.status === IMPAIRED)
    const open = [...rows].reverse().find((r) => r.status === OPEN)
    const pick = impaired ?? open ?? rows[rows.length - 1]
    if (pick) setCaseId(pick.id)
  }, [rows, caseId])

  // Prefill the recovery field with a full recovery of the advance — zero loss — so the operator
  // types a haircut rather than the whole figure.
  useEffect(() => {
    if (selectedCase?.status === IMPAIRED) {
      setRecoverRaw((cur) => (cur === '' ? formatUsdc(selectedCase.advanced, 6) : cur))
    }
  }, [selectedCase?.status, selectedCase?.advanced])

  const impairedCount = rows.filter((r) => r.status === IMPAIRED).length

  if (isLoading) {
    return <p className="t-footnote py-10 text-ink-faint">Checking roles on chain…</p>
  }

  // A wallet with no operator role still sees the whole page, every control visibly disabled with
  // the role it would need. Hiding the controls would answer "what stops you doing this?" with
  // nothing at all, which is exactly the question an investor asks of an admin screen.
  const anyRole = isRegistryAdmin || isDemoAdmin || isRiskAdmin

  const recoverAmount = safeParse(recoverRaw, 6)
  const impliedLoss = selectedCase ? selectedCase.advanced - recoverAmount : 0n
  const recoverNeedsApproval = recoverAmount > 0n && bridgeAllowance.allowance < recoverAmount
  const fundAmount = safeParse(fundRaw, 6)
  const fundNeedsApproval = fundAmount > 0n && issuerAllowance.allowance < fundAmount

  return (
    <div className="space-y-6 py-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[60ch]">
          <h1 className="t-large-title">Operations</h1>
          <p className="t-body mt-2 text-ink-dim">
            Every control here is an on-chain transaction behind an on-chain role. The settle
            override emits a DemoOverride event, so a demo shortcut is never mistaken for a normal
            settlement.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {ledger.bridgePaused && <Badge tone="loss">bridge paused</Badge>}
          {ledger.vaultPaused && <Badge tone="loss">vault paused</Badge>}
          {impairedCount > 0 && (
            <Badge tone="loss">
              {impairedCount === 1 ? '1 impaired receivable' : `${impairedCount} impaired receivables`}
            </Badge>
          )}
        </div>
      </header>

      <Card
        title="Operator roles"
        subtitle="Read from the chain, never inferred from the address"
        actions={<Hash value={address ?? '—'} chars={10} />}
      >
        {!anyRole && (
          <p className="rounded-control t-footnote mb-3 max-w-[72ch] bg-warn-soft px-3 py-2.5 text-warn">
            This wallet holds no operator role, so every control below is disabled. Nothing is
            hidden: each one states the role it needs. Connect the deployer wallet to run the demo.
          </p>
        )}
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <RoleChip held={isRegistryAdmin} label="Registry admin" where="Asset risk parameters, demo clock" />
          <RoleChip held={extra.canSetNav} label="NAV updater" where="NAV per token on the registry" />
          <RoleChip held={isDemoAdmin} label="Demo admin" where="Settle before the window elapses" />
          <RoleChip held={isRiskAdmin} label="Risk admin" where="Impair and recover a receivable" />
          <RoleChip held={extra.canPauseBridge} label="Pauser, bridge" where="Stop new redemptions" />
          <RoleChip held={extra.canMintUsdc} label="Minter, mock USDC" where="Fund the demo wallet" />
        </div>
      </Card>

      {/* ------------------------------------------------------------------ */}
      {/* Credit impairment — the reason this page exists beyond demo plumbing. */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid gap-4 lg:grid-cols-[1.35fr_1fr]">
        <Card
          title="Receivable ledger"
          subtitle="Every receivable the bridge has opened, with its write-down clock"
        >
          {ledger.isLoading ? (
            <p className="t-footnote py-6 text-center text-ink-faint">Reading the chain…</p>
          ) : rows.length === 0 ? (
            <p className="t-footnote py-6 text-center text-ink-faint">
              No receivables yet. Redeem an asset on the Holder page to open one.
            </p>
          ) : (
            <Table
              head={
                <>
                  <Th>ID</Th>
                  <Th>Holder</Th>
                  <Th numeric>Advanced</Th>
                  <Th numeric>At NAV</Th>
                  <Th numeric>Settles in</Th>
                  <Th numeric>Impairable in</Th>
                  <Th>Status</Th>
                </>
              }
            >
              {rows.map((r) => {
                const impairableAt = r.settleAfter + ledger.impairAfter
                // The contract gate is `block.timestamp <= impairableAt` reverts, so the row is
                // impairable strictly after impairableAt. The +1n keeps the countdown and the
                // gate agreeing to the second rather than reading "due" one second early.
                const impairableIn = impairableAt + 1n - now
                const isCase = r.id === caseId
                return (
                  <tr
                    key={r.id.toString()}
                    onClick={() => {
                      setCaseId(r.id)
                      setRecoverRaw('')
                    }}
                    aria-selected={isCase}
                    className={`cursor-pointer transition-colors duration-(--dur-fast) ease-std ${
                      isCase ? 'bg-brand-soft' : 'hover:bg-surface-2/50'
                    }`}
                  >
                    <Td>
                      <Num size="footnote" tone={isCase ? 'accent' : 'dim'}>{`#${r.id}`}</Num>
                    </Td>
                    <Td>
                      <Hash value={r.holder} chars={6} />
                    </Td>
                    <Td numeric>
                      <Num size="footnote">{formatUsdc(r.advanced)}</Num>
                    </Td>
                    <Td numeric>
                      <Num size="footnote" tone="dim">
                        {formatUsdc(r.expected)}
                      </Num>
                    </Td>
                    <Td numeric>
                      {r.status === OPEN ? (
                        <Num size="footnote" tone={r.settleAfter <= now ? 'warn' : 'dim'}>
                          {formatCountdown(r.settleAfter - now)}
                        </Num>
                      ) : (
                        <span className="t-footnote text-ink-faint">—</span>
                      )}
                    </Td>
                    <Td numeric>
                      {r.status === OPEN ? (
                        <Num size="footnote" tone={impairableIn <= 0n ? 'loss' : 'faint'}>
                          {impairableIn <= 0n ? 'ready' : formatCountdown(impairableIn)}
                        </Num>
                      ) : (
                        <span className="t-footnote text-ink-faint">—</span>
                      )}
                    </Td>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                  </tr>
                )
              })}
            </Table>
          )}
        </Card>

        <Card
          title="Credit workout"
          subtitle="Write a receivable down, then book what the workout returns"
          actions={selectedCase ? <StatusBadge status={selectedCase.status} /> : undefined}
        >
          {!selectedCase ? (
            <p className="t-footnote py-6 text-center text-ink-faint">
              Select a receivable in the ledger.
            </p>
          ) : (
            <div className="space-y-4">
              <dl className="space-y-1.5">
                {(
                  [
                    ['Receivable', `#${selectedCase.id}`],
                    ['Advanced to holder', `${formatUsdc(selectedCase.advanced)} USDC`],
                    ['Par at NAV', `${formatUsdc(selectedCase.expected)} USDC`],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4">
                    <dt className="t-caption text-ink-dim">{k}</dt>
                    <dd>
                      <Num size="footnote">{v}</Num>
                    </dd>
                  </div>
                ))}
              </dl>

              {selectedCase.status === OPEN && (
                <Gate ok={isRiskAdmin} need="the risk admin role on the bridge">
                  <div className="space-y-2">
                    <p className="t-caption text-ink-dim">
                      Marking a receivable impaired writes the advance off against the vault, which
                      moves the share price down. The grace period past the settlement window is
                      deliberate: a permissionless write-down would let anyone impair a merely late
                      receivable and buy shares at the depressed price.
                    </p>
                    {(() => {
                      const impairableAt = selectedCase.settleAfter + ledger.impairAfter
                      const impairableIn = impairableAt + 1n - now
                      const ready = impairableIn <= 0n
                      return (
                        <>
                          <div className="rounded-control flex items-baseline justify-between gap-3 bg-surface-2 px-3 py-2">
                            <span className="t-caption text-ink-dim">Impairable</span>
                            <Num size="footnote" tone={ready ? 'loss' : 'dim'}>
                              {ready ? 'now' : `in ${formatCountdown(impairableIn)}`}
                            </Num>
                          </div>
                          <TxButton
                            tx={impairTx}
                            variant="danger"
                            successLabel="Marked impaired"
                            disabled={!isRiskAdmin || !ready}
                            onClick={() =>
                              impairTx.send({
                                address: d.bridge,
                                abi: bridgeAbi,
                                functionName: 'markImpaired',
                                args: [selectedCase.id],
                              })
                            }
                          >
                            {`Mark #${selectedCase.id} impaired`}
                          </TxButton>
                          {!ready && (
                            <p className="t-caption text-ink-faint">
                              The grace period past the settlement window has not elapsed, so the
                              bridge would reject this. The countdown above is when it opens.
                            </p>
                          )}
                        </>
                      )
                    })()}
                  </div>
                </Gate>
              )}

              {selectedCase.status === IMPAIRED && (
                <Gate ok={isRiskAdmin} need="the risk admin role on the bridge">
                  <div className="space-y-3">
                    <Input
                      label="Recovered amount"
                      value={recoverRaw}
                      onChange={(e) => setRecoverRaw(e.target.value)}
                      suffix="USDC"
                      hint={
                        <button
                          type="button"
                          onClick={() => setRecoverRaw(formatUsdc(selectedCase.advanced, 6))}
                          className="num t-caption text-ink-dim underline hover:text-ink"
                        >
                          {`full advance ${formatUsdc(selectedCase.advanced)}`}
                        </button>
                      }
                      error={
                        recoverAmount > bridgeAllowance.balance
                          ? 'Exceeds your USDC balance'
                          : undefined
                      }
                    />
                    <div className="rounded-control flex items-baseline justify-between gap-3 bg-surface-2 px-3 py-2">
                      <span className="t-caption text-ink-dim">Loss left with the vault</span>
                      <Num size="footnote" tone={impliedLoss > 0n ? 'loss' : 'gain'}>
                        {`${formatUsdc(impliedLoss > 0n ? impliedLoss : 0n)} USDC`}
                      </Num>
                    </div>
                    <p className="t-caption text-ink-dim">
                      The recovered USDC is pulled from this wallet and returned to the vault, so it
                      needs an allowance to the bridge first.
                    </p>
                    {recoverNeedsApproval ? (
                      <TxButton
                        tx={approveBridgeTx}
                        variant="secondary"
                        successLabel="Approved"
                        disabled={!isRiskAdmin || recoverAmount === 0n}
                        onClick={() =>
                          approveBridgeTx.send({
                            address: d.usdc,
                            abi: usdcAbi,
                            functionName: 'approve',
                            args: [d.bridge, maxUint256],
                          })
                        }
                      >
                        Approve USDC to the bridge
                      </TxButton>
                    ) : (
                      <TxButton
                        tx={recoverTx}
                        successLabel="Recovery booked"
                        disabled={
                          !isRiskAdmin ||
                          recoverAmount === 0n ||
                          recoverAmount > bridgeAllowance.balance
                        }
                        onClick={() =>
                          recoverTx.send({
                            address: d.bridge,
                            abi: bridgeAbi,
                            functionName: 'recoverImpaired',
                            args: [selectedCase.id, recoverAmount],
                          })
                        }
                      >
                        {`Book recovery on #${selectedCase.id}`}
                      </TxButton>
                    )}
                  </div>
                </Gate>
              )}

              {selectedCase.status === SETTLED && (
                <p className="t-footnote text-ink-dim">
                  {`Receivable #${selectedCase.id} is settled. Nothing is outstanding on it, so there is nothing to impair or recover.`}
                </p>
              )}
            </div>
          )}
        </Card>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* Demo controls */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <Card
            title="Asset risk parameters"
            subtitle="Move a price or a credit premium and watch the quote reprice"
          >
            <div className="space-y-4">
              <AssetChips
                assets={assets}
                selected={asset?.token}
                onSelect={(a) => setSelectedToken(a.token)}
              />

              <Gate ok={extra.canSetNav} need="the NAV updater role on the registry">
                <div className="space-y-2">
                  <Input
                    label="NAV per token"
                    value={navRaw}
                    onChange={(e) => setNavRaw(e.target.value)}
                    placeholder={asset ? formatWad(asset.navPerToken, 6) : '1.00'}
                    suffix="USD"
                    hint={
                      asset && (
                        <button
                          type="button"
                          onClick={() => setNavRaw(formatWad(asset.navPerToken, 6))}
                          className="num t-caption text-ink-dim underline hover:text-ink"
                        >
                          {`now ${formatWad(asset.navPerToken)}`}
                        </button>
                      )
                    }
                  />
                  <TxButton
                    tx={navTx}
                    successLabel="NAV updated"
                    disabled={!asset || !extra.canSetNav || safeParse(navRaw, 18) === 0n}
                    onClick={() =>
                      asset &&
                      navTx.send({
                        address: d.registry,
                        abi: registryAbi,
                        functionName: 'setNav',
                        args: [asset.token, safeParse(navRaw, 18)],
                      })
                    }
                  >
                    Set NAV
                  </TxButton>
                </div>
              </Gate>

              <Gate ok={isRegistryAdmin} need="the registry admin role">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Input
                      label="Credit premium"
                      value={creditRaw}
                      onChange={(e) => setCreditRaw(e.target.value)}
                      placeholder={asset ? asset.creditBps.toString() : '0'}
                      suffix="bp"
                      hint={
                        asset && (
                          <button
                            type="button"
                            onClick={() => setCreditRaw(asset.creditBps.toString())}
                            className="num t-caption underline"
                            style={{ color: 'var(--color-term-credit)' }}
                          >
                            {`now ${formatBps(asset.creditBps)}`}
                          </button>
                        )
                      }
                    />
                    <TxButton
                      tx={creditTx}
                      variant="secondary"
                      successLabel="Credit updated"
                      disabled={!asset || !isRegistryAdmin || !/^\d+$/.test(creditRaw.trim())}
                      onClick={() =>
                        asset &&
                        creditTx.send({
                          address: d.registry,
                          abi: registryAbi,
                          functionName: 'setCredit',
                          // uint16 on chain: a bps figure, small by construction, never money.
                          args: [asset.token, Number(creditRaw.trim())],
                        })
                      }
                    >
                      Set credit premium
                    </TxButton>
                  </div>

                  <div className="space-y-2">
                    <Input
                      label="Exposure limit"
                      value={exposureRaw}
                      onChange={(e) => setExposureRaw(e.target.value)}
                      placeholder={asset ? asset.maxExposureBps.toString() : '0'}
                      suffix="bp of vault"
                      hint={
                        asset && (
                          <button
                            type="button"
                            onClick={() => setExposureRaw(asset.maxExposureBps.toString())}
                            className="num t-caption text-ink-dim underline hover:text-ink"
                          >
                            {`now ${formatBps(asset.maxExposureBps)}, ${formatUsdc(asset.exposureCapUsdc, 0)} USDC`}
                          </button>
                        )
                      }
                    />
                    <TxButton
                      tx={exposureTx}
                      variant="secondary"
                      successLabel="Limit updated"
                      disabled={!asset || !isRegistryAdmin || !isUint(exposureRaw)}
                      onClick={() =>
                        asset &&
                        exposureTx.send({
                          address: d.registry,
                          abi: registryAbi,
                          functionName: 'setMaxExposure',
                          args: [asset.token, Number(exposureRaw.trim())],
                        })
                      }
                    >
                      Set exposure limit
                    </TxButton>
                  </div>

                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-3">
                      <span className="t-caption font-medium text-ink-faint">Trading</span>
                      {asset &&
                        (asset.enabled ? (
                          <Badge tone="gain">enabled</Badge>
                        ) : (
                          <Badge tone="neutral">disabled</Badge>
                        ))}
                    </div>
                    <TxButton
                      tx={enabledTx}
                      variant={asset?.enabled ? 'danger' : 'secondary'}
                      successLabel="Done"
                      disabled={!asset || !isRegistryAdmin}
                      onClick={() =>
                        asset &&
                        enabledTx.send({
                          address: d.registry,
                          abi: registryAbi,
                          functionName: 'setEnabled',
                          args: [asset.token, !asset.enabled],
                        })
                      }
                    >
                      {asset?.enabled
                        ? `Disable ${asset.symbol}`
                        : `Enable ${asset?.symbol ?? 'asset'}`}
                    </TxButton>
                  </div>
                </div>
              </Gate>
            </div>
          </Card>

          <Card title="Demo funding" subtitle="Mint test assets and top the issuer up">
            <div className="space-y-5">
              <Gate ok={extra.canMintUsdc} need="the minter role on mock USDC">
                <div className="space-y-2">
                  <Input
                    label="Mint USDC to this wallet"
                    value={mintUsdcRaw}
                    onChange={(e) => setMintUsdcRaw(e.target.value)}
                    suffix="USDC"
                    hint={<Num size="caption" tone="dim">{`balance ${formatUsdc(bridgeAllowance.balance)}`}</Num>}
                  />
                  <TxButton
                    tx={mintUsdcTx}
                    variant="secondary"
                    successLabel="Minted"
                    disabled={!address || !extra.canMintUsdc || safeParse(mintUsdcRaw, 6) === 0n}
                    onClick={() =>
                      address &&
                      mintUsdcTx.send({
                        address: d.usdc,
                        abi: usdcAbi,
                        functionName: 'mint',
                        args: [address, safeParse(mintUsdcRaw, 6)],
                      })
                    }
                  >
                    Mint USDC
                  </TxButton>
                </div>
              </Gate>

              <Gate
                ok={Boolean(asset && extra.canMintToken(asset.token))}
                need="the minter role on this RWA token"
              >
                <div className="space-y-2">
                  <Input
                    label={`Mint ${asset?.symbol ?? 'RWA'} to this wallet`}
                    value={mintRwaRaw}
                    onChange={(e) => setMintRwaRaw(e.target.value)}
                    suffix={asset?.symbol}
                    hint={<span className="t-caption text-ink-faint">Uses the asset selected above</span>}
                  />
                  <TxButton
                    tx={mintRwaTx}
                    variant="secondary"
                    successLabel="Minted"
                    disabled={
                      !address ||
                      !asset ||
                      !extra.canMintToken(asset.token) ||
                      safeParse(mintRwaRaw, 18) === 0n
                    }
                    onClick={() =>
                      address &&
                      asset &&
                      mintRwaTx.send({
                        address: asset.token,
                        abi: rwaAbi,
                        functionName: 'mint',
                        args: [address, safeParse(mintRwaRaw, 18)],
                      })
                    }
                  >
                    {`Mint ${asset?.symbol ?? 'RWA'}`}
                  </TxButton>
                </div>
              </Gate>

              {/* fund() is permissionless on MockIssuer — anyone may top it up — so no Gate here.
                  It does pull USDC via transferFrom, so it needs an allowance to the issuer. */}
              <div className="space-y-2">
                <Input
                  label="Fund the issuer"
                  value={fundRaw}
                  onChange={(e) => setFundRaw(e.target.value)}
                  suffix="USDC"
                  error={fundAmount > issuerAllowance.balance ? 'Exceeds your USDC balance' : undefined}
                  hint={
                    <span className="t-caption text-ink-faint">
                      Anyone may fund the issuer; no role needed
                    </span>
                  }
                />
                {fundNeedsApproval ? (
                  <TxButton
                    tx={approveIssuerTx}
                    variant="secondary"
                    successLabel="Approved"
                    disabled={fundAmount === 0n}
                    onClick={() =>
                      approveIssuerTx.send({
                        address: d.usdc,
                        abi: usdcAbi,
                        functionName: 'approve',
                        args: [d.issuer, maxUint256],
                      })
                    }
                  >
                    Approve USDC to the issuer
                  </TxButton>
                ) : (
                  <TxButton
                    tx={fundTx}
                    variant="secondary"
                    successLabel="Funded"
                    disabled={fundAmount === 0n || fundAmount > issuerAllowance.balance}
                    onClick={() =>
                      fundTx.send({
                        address: d.issuer,
                        // `fund` IS present in the generated mockIssuerAbi, so the brief's inline
                        // ABI literal is unnecessary. Verified against packages/shared/src/generated.ts.
                        abi: issuerAbi,
                        functionName: 'fund',
                        args: [fundAmount],
                      })
                    }
                  >
                    Fund issuer
                  </TxButton>
                )}
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card
            title="Demo clock"
            subtitle="Seconds per day scales the pricing horizon, so a 120-second window reads as two days"
          >
            <Gate ok={isRegistryAdmin} need="the registry admin role">
              <div className="space-y-3">
                <Input
                  label="Seconds per day"
                  value={clockRaw}
                  onChange={(e) => setClockRaw(e.target.value)}
                  placeholder="60"
                  hint={
                    <button
                      type="button"
                      onClick={() => setClockRaw(p.secondsPerDay.toString())}
                      className="num t-caption text-ink-dim underline hover:text-ink"
                    >
                      {`now ${p.secondsPerDay.toString()}`}
                    </button>
                  }
                />
                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ['60', 'Demo pace'],
                      ['3600', 'Hourly'],
                      ['86400', 'Real time'],
                    ] as const
                  ).map(([v, note]) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setClockRaw(v)}
                      className={`rounded-control border px-3 py-2 text-left transition-colors duration-(--dur-fast) ease-std ${
                        clockRaw.trim() === v
                          ? 'border-brand bg-brand-soft'
                          : 'border-line bg-surface hover:bg-surface-2'
                      }`}
                    >
                      <span className="t-footnote block font-medium">{note}</span>
                      <Num size="caption" tone="dim">{v}</Num>
                    </button>
                  ))}
                </div>
                <TxButton
                  tx={clockTx}
                  successLabel="Clock updated"
                  disabled={!isRegistryAdmin || !isUint(clockRaw)}
                  onClick={() =>
                    clockTx.send({
                      address: d.registry,
                      abi: registryAbi,
                      functionName: 'setSecondsPerDay',
                      // uint32 on chain, and a clock scale rather than money — a small unsigned
                      // integer by construction, so Number() is correct here.
                      args: [Number(clockRaw.trim())],
                    })
                  }
                >
                  Set demo clock
                </TxButton>
              </div>
            </Gate>
          </Card>

          <Card
            title="Settle now"
            subtitle="Bypass the settlement window. Emits DemoOverride on chain."
          >
            {(() => {
              const settleTarget = selectedCase
              const open = settleTarget?.status === OPEN
              const due = Boolean(settleTarget && settleTarget.settleAfter <= now)
              // settle() is permissionless once the window has elapsed; only the early path needs
              // DEMO_ADMIN_ROLE. Gate on what the chain actually enforces.
              const allowed = due || isDemoAdmin
              return (
                <div className="space-y-3">
                  <div className="rounded-control flex items-baseline justify-between gap-3 bg-surface-2 px-3 py-2">
                    <span className="t-caption text-ink-dim">Selected receivable</span>
                    <Num size="footnote" tone="accent">
                      {settleTarget ? `#${settleTarget.id}` : 'none'}
                    </Num>
                  </div>
                  <TxButton
                    tx={settleTx}
                    variant="secondary"
                    successLabel="Settled"
                    disabled={!settleTarget || !open || !allowed}
                    onClick={() =>
                      settleTarget &&
                      settleTx.send({
                        address: d.bridge,
                        abi: bridgeAbi,
                        functionName: 'settle',
                        args: [settleTarget.id],
                      })
                    }
                  >
                    {settleTarget ? `Settle #${settleTarget.id}` : 'Settle receivable'}
                  </TxButton>
                  <p className="t-caption text-ink-faint">
                    {!settleTarget
                      ? 'Select a receivable in the ledger above.'
                      : !open
                        ? `Receivable #${settleTarget.id} is not open, so it cannot be settled.`
                        : due
                          ? 'The window has elapsed, so anyone may settle this. No role is needed.'
                          : isDemoAdmin
                            ? 'The window has not elapsed. Settling now uses the demo-admin override and emits DemoOverride.'
                            : 'The window has not elapsed and this wallet is not the demo admin, so the bridge would reject an early settlement.'}
                  </p>
                </div>
              )
            })()}
          </Card>

          <Card title="Circuit breakers" subtitle="Stop new redemptions or freeze the vault">
            <div className="space-y-4">
              <Gate ok={extra.canPauseBridge} need="the pauser role on the bridge">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="t-caption font-medium text-ink-faint">Redemption bridge</span>
                    {ledger.bridgePaused ? (
                      <Badge tone="loss">paused</Badge>
                    ) : (
                      <Badge tone="gain">live</Badge>
                    )}
                  </div>
                  <TxButton
                    tx={bridgePauseTx}
                    variant={ledger.bridgePaused ? 'secondary' : 'danger'}
                    successLabel="Done"
                    disabled={!extra.canPauseBridge}
                    onClick={() =>
                      bridgePauseTx.send({
                        address: d.bridge,
                        abi: bridgeAbi,
                        functionName: ledger.bridgePaused ? 'unpause' : 'pause',
                      })
                    }
                  >
                    {ledger.bridgePaused ? 'Unpause bridge' : 'Pause bridge'}
                  </TxButton>
                </div>
              </Gate>

              <Gate ok={extra.canPauseVault} need="the pauser role on the vault">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-3">
                    <span className="t-caption font-medium text-ink-faint">Liquidity vault</span>
                    {ledger.vaultPaused ? (
                      <Badge tone="loss">paused</Badge>
                    ) : (
                      <Badge tone="gain">live</Badge>
                    )}
                  </div>
                  <TxButton
                    tx={vaultPauseTx}
                    variant={ledger.vaultPaused ? 'secondary' : 'danger'}
                    successLabel="Done"
                    disabled={!extra.canPauseVault}
                    onClick={() =>
                      vaultPauseTx.send({
                        address: d.vault,
                        abi: vaultAbi,
                        functionName: ledger.vaultPaused ? 'unpause' : 'pause',
                      })
                    }
                  >
                    {ledger.vaultPaused ? 'Unpause vault' : 'Pause vault'}
                  </TxButton>
                </div>
              </Gate>
            </div>
          </Card>

          <Card title="Vault state" subtitle="Live, the same figures the Overview reads">
            <dl className="space-y-1.5">
              {(
                [
                  ['Total assets', formatUsdc(p.totalAssets)],
                  ['Idle', formatUsdc(p.idle)],
                  ['Outstanding', formatUsdc(p.outstanding)],
                  ['Capacity', formatUsdc(p.capacityUsdc)],
                  ['Share price', formatUsdc(p.sharePrice, 6)],
                  ['Treasury USDC balance', formatUsdc(p.treasuryUsdc)],
                ] as const
              ).map(([k, v]) => (
                <div key={k} className="flex items-baseline justify-between gap-4">
                  <dt className="t-caption text-ink-dim">{k}</dt>
                  <dd>
                    <Num size="footnote">{v}</Num>
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </div>
  )
}

export default function AdminPage() {
  return (
    <ChainGuard>
      <Inner />
    </ChainGuard>
  )
}
