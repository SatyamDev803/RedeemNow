// Re-export the wagmi-cli generated ABIs under stable local names.
// IMPORTANT: the right-hand side must match packages/shared/src/generated.ts EXACTLY. Verified via:
//   grep -oE 'export const [a-zA-Z]+Abi' packages/shared/src/generated.ts | sort
// which printed: liquidityVaultAbi, mockIssuerAbi, mockRwaTokenAbi, mockUsdcAbi,
// redemptionBridgeAbi, rwaRegistryAbi.
export {
  redemptionBridgeAbi as bridgeAbi,
  liquidityVaultAbi as vaultAbi,
  rwaRegistryAbi as registryAbi,
  mockIssuerAbi as issuerAbi,
  mockUsdcAbi as usdcAbi,
  mockRwaTokenAbi as rwaAbi,
} from '@redeemnow/shared/generated'
