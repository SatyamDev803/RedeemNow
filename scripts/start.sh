#!/usr/bin/env bash
#
# Bring up the whole RedeemNow dev stack: Anvil -> contracts -> address sync -> keeper -> web.
#
# Default behaviour is IDEMPOTENT and NON-DESTRUCTIVE: if a chain is already running it is reused
# and contracts are NOT redeployed. That default is deliberate. Spreads and per-asset exposure caps
# are state-dependent — the cap is `totalAssets * maxExposureBps / 10000` and the utilisation term
# depends on what is already outstanding — so silently resetting the chain mid-session changes the
# numbers on screen and can make a rehearsed demo step stop binding. Ask for that explicitly:
#
#   ./scripts/start.sh            reuse whatever is running; deploy only if nothing is deployed
#   ./scripts/start.sh --fresh    kill the chain, restart it, redeploy, reseed. Use before a demo.
#   ./scripts/start.sh --no-web   skip the Next dev server
#   ./scripts/start.sh --no-keeper
#   ./scripts/start.sh --seed     also deposit 100,000 USDC as the LP (implied by --fresh)
#
# Stop everything with ./scripts/stop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.devstack"
LOG_DIR="$RUN_DIR/logs"
RPC="http://127.0.0.1:8545"
CHAIN_ID=31337
# Anvil's well-known account 0. This is a PUBLIC test key that ships with Foundry and is safe to
# commit; it is the only key this stack ever uses. Never point these scripts at a funded account.
ANVIL_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80

FRESH=0 WEB=1 KEEPER=1 SEED=0
for arg in "$@"; do
  case "$arg" in
    --fresh)     FRESH=1; SEED=1 ;;
    --no-web)    WEB=0 ;;
    --no-keeper) KEEPER=0 ;;
    --seed)      SEED=1 ;;
    -h|--help)   sed -n '2,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)           echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

