'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { WagmiProvider, type State } from 'wagmi'
import type { Deployment } from '@redeemnow/shared/deployments'
import { getConfig } from '@/lib/wagmi'
import { DeploymentProvider } from './deployment'
import { ThemeProvider } from './theme'
import { TooltipProvider } from '@/components/ui/tooltip'

export function Providers({
  children,
  initialState,
  deployments,
}: {
  children: ReactNode
  initialState: State | undefined
  deployments: Record<number, Deployment>
}) {
  const [config] = useState(() => getConfig())
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Reads poll on an explicit refetchInterval per hook; keep values fresh but do not
            // hammer the RPC on every remount.
            staleTime: 500,
            retry: 1,
          },
        },
      }),
  )

  return (
    <WagmiProvider config={config} initialState={initialState}>
      <QueryClientProvider client={queryClient}>
        <DeploymentProvider value={deployments}>
          <ThemeProvider>
            {/* shadcn tooltips need one provider at the root; `delay` keeps a clarifier
                from popping up while the pointer is merely crossing the tile. */}
            <TooltipProvider delay={200}>{children}</TooltipProvider>
          </ThemeProvider>
        </DeploymentProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
