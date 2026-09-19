'use client'

import { useCallback, useMemo, useState } from 'react'
import { BaseError, ContractFunctionRevertedError } from 'viem'
import type { Abi, Address } from 'viem'
import { useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { formatUsdc } from '@/lib/format'

export type WriteReq = {
  address: Address
  abi: Abi
  functionName: string
  args?: readonly unknown[]
}

export type Revert = { name: string; args: readonly unknown[] }

/** Pull a decoded custom error out of viem's nested error chain. */
export function decodeRevert(err: unknown): Revert | undefined {
  if (!(err instanceof BaseError)) return undefined
  const found = err.walk((e) => e instanceof ContractFunctionRevertedError)
  if (!(found instanceof ContractFunctionRevertedError)) return undefined
  const name = found.data?.errorName ?? found.reason
  if (!name) return undefined
  return { name, args: found.data?.args ?? [] }
}

/** Human-readable text for the custom errors this UI can actually provoke. */
export function explainRevert(r: Revert): string {
  switch (r.name) {
    case 'NotEligibleRedeemer':
      return 'This asset is not redeemable: the protocol is not yet an eligible redeemer with its issuer.'
    case 'AssetDisabled':
      return 'This asset is currently disabled by the admin.'
    case 'InsufficientCapacity':
      return `Vault capacity is too low for this size. Payout would be ${r.args[0]}, capacity is ${r.args[1]}.`
    case 'SlippageExceeded':
      return `Payout ${r.args[0]} is below your minimum of ${r.args[1]}.`
    case 'SpreadTooHigh':
      return `Spread ${r.args[0]} bps exceeds the protocol maximum.`
    case 'PayoutTooSmall':
      return 'That amount rounds to a zero payout.'
    case 'SettlementWindowNotElapsed':
      return 'The settlement window has not elapsed yet. Use the admin override to settle now.'
    case 'ReceivableNotOpen':
      return 'That receivable is already settled.'
    case 'UtilisationTooHigh':
      return `This would push utilisation to ${r.args[0]} bps, above the cap of ${r.args[1]}.`
    case 'InsufficientIdle':
      return `The vault has only ${r.args[1]} idle USDC; ${r.args[0]} was requested.`
    case 'AssetNotRegistered':
      return 'That token is not registered with the protocol.'
    case 'EmptyVault':
      return 'The vault has no capital yet. An LP must deposit first.'
    case 'AccessControlUnauthorizedAccount':
      return 'The connected wallet does not hold the role required for this action.'
    case 'ExposureCapExceeded': {
      // args: [token, projected, cap] — projected and cap are USDC (6dp), safe to format.
      const projected = typeof r.args[1] === 'bigint' ? formatUsdc(r.args[1]) : String(r.args[1])
      const cap = typeof r.args[2] === 'bigint' ? formatUsdc(r.args[2]) : String(r.args[2])
      return `This trade would push the asset's exposure to ${projected} USDC, above its ${cap} USDC cap. The per-asset cap is tighter for assets carrying more credit risk — that is the protocol pricing risk correctly, not a malfunction. Reduce the redemption size, or choose an asset with headroom.`
    }
    case 'NotYetImpairable': {
      // args: [id, impairableAt] — impairableAt is a chain timestamp, not a duration; no arithmetic on it here.
      return `Receivable #${String(r.args[0])} cannot be marked impaired yet: the impairment grace period has not elapsed since it settled. Wait for the grace period to pass, then retry.`
    }
    case 'NotImpaired':
      return `Receivable #${String(r.args[0])} is not impaired, so it cannot be recovered through this action. Only a receivable already marked impaired can be recovered.`
    case 'LossExceedsOutstanding': {
      // args: [loss, outstanding] — both USDC (6dp).
      const loss = typeof r.args[0] === 'bigint' ? formatUsdc(r.args[0]) : String(r.args[0])
      const outstanding = typeof r.args[1] === 'bigint' ? formatUsdc(r.args[1]) : String(r.args[1])
      return `The implied loss of ${loss} USDC exceeds the ${outstanding} USDC still outstanding on this receivable. Enter a recovered amount that leaves a loss no larger than what is outstanding.`
    }
    default:
      return r.args.length > 0 ? `${r.name}(${r.args.map(String).join(', ')})` : r.name
  }
}

export function useTx() {
  const write = useWriteContract()
  const [dismissed, setDismissed] = useState(false)

  const receipt = useWaitForTransactionReceipt({
    hash: write.data,
    query: { enabled: Boolean(write.data) },
  })

  const send = useCallback(
    (req: WriteReq) => {
      setDismissed(false)
      // wagmi 3: mutation hooks expose .mutate — there is no destructurable `writeContract`.
      write.mutate({
        address: req.address,
        abi: req.abi,
        functionName: req.functionName,
        args: req.args,
      } as Parameters<typeof write.mutate>[0])
    },
    [write],
  )

  const reset = useCallback(() => {
    setDismissed(true)
    write.reset()
  }, [write])

  const revert = useMemo(() => decodeRevert(write.error), [write.error])

  const status = dismissed
    ? ('idle' as const)
    : write.isPending
      ? ('signing' as const)
      : write.error
        ? ('error' as const)
        : write.data && receipt.isLoading
          ? ('confirming' as const)
          : receipt.isSuccess
            ? ('success' as const)
            : ('idle' as const)

  const message = write.error
    ? revert
      ? explainRevert(revert)
      : write.error instanceof BaseError
        ? write.error.shortMessage
        : write.error.message
    : undefined

  return { send, reset, status, hash: write.data, revert, message }
}
