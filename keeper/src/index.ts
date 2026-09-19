#!/usr/bin/env -S npx tsx
import { config as loadDotenv } from 'dotenv'
import { Command } from 'commander'
import { loadConfig } from './config.js'
import { makeCtx } from './clients.js'
import { runSettle } from './settle.js'
import { runNavSim } from './nav-sim.js'

loadDotenv()

const program = new Command()
program.name('keeper').description('RedeemNow keeper: settles receivables and simulates NAV')

program
  .command('settle')
  .description('settle every receivable whose settlement window has elapsed')
  .option('--interval <ms>', 'poll interval in ms', '2000')
  .option('--once', 'run a single tick and exit', false)
  .option('--max-attempts <n>', 'attempts before giving up on a receivable', '5')
  .action(async (o: { interval: string; once: boolean; maxAttempts: string }) => {
    const ctx = makeCtx(loadConfig())
    await runSettle(ctx, {
      intervalMs: Number(o.interval),
      once: o.once,
      maxAttempts: Number(o.maxAttempts),
    })
  })

program
  .command('nav-sim')
  .description('accrue rTBILL at 4%/yr and random-walk rTSLA')
  .option('--interval <ms>', 'tick interval in ms', '10000')
  .option('--once', 'run a single tick and exit', false)
  .action(async (o: { interval: string; once: boolean }) => {
    const ctx = makeCtx(loadConfig())
    await runNavSim(ctx, { intervalMs: Number(o.interval), once: o.once })
  })

program.parseAsync().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
