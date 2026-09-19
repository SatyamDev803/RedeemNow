// SERVER-ONLY BARREL: this re-exports ./deployments.js, which reads node:fs at import time. That
// makes importing this package root ("@redeemnow/shared") server-only too. A `"use client"` module
// must import `@redeemnow/shared/chains` or `@redeemnow/shared/pricing` directly rather than this
// barrel, or bundlers will pull node:fs into client code (or fail outright).
export * from './chains.js'
export * from './deployments.js'
export * from './pricing.js'
