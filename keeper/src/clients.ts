import { createPublicClient, createWalletClient, http } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { chainById, loadDeployment, type Deployment } from '@redeemnow/shared'
import type { KeeperConfig } from './config.js'

export type Ctx = {
  public: ReturnType<typeof createPublicClient>
  wallet: ReturnType<typeof createWalletClient>
  account: ReturnType<typeof privateKeyToAccount>
  deployment: Deployment
  chainId: number
}

export function makeCtx(cfg: KeeperConfig): Ctx {
  const chain = chainById(cfg.chainId)
  const transport = http(cfg.rpcUrl)
  const account = privateKeyToAccount(cfg.privateKey)

  return {
    public: createPublicClient({ chain, transport }),
    wallet: createWalletClient({ account, chain, transport }),
    account,
    deployment: loadDeployment(cfg.chainId),
    chainId: cfg.chainId,
  }
}

/** Fail fast and loudly if the RPC is unreachable — a silent retry loop wastes demo time. */
export async function assertChainReachable(ctx: Ctx): Promise<void> {
  const id = await ctx.public.getChainId()
  if (id !== ctx.chainId) {
    throw new Error(`RPC reports chain ${id} but CHAIN_ID is ${ctx.chainId}`)
  }
}
