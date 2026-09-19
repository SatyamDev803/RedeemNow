import { describe, expect, it } from 'vitest'
import {
  formatBps, formatBpsAsPercent, formatCountdown, formatFixed, formatPct,
  formatSignedUsdc, formatToken, formatUnits, formatUsdc, formatWad, parseUnits,
} from '../src/lib/format'

describe('formatFixed', () => {
  it('renders a whole-number amount with trailing zero decimals', () => {
    expect(formatFixed(1_000_000n, 6, 2)).toBe('1.00')
  })

  it('truncates rather than rounds', () => {
    // 1234.567890 truncated to 2dp must be .56, not .57
    expect(formatFixed(1_234_567_890n, 6, 2)).toBe('1,234.56')
  })

  it('groups thousands in the whole part', () => {
    expect(formatFixed(12_345_678_900_000n, 6, 2)).toBe('12,345,678.90')
  })

  it('handles zero', () => {
    expect(formatFixed(0n, 6, 2)).toBe('0.00')
  })

  it('handles a value smaller than one unit', () => {
    expect(formatFixed(5n, 6, 6)).toBe('0.000005')
  })

  it('handles negative values, sign before the grouped whole part', () => {
    expect(formatFixed(-1_500_000n, 6, 2)).toBe('-1.50')
  })

  it('drops the decimal point entirely when displayDecimals is 0', () => {
    expect(formatFixed(1_234_567_890n, 6, 0)).toBe('1,234')
  })
})

describe('formatUsdc', () => {
  it('defaults to 2 display decimals over 6 stored decimals', () => {
    expect(formatUsdc(95_000_000_000n)).toBe('95,000.00')
  })
})

describe('formatToken', () => {
  it('defaults to 4 display decimals over 18 stored decimals (WAD)', () => {
    expect(formatToken(1_500_000_000_000_000_000n)).toBe('1.5000')
  })

  it('truncates 18-decimal precision down to the display width', () => {
    expect(formatToken(1_234_567_890_123_456_789n, 2)).toBe('1.23')
  })
})

describe('formatBps', () => {
  it('appends the bp suffix to the raw integer', () => {
    expect(formatBps(125n)).toBe('125 bp')
    expect(formatBps(0n)).toBe('0 bp')
  })
})

describe('formatBpsAsPercent', () => {
  it('converts basis points to a percentage string', () => {
    expect(formatBpsAsPercent(1250n)).toBe('12.50%')
    expect(formatBpsAsPercent(5n)).toBe('0.05%')
    expect(formatBpsAsPercent(10_000n)).toBe('100.00%')
  })
})

// ---- controller-added coverage for the six functions the routes need ----

describe('formatWad', () => {
  it('renders NAV at 18 decimals', () => {
    expect(formatWad(1_043_200_000_000_000_000n)).toBe('1.0432')
    expect(formatWad(248_500_000_000_000_000_000n, 2)).toBe('248.50')
    expect(formatWad(10n ** 18n * 1_000_000n, 0)).toBe('1,000,000')
  })
})

describe('formatPct', () => {
  it('converts bps to a percentage', () => {
    expect(formatPct(287n)).toBe('2.87%')
    expect(formatPct(10_000n)).toBe('100.00%')
    expect(formatPct(6n)).toBe('0.06%')
    expect(formatPct(7_455n)).toBe('74.55%')
  })
  it('accepts a plain number and honours a dp override', () => {
    expect(formatPct(475)).toBe('4.75%')
    expect(formatPct(7_455n, 1)).toBe('74.5%')
    expect(formatPct(7_455n, 0)).toBe('74%')
  })
})

describe('formatSignedUsdc', () => {
  it('always shows the sign, except for zero', () => {
    expect(formatSignedUsdc(1_604_690_000n)).toBe('+1,604.69')
    expect(formatSignedUsdc(-12_000_000n)).toBe('-12.00')
    expect(formatSignedUsdc(0n)).toBe('0.00')
  })
})

describe('parseUnits', () => {
  it('parses integers, decimals and grouped input', () => {
    expect(parseUnits('1', 6)).toBe(1_000_000n)
    expect(parseUnits('5000', 18)).toBe(5_000n * 10n ** 18n)
    expect(parseUnits('1.0432', 18)).toBe(1_043_200_000_000_000_000n)
    expect(parseUnits('0.000001', 6)).toBe(1n)
    expect(parseUnits('1,000', 6)).toBe(1_000_000_000n)
  })
  it('tolerates a trailing dot, a leading dot and surrounding space', () => {
    expect(parseUnits('1.', 6)).toBe(1_000_000n)
    expect(parseUnits('.5', 6)).toBe(500_000n)
    expect(parseUnits('  300  ', 18)).toBe(300n * 10n ** 18n)
  })
  it('truncates excess precision rather than throwing', () => {
    expect(parseUnits('1.1234567', 6)).toBe(1_123_456n)
  })
  it('returns zero for empty input', () => {
    expect(parseUnits('', 6)).toBe(0n)
    expect(parseUnits('   ', 6)).toBe(0n)
  })
  it('rejects non-numeric input and negatives', () => {
    expect(() => parseUnits('abc', 6)).toThrow()
    expect(() => parseUnits('1.2.3', 6)).toThrow()
    expect(() => parseUnits('-1', 6)).toThrow()
    expect(() => parseUnits('.', 6)).toThrow()
  })
  it('round-trips against formatUsdc', () => {
    expect(formatUsdc(parseUnits('5167.3125', 6), 4)).toBe('5,167.3125')
  })
})

describe('formatCountdown', () => {
  it('formats minutes and zero-padded seconds', () => {
    expect(formatCountdown(64n)).toBe('1m 04s')
    expect(formatCountdown(120n)).toBe('2m 00s')
    expect(formatCountdown(9n)).toBe('0m 09s')
    expect(formatCountdown(3_700n)).toBe('61m 40s')
  })
  it('says due at or below zero', () => {
    expect(formatCountdown(0n)).toBe('due')
    expect(formatCountdown(-5n)).toBe('due')
  })
})
