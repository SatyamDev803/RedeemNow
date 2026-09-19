/**
 * Exact BigInt mirror of contracts/src/lib/Pricing.sol.
 *
 * Every function here must agree with the Solidity to the wei. The parity test walks all 1,728
 * records of contracts/fixtures/pricing.json, which the Foundry script PricingFixtures.s.sol
 * generated from the deployed library. If you change anything in this file, that test is the gate.
 *
 * Solidity integer division truncates toward zero; BigInt `/` does the same for non-negative
 * operands, and every value in these paths is non-negative. Do not introduce Number anywhere.
 */

export const BPS = 10_000n
export const WAD = 10n ** 18n
/** 1e18 (wad) -> 1e6 (USDC) */
export const USDC_SCALE = 10n ** 12n

export type Curve = {
  kinkBps: bigint
  slope1Bps: bigint
  slope2Bps: bigint
}

/**
 * Floor integer square root, matching OpenZeppelin Math.sqrt's default Rounding.Floor.
 * Newton's method; converges from above, so the loop exits at floor(sqrt(n)).
 */
export function sqrt(n: bigint): bigint {
  if (n < 0n) throw new Error(`sqrt of negative: ${n}`)
  if (n < 2n) return n
  let x0 = n
  let x1 = (n >> 1n) + 1n
  while (x1 < x0) {
    x0 = x1
    x1 = (x1 + n / x1) >> 1n
  }
  // Newton's method above converges to floor(sqrt(n)) or one above it (e.g. n=2 stops at x0=2
  // because the loop body never runs); correct back down so this is always the true floor.
  while (x0 * x0 > n) x0 -= 1n
  return x0
}

/** Kinked utilisation curve. Values above 100% are clamped, as in Solidity. */
export function utilisationTermBps(uBps: bigint, c: Curve): bigint {
  const u = uBps > BPS ? BPS : uBps
  if (u <= c.kinkBps) {
    return (c.slope1Bps * u) / c.kinkBps
  }
  return c.slope1Bps + (c.slope2Bps * (u - c.kinkBps)) / (BPS - c.kinkBps)
}

/**
 * One standard deviation of NAV movement over the settlement horizon.
 * sqrt(h * 1e18) where h is already 1e18-scaled yields sqrt(h) at 1e18 scale.
 */
export function timeRiskBps(dailyVolBps: bigint, horizonDaysWad: bigint): bigint {
  const sqrtDaysWad = sqrt(horizonDaysWad * WAD)
  return (dailyVolBps * sqrtDaysWad) / WAD
}

/** @returns USD value at 1e18 scale */
export function navValueWad(amount: bigint, navPerToken: bigint): bigint {
  return (amount * navPerToken) / WAD
}

export function wadToUsdc(wad: bigint): bigint {
  return wad / USDC_SCALE
}

/**
 * Utilisation the vault would have if `proposedUsdc` were advanced in full.
 * Returns 10_000 for an empty vault, and may exceed 10_000 — callers must reject that.
 */
export function projectedUtilisationBps(
  idle: bigint,
  outstanding: bigint,
  proposedUsdc: bigint,
): bigint {
  const total = idle + outstanding
  if (total === 0n) return BPS
  return ((outstanding + proposedUsdc) * BPS) / total
}

/** @returns payout in USDC (6 decimals), floored */
export function payoutUsdc(navValueWad: bigint, spreadBps: bigint): bigint {
  if (spreadBps >= BPS) return 0n
  return wadToUsdc((navValueWad * (BPS - spreadBps)) / BPS)
}

/**
 * Expected loss on a redemption already in flight, in bps. Mirrors Pricing.creditTermBps —
 * deliberately not horizon-scaled; see that function's comment for why.
 */
export function creditTermBps(creditBps: bigint): bigint {
  return creditBps
}

/**
 * Total spread, composed exactly as RedemptionBridge.quote() composes it:
 * base + utilisationTerm(u) + dailyVol * sqrt(horizonDays) + creditTermBps(credit)
 */
export function spreadBps(
  asset: { baseSpreadBps: bigint; dailyVolBps: bigint },
  uBps: bigint,
  horizonDaysWad: bigint,
  c: Curve,
  creditBps: bigint,
): bigint {
  return (
    asset.baseSpreadBps +
    utilisationTermBps(uBps, c) +
    timeRiskBps(asset.dailyVolBps, horizonDaysWad) +
    creditTermBps(creditBps)
  )
}

/** Mirrors RWARegistry.horizonDays: settlementWindow * 1e18 / secondsPerDay. */
export function horizonDaysWad(settlementWindow: bigint, secondsPerDay: bigint): bigint {
  if (secondsPerDay === 0n) throw new Error('secondsPerDay must be non-zero')
  return (settlementWindow * WAD) / secondsPerDay
}
