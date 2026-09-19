/**
 * Mirrors `RedemptionBridge.Status` exactly as deployed
 * (contracts/src/RedemptionBridge.sol): `enum Status { Open, Settled, Impaired }`.
 * `Impaired` was appended after `Settled`, so `STATUS_OPEN = 0` / `STATUS_SETTLED = 1` are
 * unchanged; reordering would have silently reinterpreted every stored receivable.
 * There is no `None` variant — an unknown id reads back as Open(0) with a zero
 * `settleAfter`, which is why `selectDue` also checks the id came from
 * `openReceivableIds()` rather than trusting status alone.
 */
export const STATUS_OPEN = 0
export const STATUS_SETTLED = 1
export const STATUS_IMPAIRED = 2

export type OpenReceivable = {
  id: bigint
  settleAfter: bigint
  status: number
}

export type Attempt = {
  attempts: number
  /** epoch ms before which we should not retry */
  nextEligibleAt: number
}

const BASE_BACKOFF_MS = 1_000
const MAX_BACKOFF_MS = 30_000
export const DEFAULT_MAX_ATTEMPTS = 5

/**
 * The contract settles when `block.timestamp >= settleAfter`, so the comparison is >=, not >.
 * Using > here would make the keeper skip a receivable for one whole poll tick.
 */
export function isDue(r: OpenReceivable, nowSec: bigint): boolean {
  if (r.status !== STATUS_OPEN) return false
  return nowSec >= r.settleAfter
}

/** 1s, 2s, 4s, 8s, 16s, then flat 30s. */
export function backoffMs(attempts: number): number {
  if (attempts <= 0) return BASE_BACKOFF_MS
  const grown = BASE_BACKOFF_MS * 2 ** attempts
  return grown > MAX_BACKOFF_MS ? MAX_BACKOFF_MS : grown
}

/**
 * Pure: which receivable ids should we try to settle on this tick?
 * Ascending id order, so the demo settles in the order the holder created them.
 */
export function selectDue(
  receivables: readonly OpenReceivable[],
  nowSec: bigint,
  attempts: ReadonlyMap<bigint, Attempt>,
  nowMs: number,
  maxAttempts: number = DEFAULT_MAX_ATTEMPTS,
): bigint[] {
  const out: bigint[] = []
  for (const r of receivables) {
    if (!isDue(r, nowSec)) continue
    const a = attempts.get(r.id)
    if (a) {
      if (a.attempts >= maxAttempts) continue
      if (nowMs < a.nextEligibleAt) continue
    }
    out.push(r.id)
  }
  return out.sort((x, y) => (x < y ? -1 : x > y ? 1 : 0))
}
