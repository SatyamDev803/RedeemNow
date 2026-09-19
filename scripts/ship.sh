#!/usr/bin/env bash
#
# Ship to Monad testnet: deploy -> verify -> fill the README -> report.
#
#   ./scripts/ship.sh              deploy + verify + rewrite README links
#   ./scripts/ship.sh --verify-only   re-run verification against the existing deployment
#   ./scripts/ship.sh --dry-run    show what it would do, touch nothing
#
# It does NOT commit and does NOT push. Those stay manual.
#
# Prerequisite: contracts/.env must hold a funded Monad testnet key as PRIVATE_KEY.
# Fund it at https://faucet.monad.xyz first — a deploy with no gas is the single most common
# reason this fails at the last minute.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHAIN_ID=10143
RPC="https://testnet-rpc.monad.xyz"
SOURCIFY="https://sourcify-api-monad.blockvision.org/"   # trailing slash is required
EXPLORER="https://testnet.monadexplorer.com"
DEPLOYMENT="$ROOT/contracts/deployments/$CHAIN_ID.json"

VERIFY_ONLY=0 DRY=0
for a in "$@"; do
  case "$a" in
    --verify-only) VERIFY_ONLY=1 ;;
    --dry-run)     DRY=1 ;;
    -h|--help)     sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "unknown option: $a" >&2; exit 2 ;;
  esac
done

export PATH="$HOME/.foundry/bin:$PATH"
say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[33m warn\033[0m %s\n' "$*"; }
die()  { printf '\033[31mfatal\033[0m %s\n' "$*" >&2; exit 1; }

[[ -f "$ROOT/contracts/.env" ]] || die "contracts/.env missing"
# shellcheck disable=SC1091
set -a; source "$ROOT/contracts/.env"; set +a
# Deliberately a SEPARATE variable from PRIVATE_KEY. PRIVATE_KEY is Anvil's well-known public
# account, which is fine for local work and must never be what we broadcast to a public network.
# That address also carries dust on Monad testnet because everyone knows it, so a balance check
# alone would not have caught the mistake.
[[ -n "${MONAD_PRIVATE_KEY:-}" ]] || die "MONAD_PRIVATE_KEY not set in contracts/.env (fund it at https://faucet.monad.xyz)"
PRIVATE_KEY="$MONAD_PRIVATE_KEY"

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
BAL=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
say "deployer $DEPLOYER"
say "balance  $(cast --to-unit "$BAL" ether) MON"
# ~17.7M gas for the full deploy. Dust is not enough and fails half way through, leaving a
# partially wired system that is worse than no deploy at all.
MIN_WEI=100000000000000000   # 0.1 MON
if [[ "$(python3 -c "print(int('$BAL') < $MIN_WEI)")" == "True" ]]; then
  die "deployer has only $(cast --to-unit "$BAL" ether) MON; need at least 0.1. Fund $DEPLOYER at https://faucet.monad.xyz"
fi

if [[ $DRY -eq 1 ]]; then say "--dry-run: stopping before any transaction"; exit 0; fi

# ---------------------------------------------------------------- deploy
if [[ $VERIFY_ONLY -eq 0 ]]; then
  say "deploying to Monad testnet (chain $CHAIN_ID)"
  ( cd "$ROOT/contracts" && forge script script/Deploy.s.sol \
      --rpc-url "$RPC" --broadcast --private-key "$PRIVATE_KEY" --slow ) \
    || die "deploy failed"
  [[ -f "$DEPLOYMENT" ]] || die "deploy wrote no $DEPLOYMENT"
  ( cd "$ROOT" && pnpm --filter @redeemnow/shared sync )
fi

[[ -f "$DEPLOYMENT" ]] || die "no deployment at $DEPLOYMENT — run without --verify-only first"
g() { python3 -c "import json;print(json.load(open('$DEPLOYMENT'))['$1'])"; }

# ---------------------------------------------------------------- verify
# Each entry is "<json key>:<contract name>". Verification is what earns the
# "source published" credit, and it only works because foundry.toml sets
# bytecode_hash="none" / cbor_metadata=false / use_literal_content=true BEFORE the deploy.
say "verifying source on the explorer"
verify_one() {
  local key="$1" name="$2" path="$3" addr
  addr=$(g "$key") || return 0
  printf '    %-16s %s ' "$name" "$addr"
  if forge verify-contract "$addr" "$path:$name" \
       --chain "$CHAIN_ID" --verifier sourcify --verifier-url "$SOURCIFY" \
       >/tmp/verify-$name.log 2>&1; then
    printf '\033[32mok\033[0m\n'
  else
    printf '\033[33mfailed\033[0m (see /tmp/verify-%s.log)\n' "$name"
  fi
}
( cd "$ROOT/contracts"
  verify_one bridge   RedemptionBridge src/RedemptionBridge.sol
  verify_one vault    LiquidityVault   src/LiquidityVault.sol
  verify_one registry RWARegistry      src/RWARegistry.sol
  verify_one issuer   MockIssuer       src/MockIssuer.sol
  verify_one usdc     MockUSDC         src/MockUSDC.sol
)

# ---------------------------------------------------------------- README
say "filling README placeholders"
python3 - "$DEPLOYMENT" "$ROOT/README.md" <<'PY'
import json, sys, pathlib
dep = json.load(open(sys.argv[1])); p = pathlib.Path(sys.argv[2]); s = p.read_text()
for ph, key in (('BRIDGE_ADDRESS','bridge'), ('VAULT_ADDRESS','vault'), ('REGISTRY_ADDRESS','registry')):
    if key in dep:
        s = s.replace(ph, dep[key])
p.write_text(s)
print('  README addresses filled (LIVE_URL still needs the hosted URL)')
PY

# ---------------------------------------------------------------- summary
echo
say "shipped"
printf '  bridge    %s\n' "$(g bridge)"
printf '  vault     %s\n' "$(g vault)"
printf '  registry  %s\n' "$(g registry)"
printf '  explorer  %s/address/%s\n' "$EXPLORER" "$(g bridge)"
echo
printf '  Still to do by hand:\n'
printf '    1. put the hosted URL into README.md (replace LIVE_URL)\n'
printf '    2. seed the testnet book so the demo has liquidity\n'
printf '    3. commit and push to https://github.com/SatyamDev803/RedeemNow\n'
printf '    4. post — see docs/build-in-public.md\n'
