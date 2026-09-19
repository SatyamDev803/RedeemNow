import { chainById } from '@redeemnow/shared/chains'

export type KeeperConfig = {
  rpcUrl: string
  chainId: number
  privateKey: `0x${string}`
}

function require_(env: NodeJS.ProcessEnv, key: string): string {
  const v = env[key]
  if (v === undefined || v.trim() === '') {
    throw new Error(`missing required env var ${key} — copy keeper/.env.example to keeper/.env`)
  }
  return v.trim()
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): KeeperConfig {
  const rpcUrl = require_(env, 'RPC_URL')

  const rawChainId = require_(env, 'CHAIN_ID')
  const chainId = Number(rawChainId)
  if (!Number.isInteger(chainId)) {
    throw new Error(`CHAIN_ID must be an integer, got "${rawChainId}"`)
  }
  chainById(chainId) // throws "unsupported chain <id>" for anything we do not know

  const privateKey = require_(env, 'KEEPER_PRIVATE_KEY')
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error('KEEPER_PRIVATE_KEY must be 0x followed by 64 hex characters')
  }

  return { rpcUrl, chainId, privateKey: privateKey as `0x${string}` }
}
