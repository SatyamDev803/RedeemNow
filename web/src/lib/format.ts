// PURE bigint -> string formatters. No imports. This is the only place in `web/` a bigint becomes
// a display string, and the only place `.toString()`/string slicing stands in for float math.
// Never introduce Number()/parseFloat or arithmetic on a float here — every conversion below is
// integer math on the bigint's decimal-string representation.

function splitFixed(value: bigint, decimals: number): { sign: string; whole: string; frac: string } {
  const sign = value < 0n ? '-' : ''
  const abs = value < 0n ? -value : value
  const digits = abs.toString().padStart(decimals + 1, '0')
  const whole = digits.slice(0, digits.length - decimals)
  const frac = decimals === 0 ? '' : digits.slice(digits.length - decimals)
  return { sign, whole, frac }
}

function groupThousands(whole: string): string {
  let out = ''
  let count = 0
  for (let i = whole.length - 1; i >= 0; i--) {
    out = whole[i] + out
    count++
    if (count % 3 === 0 && i !== 0) out = ',' + out
  }
  return out
}

/**
 * Render a fixed-point bigint (`decimals` implied decimal places) as a grouped decimal string,
 * truncated (never rounded) to `displayDecimals`. Truncation, not rounding, so a displayed
 * balance never overstates what is actually redeemable on chain.
 *
 * formatFixed(123456789n, 6, 2) -> "123.45"   (123.456789 USDC, shown to 2dp)
 */
export function formatFixed(value: bigint, decimals: number, displayDecimals: number = decimals): string {
  const { sign, whole, frac } = splitFixed(value, decimals)
  const grouped = groupThousands(whole)
  if (displayDecimals <= 0) return `${sign}${grouped}`
  const truncatedFrac = frac.padEnd(decimals, '0').slice(0, displayDecimals)
  return `${sign}${grouped}.${truncatedFrac}`
}

/** USDC amounts are 6-decimal fixed point on chain. Default display: 2dp with thousands separators. */
export function formatUsdc(amountUsdc: bigint, displayDecimals: number = 2): string {
  return formatFixed(amountUsdc, 6, displayDecimals)
}

/** RWA token amounts and NAV-per-token are 18-decimal (WAD) fixed point. Default display: 4dp. */
export function formatToken(amountWad: bigint, displayDecimals: number = 4): string {
  return formatFixed(amountWad, 18, displayDecimals)
}

/** Basis points as a plain integer, suffixed. formatBps(125n) -> "125 bp" */
export function formatBps(bps: bigint): string {
  return `${bps.toString()} bp`
}

/**
 * Basis points rendered as a percentage (100 bps = 1.00%). formatBpsAsPercent(1250n) -> "12.50%"
 */
export function formatBpsAsPercent(bps: bigint, displayDecimals: number = 2): string {
  return `${formatFixed(bps, 2, displayDecimals)}%`
}

// ---------------------------------------------------------------------------
// Added by the controller. The plan's original source for this file was lost to
// a bad patch anchor, so the first implementer reasonably wrote only the five
// functions above. The routes need these six as well.
// ---------------------------------------------------------------------------

/** Alias of formatFixed, for call sites that read more naturally as "units". */
export const formatUnits = formatFixed

/** 18-decimal (WAD) values: NAV per token, token amounts, horizons in days. */
export function formatWad(valueWad: bigint, displayDecimals: number = 4): string {
  return formatFixed(valueWad, 18, displayDecimals)
}

/** Alias of formatBpsAsPercent. 287 bps -> "2.87%". */
export function formatPct(bps: bigint | number, displayDecimals: number = 2): string {
  return formatBpsAsPercent(BigInt(bps), displayDecimals)
}

/**
 * P&L always carries an explicit sign, because for P&L the sign is the meaning.
 * Zero renders unsigned — "+0.00" reads as a gain that did not happen.
 */
export function formatSignedUsdc(amountUsdc: bigint, displayDecimals: number = 2): string {
  if (amountUsdc === 0n) return formatFixed(0n, 6, displayDecimals)
  const body = formatFixed(amountUsdc < 0n ? -amountUsdc : amountUsdc, 6, displayDecimals)
  return `${amountUsdc > 0n ? '+' : '-'}${body}`
}

/**
 * Parse typed input into fixed-point. Excess precision is TRUNCATED rather than rejected, so
 * pasting an 18-decimal figure into a 6-decimal field does something sensible instead of erroring.
 * Rejects anything that is not a non-negative decimal — including a minus sign, since no amount
 * field in this app accepts one.
 */
export function parseUnits(input: string, decimals: number): bigint {
  const cleaned = input.trim().replace(/,/g, '')
  if (cleaned === '') return 0n
  if (cleaned === '.' || !/^\d*\.?\d*$/.test(cleaned)) {
    throw new Error(`not a non-negative decimal number: "${input}"`)
  }
  const dot = cleaned.indexOf('.')
  const wholePart = dot === -1 ? cleaned : cleaned.slice(0, dot)
  const fracPart = dot === -1 ? '' : cleaned.slice(dot + 1)
  const whole = wholePart === '' ? 0n : BigInt(wholePart)
  const frac = fracPart === '' ? 0n : BigInt(fracPart.padEnd(decimals, '0').slice(0, decimals))
  return whole * 10n ** BigInt(decimals) + frac
}

/**
 * Time remaining on a settlement window, from CHAIN seconds. "due" at or below zero, because the
 * contract's own gate is `block.timestamp >= settleAfter` and a negative countdown is meaningless.
 */
export function formatCountdown(secondsRemaining: bigint): string {
  if (secondsRemaining <= 0n) return 'due'
  const m = secondsRemaining / 60n
  const s = secondsRemaining % 60n
  return `${m}m ${s.toString().padStart(2, '0')}s`
}
