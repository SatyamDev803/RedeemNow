#!/usr/bin/env bash
#
# Tear the RedeemNow dev stack down: web, keeper, Anvil.
#
#   ./scripts/stop.sh              stop everything
#   ./scripts/stop.sh --chain-only stop only Anvil (used by start.sh --fresh)
#   ./scripts/stop.sh --keep-chain stop web and keeper, leave the chain and its state running
#
# Stopping Anvil DESTROYS the chain state — deployed contracts, receivables, the LP book, all of it.
# That is normally what you want between sessions, but it means the next start.sh redeploys from
# scratch, so any demo figures you captured from the old chain no longer apply.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RUN_DIR="$ROOT/.devstack"

CHAIN=1 SERVICES=1
for arg in "$@"; do
  case "$arg" in
    --chain-only) SERVICES=0 ;;
    --keep-chain) CHAIN=0 ;;
    -h|--help)    sed -n '2,11p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *)            echo "unknown option: $arg (try --help)" >&2; exit 2 ;;
  esac
done

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
note() { printf '    %s\n' "$*"; }

# Stop a process politely, then insist. A Next dev server ignoring SIGTERM and holding port 3000 is
# the single most common reason the next start.sh "works" but serves stale code.
stop_pid() {
  local pid="$1" label="$2"
  kill -0 "$pid" 2>/dev/null || return 1
  kill "$pid" 2>/dev/null
  for _ in $(seq 20); do
    kill -0 "$pid" 2>/dev/null || { note "stopped $label (pid $pid)"; return 0; }
    sleep 0.25
  done
  kill -9 "$pid" 2>/dev/null
  note "force-killed $label (pid $pid)"
}

stop_recorded() {
  local name="$1" f="$RUN_DIR/$1.pid"
  [[ -f "$f" ]] || return 1
  local pid; pid="$(cat "$f")"
  stop_pid "$pid" "$name"
  local rc=$?
  rm -f "$f"
  return $rc
}

# The PID file only knows the process start.sh launched. A dev server started by hand, or a child
# that outlived its parent, still holds the port — so always sweep the port as well.
stop_port() {
  local port="$1" label="$2"
  for pid in $(lsof -ti:"$port" 2>/dev/null); do
    stop_pid "$pid" "$label on port $port"
  done
}

if [[ $SERVICES -eq 1 ]]; then
  say "stopping web"
  stop_recorded web || true
  stop_port 3000 "web"

  say "stopping keeper"
  stop_recorded keeper || true
  # The keeper runs under tsx, so pnpm's wrapper may exit while the node child keeps polling.
  pkill -f 'tsx src/index.ts' 2>/dev/null && note "stopped stray keeper (tsx)" || true
fi

if [[ $CHAIN -eq 1 ]]; then
  say "stopping Anvil — this destroys the chain state"
  stop_recorded anvil || true
  stop_port 8545 "anvil"
fi

echo
say "remaining listeners"
for p in 3000 8545; do
  if [[ -n "$(lsof -ti:"$p" 2>/dev/null)" ]]; then
    printf '    port %-5s STILL IN USE by pid %s\n' "$p" "$(lsof -ti:"$p" | tr '\n' ' ')"
  else
    printf '    port %-5s free\n' "$p"
  fi
done
