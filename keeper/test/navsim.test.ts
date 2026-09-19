import { describe, expect, it } from 'vitest'
import { accrue, walk } from '../src/nav-sim.js'

const WAD = 10n ** 18n
const NAV = 1_043_200_000_000_000_000n // 1.0432

describe('accrue', () => {
  it('leaves NAV untouched when no time has passed', () => {
    expect(accrue(NAV, 0n, 60n)).toBe(NAV)
  })

  it('raises NAV over one simulated day by 4%/365', () => {
    const next = accrue(NAV, 60n, 60n) // one 60-second "day"
    expect(next > NAV).toBe(true)
    // 4%/yr over 1 day = 0.010958...% -> ~1.14e14 wei on a 1.0432 NAV
    expect(next - NAV).toBe((NAV * ((400n * WAD) / (10_000n * 365n))) / WAD)
  })

  it('accrues 365 simulated days to about +4%', () => {
    const next = accrue(NAV, 60n * 365n, 60n)
    const gainBps = ((next - NAV) * 10_000n) / NAV
    expect(gainBps).toBe(400n)
  })

  it('is a no-op when secondsPerDay is zero rather than dividing by zero', () => {
    expect(accrue(NAV, 600n, 0n)).toBe(NAV)
  })

  it('accrues 1440x slower on the production clock than the demo clock', () => {
    const demo = accrue(NAV, 60n, 60n) - NAV
    const prod = accrue(NAV, 60n, 86_400n) - NAV
    expect(demo / prod).toBe(1440n)
  })
})

describe('walk', () => {
  const TSLA = 248_500_000_000_000_000_000n // 248.5
  const VOL = 180n

  it('moves up on a high draw and down on a low draw', () => {
    expect(walk(TSLA, VOL, 60n, 60n, () => 1) > TSLA).toBe(true)
    expect(walk(TSLA, VOL, 60n, 60n, () => 0) < TSLA).toBe(true)
  })

  it('does not move on a median draw', () => {
    expect(walk(TSLA, VOL, 60n, 60n, () => 0.5)).toBe(TSLA)
  })

  it('moves by at most one sigma over one simulated day', () => {
    const up = walk(TSLA, VOL, 60n, 60n, () => 1)
    const movedBps = ((up - TSLA) * 10_000n) / TSLA
    expect(movedBps <= VOL).toBe(true)
  })

  it('is a no-op for a zero-vol asset', () => {
    expect(walk(TSLA, 0n, 60n, 60n, () => 1)).toBe(TSLA)
  })

  it('never falls below half the previous NAV', () => {
    const crashed = walk(TSLA, 100_000n, 60n * 100n, 60n, () => 0)
    expect(crashed).toBe(TSLA / 2n)
  })

  it('is a no-op when secondsPerDay is zero', () => {
    expect(walk(TSLA, VOL, 600n, 0n, () => 1)).toBe(TSLA)
  })
})
