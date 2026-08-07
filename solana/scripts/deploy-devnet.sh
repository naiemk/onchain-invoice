#!/usr/bin/env bash
# Build + deploy commerce-invoice to Solana Devnet and initialize config PDA.
#
# Usage (from repo root):
#   export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
#   SOLANA_SWEEPER_KEY='[182,...]'   # JSON byte array (or path to keypair json)
#   npm run solana:deploy:devnet
#
# Writes: solana/data/commerce-deploy-devnet.json
set -euo pipefail

export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH:-}"

SOLANA_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$SOLANA_ROOT/.." && pwd)"
cd "$REPO_ROOT"

RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
PROGRAM_KEYPAIR="${SOLANA_PROGRAM_KEYPAIR:-$SOLANA_ROOT/deploy/commerce_invoice-keypair.json}"
ARTIFACT="$SOLANA_ROOT/data/commerce-deploy-devnet.json"
FEE_BPS="${SOLANA_FEE_BPS:-50}"

mkdir -p "$SOLANA_ROOT/target/deploy" "$SOLANA_ROOT/data"
cp -f "$PROGRAM_KEYPAIR" "$SOLANA_ROOT/target/deploy/commerce_invoice-keypair.json"

if [[ ! -f "$SOLANA_ROOT/target/deploy/commerce_invoice.so" ]]; then
  echo "Building commerce-invoice …"
  (cd "$SOLANA_ROOT/programs/commerce-invoice" && cargo-build-sbf)
fi

PROGRAM_ID="$(solana-keygen pubkey "$PROGRAM_KEYPAIR")"
echo "programId=$PROGRAM_ID"
echo "rpc=$RPC_URL"

AUTH_FILE="${SOLANA_AUTHORITY_KEYPAIR:-$SOLANA_ROOT/data/devnet-authority.json}"
if [[ -n "${SOLANA_SWEEPER_KEY:-}" ]]; then
  if [[ "${SOLANA_SWEEPER_KEY}" == \[* ]]; then
    printf '%s\n' "$SOLANA_SWEEPER_KEY" >"$AUTH_FILE"
  elif [[ -f "${SOLANA_SWEEPER_KEY}" ]]; then
    cp -f "$SOLANA_SWEEPER_KEY" "$AUTH_FILE"
  else
    echo "SOLANA_SWEEPER_KEY must be a JSON byte array or a keypair file path" >&2
    exit 1
  fi
elif [[ ! -f "$AUTH_FILE" ]]; then
  solana-keygen new --no-bip39-passphrase --silent -o "$AUTH_FILE"
  echo "Created authority keypair: $AUTH_FILE"
fi

AUTHORITY="$(solana-keygen pubkey "$AUTH_FILE")"
FEE_RECIPIENT="${SOLANA_FEE_RECIPIENT:-$AUTHORITY}"
echo "authority=$AUTHORITY"
echo "feeRecipient=$FEE_RECIPIENT"

solana config set --url "$RPC_URL" --keypair "$AUTH_FILE" >/dev/null

BAL="$(solana balance "$AUTHORITY" --url "$RPC_URL" 2>/dev/null | awk '{print $1}' || echo 0)"
echo "balance=${BAL:-0} SOL"
if ! python3 -c "raise SystemExit(0 if float('${BAL:-0}' or '0') >= 2.0 else 1)"; then
  echo "Requesting Devnet airdrops for $AUTHORITY …"
  for _ in 1 2 3 4 5 6; do
    if solana airdrop 2 "$AUTHORITY" --url "$RPC_URL"; then
      break
    fi
    sleep 4
  done
  BAL="$(solana balance "$AUTHORITY" --url "$RPC_URL" 2>/dev/null | awk '{print $1}' || echo 0)"
  echo "balance=${BAL:-0} SOL"
  if ! python3 -c "raise SystemExit(0 if float('${BAL:-0}' or '0') >= 2.0 else 1)"; then
    cat <<HINT >&2

Devnet faucet rate-limited or dry. Fund $AUTHORITY with ~2 SOL, then re-run:
  https://faucet.solana.com
  solana airdrop 2 $AUTHORITY --url $RPC_URL
  npm run solana:deploy:devnet

HINT
    exit 1
  fi
fi

echo "Deploying program …"
solana program deploy \
  --url "$RPC_URL" \
  --keypair "$AUTH_FILE" \
  --program-id "$PROGRAM_KEYPAIR" \
  "$SOLANA_ROOT/target/deploy/commerce_invoice.so"

echo "Initializing config PDA (skip if already exists) …"
export SOLANA_RPC_URL="$RPC_URL"
export SOLANA_PROGRAM_ID="$PROGRAM_ID"
export SOLANA_AUTHORITY_KEYPAIR="$AUTH_FILE"
export SOLANA_FEE_RECIPIENT="$FEE_RECIPIENT"
export SOLANA_FEE_BPS="$FEE_BPS"
export SOLANA_DEPLOY_ARTIFACT="$ARTIFACT"

npx hardhat run solana/scripts/initialize-devnet.ts --network hardhat

echo ""
echo "Devnet deploy complete."
echo "  programId=$PROGRAM_ID"
echo "  authority=$AUTHORITY"
echo "  artifact=$ARTIFACT"
echo "Set on API + nodes .env:"
echo "  SOLANA_PROGRAM_ID=$PROGRAM_ID"
echo "  SOLANA_SWEEPER_KEY=<contents of $AUTH_FILE>"
echo "  SOLANA_FEE_RECIPIENT=$FEE_RECIPIENT"
