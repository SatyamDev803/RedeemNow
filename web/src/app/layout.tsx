import type { Metadata } from 'next'
import { Inter, JetBrains_Mono, Geist } from 'next/font/google'
import { headers } from 'next/headers'
import type { ReactNode } from 'react'
import { cookieToInitialState } from 'wagmi'
import { getDeployments } from '@/lib/deployments.server'
import { getConfig } from '@/lib/wagmi'
import { Providers } from '@/providers/providers'
import { Nav } from '@/components/Nav'
import './globals.css'
import { cn } from "@/lib/utils";

const geist = Geist({subsets:['latin'],variable:'--font-sans'});


// Inter is the cross-platform fallback only — on Apple hardware the stack in globals.css
// resolves to genuine SF Pro first. JetBrains Mono is for hashes and addresses only.
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' })
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono-stack', display: 'swap' })

// Design-system ruling 6: light is the default, dark is a selected counterpart. This script runs
// before hydration and mirrors ThemeProvider.resolve() exactly, so there is no flash of the wrong
// theme and no mismatch between the pre-paint class and the first client render.
const themeScript = `(function(){try{var s=localStorage.getItem('redeemnow.theme');`
  + `var d=s==='dark'||(!s&&matchMedia('(prefers-color-scheme: dark)').matches);`
  + `if(d)document.documentElement.classList.add('dark');`
  + `document.documentElement.style.colorScheme=d?'dark':'light';}catch(e){}})()`

export const metadata: Metadata = {
  title: 'RedeemNow',
  description: 'Instant liquidity for tokenized RWAs — exit at NAV in one block.',
}

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Next 16: headers() must be awaited.
  const initialState = cookieToInitialState(getConfig(), (await headers()).get('cookie'))
  const deployments = getDeployments()

  return (
    <html lang="en" className={cn(inter.variable, mono.variable, "font-sans", geist.variable)} suppressHydrationWarning>
      {/* Sets the theme class before first paint so there is no flash of the wrong theme.
          No hardcoded `dark` class or data-theme here — this script is the only thing that
          decides it, and it decides per system preference / stored choice, never unconditionally. */}
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body className="min-h-dvh bg-ground text-ink antialiased">
        <Providers initialState={initialState} deployments={deployments}>
          <Nav />
          <main className="mx-auto w-full max-w-[1400px] px-4 pb-16 sm:px-6">{children}</main>
        </Providers>
      </body>
    </html>
  )
}
