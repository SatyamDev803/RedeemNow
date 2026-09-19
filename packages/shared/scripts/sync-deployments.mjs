#!/usr/bin/env node
// Copies contracts/deployments/*.json into packages/shared/deployments/.
// Spec §3 has consumers read from the shared package; Plan 1's reviewed deploy script writes to
// contracts/. Copying keeps both true without touching reviewed Solidity.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const src = resolve(here, '../../../contracts/deployments')
const dst = resolve(here, '../deployments')

mkdirSync(dst, { recursive: true })

let copied = 0
for (const f of readdirSync(src)) {
  if (!f.endsWith('.json')) continue
  copyFileSync(join(src, f), join(dst, f))
  console.log(`synced ${f}`)
  copied++
}
if (copied === 0) {
  console.error(`no deployment JSON found in ${src} — run the deploy script first`)
  process.exit(1)
}
