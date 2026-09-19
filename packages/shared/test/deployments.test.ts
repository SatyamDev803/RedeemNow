import { describe, expect, it } from 'vitest'
import { isAddress } from 'viem'
import { anvilLocal, chainById, monadTestnet, supportedChains } from '../src/chains.js'
import { RWA_KEYS, clearDeploymentCache, loadDeployment } from '../src/deployments.js'

describe('chains', () => {
  it('defines monad testnet with the right id and currency', () => {
    expect(monadTestnet.id).toBe(10143)
    expect(monadTestnet.nativeCurrency.symbol).toBe('MON')
    expect(monadTestnet.nativeCurrency.decimals).toBe(18)
    expect(monadTestnet.rpcUrls.default.http[0]).toBe('https://testnet-rpc.monad.xyz')
  })

  it('defines anvil at 31337', () => {
    expect(anvilLocal.id).toBe(31337)
    expect(anvilLocal.rpcUrls.default.http[0]).toBe('http://127.0.0.1:8545')
  })

  it('resolves both supported chains by id', () => {
    expect(supportedChains.map((c) => c.id).sort()).toEqual([10143, 31337])
    expect(chainById(10143)).toBe(monadTestnet)
    expect(chainById(31337)).toBe(anvilLocal)
  })

  it('throws on an unknown chain id', () => {
    expect(() => chainById(1)).toThrow(/unsupported chain/i)
  })
})

describe('loadDeployment', () => {
  it('loads the anvil deployment with every address present and checksummed-valid', () => {
    const d = loadDeployment(31337)
    expect(d.chainId).toBe(31337)
    const keys = [
      'bridge', 'vault', 'registry', 'issuer', 'usdc',
      'rTBILL', 'rJAAA', 'rCREDIT', 'rTSLA', 'rPRIV',
      'treasury', 'deployer',
    ] as const
    for (const k of keys) {
      expect(isAddress(d[k]), `${k} = ${d[k]}`).toBe(true)
    }
  })

  it('exposes the five RWA keys in demo order', () => {
    expect(RWA_KEYS).toEqual(['rTBILL', 'rJAAA', 'rCREDIT', 'rTSLA', 'rPRIV'])
  })

  it('throws a useful error for a chain with no deployment file', () => {
    expect(() => loadDeployment(999)).toThrow(/no deployment for chain 999/i)
  })

  it('bypasses the cache with { fresh: true } and via clearDeploymentCache()', () => {
    const first = loadDeployment(31337)
    expect(loadDeployment(31337, { fresh: true })).toEqual(first)
    clearDeploymentCache()
    expect(loadDeployment(31337)).toEqual(first)
  })
})
