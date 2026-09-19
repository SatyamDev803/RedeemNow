import { BaseError, ContractFunctionRevertedError } from 'viem'
import { redemptionBridgeAbi } from '@redeemnow/shared/generated'
import { assertChainReachable, type Ctx } from './clients.js'
import {
  DEFAULT_MAX_ATTEMPTS,
  backoffMs,
  selectDue,
  type Attempt,
  type OpenReceivable,
} from './due.js'

/** Decode a custom Solidity error into something a human can read at 3am. */
function describeRevert(err: unknown): string {
  if (err instanceof BaseError) {
    const revert = err.walk((e) => e instanceof ContractFunctionRevertedError)
    if (revert instanceof ContractFunctionRevertedError) {
      const name = revert.data?.errorName ?? revert.reason ?? 'unknown revert'
      const args = revert.data?.args
      return args && args.length > 0 ? `${name}(${args.map(String).join(', ')})` : name
    }
    return err.shortMessage
  }
  return err instanceof Error ? err.message : String(err)
}

async function readBook(ctx: Ctx): Promise<OpenReceivable[]> {
  const bridge = { address: ctx.deployment.bridge, abi: redemptionBridgeAbi } as const

  const ids = await ctx.public.readContract({ ...bridge, functionName: 'openReceivableIds' })
  if (ids.length === 0) return []

  // Deliberately NOT multicall. Multicall3 is not predeployed on a bare Anvil and viem's `anvil`
  // chain definition does not declare one, so a multicall read fails with
  // `aggregate3 returned no data` until someone plants the bytecode by hand — a setup step that
  // does not survive restarting the chain, and exactly the kind of thing that breaks a live demo.
  // These reads are independent, so Promise.all issues them concurrently: same wall-clock as a
  // multicall for a book this size, and it works on any chain with no predeploy.
  const receivables = await Promise.all(
    ids.map((id) => ctx.public.readContract({ ...bridge, functionName: 'getReceivable', args: [id] })),
  )

  return receivables.map((r) => ({
    id: r.id,
    settleAfter: r.settleAfter,
    status: Number(r.status),
  }))
}

async function settleOne(ctx: Ctx, id: bigint): Promise<`0x${string}`> {
  const { request } = await ctx.public.simulateContract({
    address: ctx.deployment.bridge,
    abi: redemptionBridgeAbi,
    functionName: 'settle',
    args: [id],
    account: ctx.account,
  })
  const hash = await ctx.wallet.writeContract(request)
  await ctx.public.waitForTransactionReceipt({ hash })
  return hash
}

export type SettleOptions = {
  intervalMs?: number
  once?: boolean
  maxAttempts?: number
}

export async function runSettle(ctx: Ctx, opts: SettleOptions = {}): Promise<void> {
  const intervalMs = opts.intervalMs ?? 2_000
  const maxAttempts = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS

  await assertChainReachable(ctx)
  console.log(
    `[settle] chain ${ctx.chainId} bridge ${ctx.deployment.bridge} keeper ${ctx.account.address} ` +
      `interval ${intervalMs}ms maxAttempts ${maxAttempts}`,
  )

  const attempts = new Map<bigint, Attempt>()
  let dirty = true

  // Spec §5: subscribe to the book's lifecycle events. Treated as a hint to re-read promptly;
  // every tick re-reads anyway, so a missed log delays nothing past the next interval.
  const unwatchOpened = ctx.public.watchContractEvent({
    address: ctx.deployment.bridge,
    abi: redemptionBridgeAbi,
    eventName: 'ReceivableOpened',
    poll: true,
    pollingInterval: intervalMs,
    onLogs: (logs) => {
      for (const l of logs) console.log(`[settle] opened #${l.args.id} settleAfter ${l.args.settleAfter}`)
      dirty = true
    },
  })
  const unwatchSettled = ctx.public.watchContractEvent({
    address: ctx.deployment.bridge,
    abi: redemptionBridgeAbi,
    eventName: 'ReceivableSettled',
    poll: true,
    pollingInterval: intervalMs,
    onLogs: (logs) => {
      for (const l of logs) console.log(`[settle] settled #${l.args.id} pnl ${l.args.pnl}`)
      dirty = true
    },
  })

  const stop = () => {
    unwatchOpened()
    unwatchSettled()
  }
  process.once('SIGINT', () => {
    console.log('[settle] stopping')
    stop()
    process.exit(0)
  })

  try {
    for (;;) {
      const book = await readBook(ctx)
      const block = await ctx.public.getBlock()
      const nowMs = Date.now()
      const due = selectDue(book, block.timestamp, attempts, nowMs, maxAttempts)

      if (dirty) {
        console.log(`[settle] book ${book.length} open, ${due.length} due at ts ${block.timestamp}`)
        dirty = false
      }

      for (const id of due) {
        try {
          const hash = await settleOne(ctx, id)
          console.log(`[settle] #${id} settled  tx ${hash}`)
          attempts.delete(id)
          dirty = true
        } catch (err) {
          const prior = attempts.get(id)?.attempts ?? 0
          const next = prior + 1
          const wait = backoffMs(prior)
          attempts.set(id, { attempts: next, nextEligibleAt: Date.now() + wait })
          const giveUp = next >= maxAttempts ? ' (giving up)' : ` retry in ${wait}ms`
          console.error(`[settle] #${id} attempt ${next}/${maxAttempts} failed: ${describeRevert(err)}${giveUp}`)
        }
      }

      if (opts.once) return
      await new Promise((r) => setTimeout(r, intervalMs))
    }
  } finally {
    stop()
  }
}