mkdir -p "$LOG_DIR"
export PATH="$HOME/.foundry/bin:$PATH"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[31mfatal\033[0m %s\n' "$*" >&2; exit 1; }

port_pid() { lsof -ti:"$1" 2>/dev/null | head -1; }

# Wait for a condition instead of sleeping a guessed interval.
wait_for() {
  local what="$1" tries="$2"; shift 2
  for _ in $(seq "$tries"); do
    if "$@" >/dev/null 2>&1; then return 0; fi
    sleep 0.4
  done
  die "timed out waiting for $what"
}

for bin in anvil cast forge pnpm; do
  command -v "$bin" >/dev/null || die "$bin not found on PATH. Foundry lives in ~/.foundry/bin."
done

# ---------------------------------------------------------------- 1. chain
if [[ $FRESH -eq 1 ]]; then
  say "--fresh: tearing down any running chain"
  "$ROOT/scripts/stop.sh" --chain-only || true
fi

if [[ -n "$(port_pid 8545)" ]]; then
  say "Anvil already listening on 8545 — reusing it (pass --fresh to start over)"
else
  say "starting Anvil"
  ( cd "$ROOT/contracts" && nohup anvil --silent >"$LOG_DIR/anvil.log" 2>&1 & echo $! >"$RUN_DIR/anvil.pid" )
  wait_for "Anvil to accept RPC" 40 cast block-number --rpc-url "$RPC"
fi

# ---------------------------------------------------------------- 2. contracts
DEPLOYMENT="$ROOT/contracts/deployments/$CHAIN_ID.json"
need_deploy=1
if [[ -f "$DEPLOYMENT" ]] && [[ $FRESH -eq 0 ]]; then
  # A deployments file from a previous, now-dead chain is worse than none: the addresses parse fine
  # and every call reverts or returns zero. Confirm the bridge actually has code at that address.
  bridge=$(python3 -c "import json;print(json.load(open('$DEPLOYMENT'))['bridge'])")
  code=$(cast code "$bridge" --rpc-url "$RPC" 2>/dev/null || echo 0x)
  if [[ ${#code} -gt 2 ]]; then
    say "contracts already deployed at $bridge — skipping deploy"
    need_deploy=0
  else
    warn "deployments/$CHAIN_ID.json points at $bridge, which has no code on this chain — redeploying"
  fi
fi

if [[ $need_deploy -eq 1 ]]; then
  say "deploying contracts"
  ( cd "$ROOT/contracts" \
    && forge script script/Deploy.s.sol --rpc-url "$RPC" --broadcast --private-key "$ANVIL_KEY" \
       >"$LOG_DIR/deploy.log" 2>&1 ) \
    || { tail -30 "$LOG_DIR/deploy.log"; die "deploy failed — full log at $LOG_DIR/deploy.log"; }
  SEED=1   # a brand-new book has no LP capital, so nothing can be redeemed until it does
fi

say "syncing addresses into packages/shared/deployments"
( cd "$ROOT" && pnpm --filter @redeemnow/shared sync >"$LOG_DIR/sync.log" 2>&1 ) \
  || { cat "$LOG_DIR/sync.log"; die "address sync failed"; }

# ---------------------------------------------------------------- 3. seed LP capital
if [[ $SEED -eq 1 ]]; then
  g() { python3 -c "import json;print(json.load(open('$DEPLOYMENT'))['$1'])"; }
  USDC=$(g usdc); VAULT=$(g vault); DEPLOYER=$(g deployer)
  current=$(cast call "$VAULT" 'totalAssets()(uint256)' --rpc-url "$RPC" | awk '{print $1}')
  if [[ "$current" == "0" ]]; then
    say "seeding 100,000 USDC of LP capital"
    # 100,000 USDC at 6 decimals. The demo's exposure caps are calibrated to exactly this book size:
    # rCREDIT's 800 bps cap is an 8,000 USDC ceiling only when totalAssets is 100,000.
    cast send "$USDC"  'approve(address,uint256)' "$VAULT" 100000000000 \
      --rpc-url "$RPC" --private-key "$ANVIL_KEY" >/dev/null
    cast send "$VAULT" 'deposit(uint256,address)' 100000000000 "$DEPLOYER" \
      --rpc-url "$RPC" --private-key "$ANVIL_KEY" >/dev/null
  else
    say "vault already holds $(cast --to-unit "$current" 6) USDC — not seeding again"
  fi
fi

# ---------------------------------------------------------------- 4. keeper
if [[ $KEEPER -eq 1 ]]; then
  if [[ -f "$RUN_DIR/keeper.pid" ]] && kill -0 "$(cat "$RUN_DIR/keeper.pid")" 2>/dev/null; then
    say "keeper already running (pid $(cat "$RUN_DIR/keeper.pid"))"
  else
    if [[ ! -f "$ROOT/keeper/.env" ]]; then
      warn "keeper/.env missing — skipping keeper. Copy keeper/.env.example and re-run."
    else
      say "starting keeper"
      # `settle` WITHOUT --once is the continuous mode; it polls every --interval ms (default 2000).
      # There is no `watch` subcommand — see keeper/src/index.ts.
      ( cd "$ROOT/keeper" && nohup pnpm keeper settle >"$LOG_DIR/keeper.log" 2>&1 & echo $! >"$RUN_DIR/keeper.pid" )
    fi
  fi
fi

# ---------------------------------------------------------------- 5. web
if [[ $WEB -eq 1 ]]; then
  if [[ -n "$(port_pid 3000)" ]]; then
    say "something is already serving on 3000 — leaving it alone"
  else
    say "starting Next dev server"
    ( cd "$ROOT/web" && nohup pnpm dev >"$LOG_DIR/web.log" 2>&1 & echo $! >"$RUN_DIR/web.pid" )
    wait_for "the dev server to answer on 3000" 75 curl -sf -o /dev/null http://localhost:3000
  fi
fi

# ---------------------------------------------------------------- summary
echo
say "dev stack up"
printf '  chain      %s (id %s, block %s)\n' "$RPC" "$CHAIN_ID" "$(cast block-number --rpc-url "$RPC")"
if [[ -f "$DEPLOYMENT" ]]; then
  printf '  bridge     %s\n' "$(python3 -c "import json;print(json.load(open('$DEPLOYMENT'))['bridge'])")"
  printf '  book       %s USDC\n' "$(cast --to-unit "$(cast call "$(python3 -c "import json;print(json.load(open('$DEPLOYMENT'))['vault'])")" 'totalAssets()(uint256)' --rpc-url "$RPC" | awk '{print $1}')" 6)"
fi
# `[[ ]] && printf` is an AND-list: when the test fails the list returns 1 and `set -e` kills the
# script, so --no-web would abort the summary here. `if` blocks cannot do that.
if [[ $WEB -eq 1 ]];    then printf '  web        http://localhost:3000\n'; fi
if [[ $KEEPER -eq 1 ]]; then printf '  keeper     polling every 2s (%s)\n' "$LOG_DIR/keeper.log"; fi
printf '  logs       %s\n' "$LOG_DIR"
printf '  runbook    docs/DEMO.md — run its beats IN ORDER; the numbers are sequence-dependent\n'
echo
printf '  stop with  ./scripts/stop.sh\n'
