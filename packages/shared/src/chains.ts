import { anvil, monadTestnet } from 'viem/chains'
import type { Chain } from 'viem'

/// Monad testnet, chain 10143. Re-exported from viem rather than hand-defined: viem 2.56.8 ships
/// this definition with the same RPC and explorer, and re-exporting keeps one source of truth.
export { monadTestnet }
/// Anvil local, chain 31337. (viem also exports `foundry` as a deprecated alias for this.)
export { anvil as anvilLocal }

export const supportedChains = [monadTestnet, anvil] as const satisfies readonly [Chain, ...Chain[]]

export function chainById(id: number): Chain {
  const found = supportedChains.find((c) => c.id === id)
  if (!found) {
    throw new Error(
      `unsupported chain ${id}; expected one of ${supportedChains.map((c) => c.id).join(', ')}`,
    )
  }
  return found
}
