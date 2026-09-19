'use client'

import { useReadContracts } from 'wagmi'
import { bridgeAbi, registryAbi } from '@/lib/abis'
import { useConnection } from 'wagmi'
import { useMaybeDeployment } from '@/providers/deployment'

// `DEFAULT_ADMIN_ROLE` is OpenZeppelin AccessControl's well-known constant — always bytes32(0) by
// spec, never a value that varies per deployment. Using the literal here (rather than reading the
// getter) is still an on-chain role read, not an address comparison: it saves one round-trip and
// carries no risk of drift.
const ZERO_ROLE = '0x0000000000000000000000000000000000000000000000000000000000000000' as const

/**
 * Admin surfaces are gated on an on-chain role read, never on an address comparison, so the demo
 * still works from a different wallet. `isRiskAdmin` additionally gates the impairment controls
 * (`markImpaired` / `recoverImpaired`), which are role-checked on the bridge, not the registry.
 */
export function useRoles() {
  const d = useMaybeDeployment()
  const { address } = useConnection()
  const enabled = Boolean(d && address)

  const { data, isLoading } = useReadContracts({
    allowFailure: false,
    contracts:
      d && address
        ? [
            { address: d.registry, abi: registryAbi, functionName: 'hasRole', args: [ZERO_ROLE, address] },
            { address: d.bridge, abi: bridgeAbi, functionName: 'DEMO_ADMIN_ROLE' },
            { address: d.bridge, abi: bridgeAbi, functionName: 'RISK_ADMIN_ROLE' },
          ]
        : [],
    query: { enabled, refetchInterval: 5_000 },
  })

  const demoRole = data?.[1] as `0x${string}` | undefined
  const riskRole = data?.[2] as `0x${string}` | undefined

  const { data: roleChecks } = useReadContracts({
    allowFailure: false,
    contracts:
      d && address && demoRole && riskRole
        ? [
            { address: d.bridge, abi: bridgeAbi, functionName: 'hasRole', args: [demoRole, address] },
            { address: d.bridge, abi: bridgeAbi, functionName: 'hasRole', args: [riskRole, address] },
          ]
        : [],
    query: { enabled: Boolean(d && address && demoRole && riskRole), refetchInterval: 5_000 },
  })

  return {
    isRegistryAdmin: Boolean(data?.[0]),
    isDemoAdmin: Boolean(roleChecks?.[0]),
    isRiskAdmin: Boolean(roleChecks?.[1]),
    isLoading: enabled && isLoading,
  }
}
