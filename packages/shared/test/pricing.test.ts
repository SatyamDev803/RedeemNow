import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BPS,
  USDC_SCALE,
  WAD,
  creditTermBps,
  horizonDaysWad,
  navValueWad,
  payoutUsdc,
  projectedUtilisationBps,
  spreadBps,
  sqrt,
  timeRiskBps,
  utilisationTermBps,
  wadToUsdc,
} from '../src/pricing.js'

type Fixture = {
  uBps: number
  kink: number
  slope1: number
  slope2: number
  utilTerm: number
  vol: number
  horizonWad: string
  timeRisk: number
  navWad: string
  spread: number
  payout: string
  amount: string
  navPerToken: string
  settlementWindow: number
  secondsPerDay: number
  idle: string
  outstanding: string
  proposedUsdc: string
  credit: number
}

const FIXTURE_BASE_BPS = 3n // the Foundry generator's constant base spread

const fixtures: Fixture[] = JSON.parse(
  readFileSync(
    resolve(import.meta.dirname, '../../../contracts/fixtures/pricing.json'),
    'utf8',
  ),
)

describe('sqrt (mirrors OpenZeppelin Math.sqrt, floor rounding)', () => {
  it('matches floor(sqrt(n)) on exact squares and non-squares', () => {
    expect(sqrt(0n)).toBe(0n)
    expect(sqrt(1n)).toBe(1n)
    expect(sqrt(2n)).toBe(1n)
    expect(sqrt(3n)).toBe(1n)
    expect(sqrt(4n)).toBe(2n)
    expect(sqrt(10n)).toBe(3n)
    expect(sqrt(15n)).toBe(3n)
    expect(sqrt(16n)).toBe(4n)
    expect(sqrt(10n ** 36n)).toBe(10n ** 18n)
    expect(sqrt(WAD * WAD - 1n)).toBe(WAD - 1n)
  })

  it('rejects negatives', () => {
    expect(() => sqrt(-1n)).toThrow()
  })
})

describe('fixture parity with Pricing.sol', () => {
  it('loaded all 1,728 records', () => {
    expect(fixtures).toHaveLength(1_728)
  })

  it('reproduces navWad, horizonWad and uBps from their raw inputs for every record', () => {
    // Closes the coverage gap: the fixture used to hand these three over pre-computed, so
    // navValueWad, horizonDaysWad and projectedUtilisationBps were never exercised against
    // Solidity-derived data. Deriving them here from the emitted inputs guards all three.
    const mismatches: string[] = []

    for (const [i, f] of fixtures.entries()) {
      const nav = navValueWad(BigInt(f.amount), BigInt(f.navPerToken))
      const horizon = horizonDaysWad(BigInt(f.settlementWindow), BigInt(f.secondsPerDay))
      const u = projectedUtilisationBps(BigInt(f.idle), BigInt(f.outstanding), BigInt(f.proposedUsdc))

      if (nav !== BigInt(f.navWad)) mismatches.push(`#${i} navWad ${nav} != ${f.navWad}`)
      if (horizon !== BigInt(f.horizonWad)) {
        mismatches.push(`#${i} horizonWad ${horizon} != ${f.horizonWad}`)
      }
      if (u !== BigInt(f.uBps)) mismatches.push(`#${i} uBps ${u} != ${f.uBps}`)
    }

    expect(mismatches.slice(0, 20)).toEqual([])
    expect(mismatches).toHaveLength(0)
  })

  it('reproduces utilTerm, timeRisk, spread and payout for every record', () => {
    const mismatches: string[] = []

    for (const [i, f] of fixtures.entries()) {
      const curve = {
        kinkBps: BigInt(f.kink),
        slope1Bps: BigInt(f.slope1),
        slope2Bps: BigInt(f.slope2),
      }
      const horizon = BigInt(f.horizonWad)
      const credit = BigInt(f.credit)

      const util = utilisationTermBps(BigInt(f.uBps), curve)
      const risk = timeRiskBps(BigInt(f.vol), horizon)
      const spread = spreadBps(
        { baseSpreadBps: FIXTURE_BASE_BPS, dailyVolBps: BigInt(f.vol) },
        BigInt(f.uBps),
        horizon,
        curve,
        credit,
      )
      const payout = payoutUsdc(BigInt(f.navWad), spread)

      if (util !== BigInt(f.utilTerm)) mismatches.push(`#${i} utilTerm ${util} != ${f.utilTerm}`)
      if (risk !== BigInt(f.timeRisk)) mismatches.push(`#${i} timeRisk ${risk} != ${f.timeRisk}`)
      if (creditTermBps(credit) !== credit) mismatches.push(`#${i} creditTermBps not identity`)
      if (spread !== BigInt(f.spread)) mismatches.push(`#${i} spread ${spread} != ${f.spread}`)
      if (payout !== BigInt(f.payout)) mismatches.push(`#${i} payout ${payout} != ${f.payout}`)
    }

    expect(mismatches.slice(0, 20)).toEqual([])
    expect(mismatches).toHaveLength(0)
  })
})

