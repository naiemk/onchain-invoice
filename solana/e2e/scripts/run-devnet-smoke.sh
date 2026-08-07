#!/usr/bin/env bash
# Live Devnet smoke: airdrop → (deploy if needed) → create mint → pay → settle.
# Uses SOLANA_SWEEPER_KEY (JSON byte array) or solana/data/devnet-authority.json.
# Does NOT commit secrets. Circle USDC is not required — mints a throwaway SPL token.
set -euo pipefail

export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH:-}"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$REPO_ROOT"

export SOLANA_RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"

if [[ -z "${SOLANA_PROGRAM_ID:-}" && -f solana/data/commerce-deploy-devnet.json ]]; then
  SOLANA_PROGRAM_ID="$(python3 -c 'import json; print(json.load(open("solana/data/commerce-deploy-devnet.json"))["programId"])')"
  export SOLANA_PROGRAM_ID
fi

if [[ -z "${SOLANA_PROGRAM_ID:-}" || "${SOLANA_DEPLOY:-1}" == "1" ]]; then
  echo "== ensure Devnet program deploy =="
  bash solana/scripts/deploy-devnet.sh
  SOLANA_PROGRAM_ID="$(python3 -c 'import json; print(json.load(open("solana/data/commerce-deploy-devnet.json"))["programId"])')"
  export SOLANA_PROGRAM_ID
fi

echo "== Devnet settle smoke (program=$SOLANA_PROGRAM_ID) =="
npx hardhat test solana/e2e/SolanaDevnetSmoke.ts
echo "SOLANA DEVNET SMOKE OK"
