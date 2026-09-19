import { rwaRegistryAbi } from '@redeemnow/shared/generated'
import { assertChainReachable, type Ctx } from './clients.js'

const WAD = 10n ** 18n
const BPS = 10_000n
/** 4% per year, expressed in bps: applied pro-rata per simulated day. */
const TBILL_APY_BPS = 400n

/**
 * Deterministic T-bill accrual. The NAV must rise by 4%/yr of *simulated* time, so the elapsed
 * simulated days come from the chain's secondsPerDay — at the demo's 60 the clock runs 1440x fast
 * and the accrual is actually visible inside a five-minute demo.
 */
export function accrue(nav: bigint, elapsedSeconds: bigint, secondsPerDay: bigint): bigint {
  if (secondsPerDay === 0n) return nav
  // nav * (1 + apy * elapsedDays / 365), all integer, scaled by 1e18 to keep precision
  const elapsedDaysWad = (elapsedSeconds * WAD) / secondsPerDay
  const growthWad = (TBILL_APY_BPS * elapsedDaysWad) / (BPS * 365n)
  return nav + (nav * growthWad) / WAD
}

/**
 * One random-walk step of +/- up to `dailyVolBps` scaled to the elapsed simulated time.
 * `rand` is injected so this is testable; it must return a value in [0, 1).
 */
export function walk(
  nav: bigint,
  dailyVolBps: bigint,
  elapsedSeconds: bigint,
  secondsPerDay: bigint,
  rand: () => number,
): bigint {
  if (secondsPerDay === 0n || dailyVolBps === 0n) return nav
  const elapsedDaysWad = (elapsedSeconds * WAD) / secondsPerDay
  // One sigma over the elapsed window, in bps at wad scale. Scaled linearly in time rather than
  // by sqrt(t): this is a price simulator for the demo, not the pricing path, and a linear scale
  // makes the rTSLA line visibly move at a 60-second demo "day".
  const sigmaBpsWad = dailyVolBps * elapsedDaysWad
  // uniform in [-1, 1)
  const draw = BigInt(Math.round((rand() * 2 - 1) * 1e6))
  const moveBpsWad = (sigmaBpsWad * draw) / 1_000_000n
  const next = nav + (nav * moveBpsWad) / (BPS * WAD)
  // never let a simulated price go to zero or negative
  const floor = nav / 2n
  return next < floor ? floor : next
}

export type NavSimOptions = {
  intervalMs?: number
  once?: boolean
  rand?: () => number
}

export async function runNavSim(ctx: Ctx, opts: NavSimOptions = {}): Promise<void> {
  const intervalMs = opts.intervalMs ?? 10_000
  const rand = opts.rand ?? Math.random

  await assertChainReachable(ctx)

  const registry = { address: ctx.deployment.registry, abi: rwaRegistryAbi } as const
  const secondsPerDay = BigInt(await ctx.public.readContract({ ...registry, functionName: 'secondsPerDay' }))

  console.log(
    `[nav-sim] chain ${ctx.chainId} registry ${ctx.deployment.registry} ` +
      `secondsPerDay ${secondsPerDay} interval ${intervalMs}ms`,
  )

  let last = (await ctx.public.getBlock()).timestamp

  const tick = async () => {
    const now = (await ctx.public.getBlock()).timestamp
    const elapsed = now > last ? now - last : 0n
    last = now
    if (elapsed === 0n) return

    for (const [key, mode] of [
      ['rTBILL', 'accrue'],
      ['rTSLA', 'walk'],
    ] as const) {
      const token = ctx.deployment[key]
      const asset = await ctx.public.readContract({ ...registry, functionName: 'getAsset', args: [token] })
      const nav = asset.navPerToken
      const next =
        mode === 'accrue'
          ? accrue(nav, elapsed, secondsPerDay)
          : walk(nav, BigInt(asset.dailyVolBps), elapsed, secondsPerDay, rand)

      if (next === nav) continue

      const { request } = await ctx.public.simulateContract({
        ...registry,
        functionName: 'setNav',
        args: [token, next],
        account: ctx.account,
      })
      const hash = await ctx.wallet.writeContract(request)
      await ctx.public.waitForTransactionReceipt({ hash })
      console.log(`[nav-sim] ${key} ${nav} -> ${next}  tx ${hash}`)
    }
  }

  process.once('SIGINT', () => {
    console.log('[nav-sim] stopping')
    process.exit(0)
  })

  for (;;) {
    try {
      await tick()
    } catch (err) {
      console.error(`[nav-sim] tick failed: ${err instanceof Error ? err.message : String(err)}`)
    }
    if (opts.once) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
}
