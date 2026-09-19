# RedeemNow contracts

Instant NAV-priced exits for tokenized RWAs. See `docs/superpowers/specs/2026-09-18-redeemnow-design.md`.

## Setup
    foundryup
    forge install OpenZeppelin/openzeppelin-contracts --no-git
    cp .env.example .env

## Test (one file at a time)
    forge test --match-path test/RedemptionBridge.t.sol -vv

## Deploy
    set -a; source .env; set +a
    forge script script/Deploy.s.sol --rpc-url anvil --broadcast          # local
    forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast --slow

Addresses land in `deployments/<chainId>.json`.

## Contracts
| Contract | Role |
|---|---|
| RWARegistry | per-asset NAV, settlement window, eligibility, spread params; demo clock |
| LiquidityVault | ERC-4626 USDC pool; `advance` / `settleReceivable` for the bridge |
| RedemptionBridge | `quote`, `redeem`, `settle`; fee split to treasury |
| MockIssuer | holds redeemed tokens, pays NAV on settle |
| MockUSDC, MockRWAToken | demo tokens |