describe('pure helpers', () => {
  it('clamps utilisation above 100% to the curve endpoint', () => {
    const c = { kinkBps: 8_000n, slope1Bps: 20n, slope2Bps: 200n }
    expect(utilisationTermBps(10_000n, c)).toBe(220n)
    expect(utilisationTermBps(12_000n, c)).toBe(220n)
    expect(utilisationTermBps(99_999n, c)).toBe(220n)
  })

  it('is monotonic non-decreasing in utilisation across the kink', () => {
    const c = { kinkBps: 8_000n, slope1Bps: 20n, slope2Bps: 200n }
    let prev = -1n
    for (let u = 0n; u <= 10_000n; u += 137n) {
      const v = utilisationTermBps(u, c)
      expect(v >= prev).toBe(true)
      prev = v
    }
  })

  it('treats an empty vault as fully utilised', () => {
    expect(projectedUtilisationBps(0n, 0n, 0n)).toBe(BPS)
    expect(projectedUtilisationBps(0n, 0n, 1_000n)).toBe(BPS)
  })

  it('projects utilisation as (outstanding + proposed) / total', () => {
    // 100k idle, 0 outstanding, propose 74_550 USDC -> 7455 bps
    expect(projectedUtilisationBps(100_000_000_000n, 0n, 74_550_000_000n)).toBe(7_455n)
  })

  it('pays zero when the spread swallows the whole notional', () => {
    expect(payoutUsdc(1_000n * WAD, BPS)).toBe(0n)
    expect(payoutUsdc(1_000n * WAD, BPS + 1n)).toBe(0n)
  })

  it('scales wad to usdc by flooring', () => {
    expect(wadToUsdc(WAD)).toBe(1_000_000n)
    expect(wadToUsdc(USDC_SCALE - 1n)).toBe(0n)
  })

  it('computes nav value at 1e18 scale', () => {
    // 1000 tokens at 1.0432 -> 1043.2
    expect(navValueWad(1_000n * WAD, 1_043_200_000_000_000_000n)).toBe(1_043_200_000_000_000_000_000n)
  })

  it('derives the horizon from the settlement window and the demo clock', () => {
    // 120 s window, 60 s "day" -> 2 days
    expect(horizonDaysWad(120n, 60n)).toBe(2n * WAD)
    // 120 s window, real day -> 0.00138... days
    expect(horizonDaysWad(120n, 86_400n)).toBe(1_388_888_888_888_888n)
  })

  it('reproduces the demo rTBILL leg: 1000 rTBILL at 1.0432, 6 bps spread (2 credit)', () => {
    const c = { kinkBps: 8_000n, slope1Bps: 20n, slope2Bps: 200n }
    const nav = navValueWad(1_000n * WAD, 1_043_200_000_000_000_000n)
    const u = projectedUtilisationBps(100_000_000_000n, 0n, wadToUsdc(nav))
    const spread = spreadBps({ baseSpreadBps: 3n, dailyVolBps: 1n }, u, horizonDaysWad(120n, 60n), c, 2n)
    expect(spread).toBe(6n)
    expect(payoutUsdc(nav, spread)).toBe(1_042_574_080n)
  })
})
