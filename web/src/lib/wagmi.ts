import { cookieStorage, createConfig, createStorage, http } from 'wagmi'
import { anvil, monadTestnet } from 'wagmi/chains'
import { injected } from 'wagmi/connectors'

declare module 'wagmi' {
  interface Register {
    config: ReturnType<typeof getConfig>
  }
}

export function getConfig() {
  return createConfig({
    chains: [monadTestnet, anvil],
    ssr: true,
    storage: createStorage({ storage: cookieStorage }),
    connectors: [injected()],
    transports: {
      [monadTestnet.id]: http(),
      [anvil.id]: http(),
    },
  })
}
