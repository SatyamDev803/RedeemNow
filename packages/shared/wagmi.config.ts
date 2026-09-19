import { defineConfig } from '@wagmi/cli'
import { foundry } from '@wagmi/cli/plugins'

export default defineConfig({
  out: 'src/generated.ts',
  plugins: [
    foundry({
      project: '../../contracts',
      // Artifacts are already built by `forge build`; don't shell out during generation.
      forge: { build: false },
      include: [
        'RedemptionBridge.sol/**',
        'LiquidityVault.sol/**',
        'RWARegistry.sol/**',
        'MockIssuer.sol/**',
        'MockUSDC.sol/**',
        'MockRWAToken.sol/**',
      ],
    }),
  ],
})
