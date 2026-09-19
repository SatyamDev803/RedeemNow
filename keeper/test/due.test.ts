import { describe, expect, it } from 'vitest'
import { STATUS_OPEN, STATUS_SETTLED, backoffMs, isDue, selectDue, type Attempt } from '../src/due.js'
import { loadConfig } from '../src/config.js'

const open = (id: bigint, settleAfter: bigint, status = STATUS_OPEN) => ({ id, settleAfter, status })

describe('isDue', () => {
  it('is due when now has passed settleAfter', () => {
    expect(isDue(open(1n, 100n), 101n)).toBe(true)
  })

  it('is due exactly at settleAfter (the contract uses >=)', () => {
    expect(isDue(open(1n, 100n), 100n)).toBe(true)
  })

  it('is not due before settleAfter', () => {
    expect(isDue(open(1n, 100n), 99n)).toBe(false)
  })

  it('is never due when not open', () => {
    expect(isDue(open(1n, 0n, STATUS_SETTLED), 10_000n)).toBe(false)
    // any value that is not Open, including one outside the enum
    expect(isDue(open(1n, 0n, 99), 10_000n)).toBe(false)
  })
})

describe('backoffMs', () => {
  it('grows exponentially from 1s and caps at 30s', () => {
    expect(backoffMs(0)).toBe(1_000)
    expect(backoffMs(1)).toBe(2_000)
    expect(backoffMs(2)).toBe(4_000)
    expect(backoffMs(3)).toBe(8_000)
    expect(backoffMs(4)).toBe(16_000)
    expect(backoffMs(5)).toBe(30_000)
    expect(backoffMs(99)).toBe(30_000)
  })
})

describe('selectDue', () => {
  const none = new Map<bigint, Attempt>()

  it('returns due ids in ascending order', () => {
    const ids = selectDue(
      [open(3n, 10n), open(1n, 10n), open(2n, 999n)],
      50n,
      none,
      0,
    )
    expect(ids).toEqual([1n, 3n])
  })

  it('excludes receivables still inside their window', () => {
    expect(selectDue([open(1n, 100n)], 99n, none, 0)).toEqual([])
  })

  it('excludes a receivable whose backoff has not elapsed', () => {
    const attempts = new Map<bigint, Attempt>([[1n, { attempts: 1, nextEligibleAt: 5_000 }]])
    expect(selectDue([open(1n, 10n)], 50n, attempts, 4_999)).toEqual([])
    expect(selectDue([open(1n, 10n)], 50n, attempts, 5_000)).toEqual([1n])
  })

  it('gives up after maxAttempts', () => {
    const attempts = new Map<bigint, Attempt>([[1n, { attempts: 5, nextEligibleAt: 0 }]])
    expect(selectDue([open(1n, 10n)], 50n, attempts, 1_000, 5)).toEqual([])
    expect(selectDue([open(1n, 10n)], 50n, attempts, 1_000, 6)).toEqual([1n])
  })

  it('handles an empty book', () => {
    expect(selectDue([], 50n, none, 0)).toEqual([])
  })
})

describe('loadConfig', () => {
  const good = {
    RPC_URL: 'http://127.0.0.1:8545',
    CHAIN_ID: '31337',
    KEEPER_PRIVATE_KEY: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
  }

  it('parses a complete env', () => {
    const c = loadConfig(good as NodeJS.ProcessEnv)
    expect(c.chainId).toBe(31337)
    expect(c.rpcUrl).toBe('http://127.0.0.1:8545')
    expect(c.privateKey.startsWith('0x')).toBe(true)
  })

  it('names the missing variable', () => {
    const { RPC_URL: _omit, ...rest } = good
    expect(() => loadConfig(rest as NodeJS.ProcessEnv)).toThrow(/RPC_URL/)
  })

  it('rejects a non-numeric chain id', () => {
    expect(() => loadConfig({ ...good, CHAIN_ID: 'mainnet' } as NodeJS.ProcessEnv)).toThrow(/CHAIN_ID/)
  })

  it('rejects an unsupported chain id', () => {
    expect(() => loadConfig({ ...good, CHAIN_ID: '1' } as NodeJS.ProcessEnv)).toThrow(/unsupported chain/i)
  })

  it('rejects a malformed private key', () => {
    expect(() => loadConfig({ ...good, KEEPER_PRIVATE_KEY: 'nope' } as NodeJS.ProcessEnv)).toThrow(
      /KEEPER_PRIVATE_KEY/,
    )
  })
})
