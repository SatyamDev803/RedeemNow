import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Turbopack is the default in Next 16 for dev and build. No webpack config — adding one would
  // force `next build --webpack`.
  transpilePackages: ['@redeemnow/shared'],
}

export default nextConfig
