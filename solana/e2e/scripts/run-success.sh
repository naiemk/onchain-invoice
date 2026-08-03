#!/usr/bin/env bash
# Run Solana success e2e (program + SDK settle path).
set -euo pipefail
SOLANA_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
REPO_ROOT="$(cd "$SOLANA_ROOT/.." && pwd)"
cd "$REPO_ROOT"
export PATH="${HOME}/.local/share/solana/install/active_release/bin:${PATH:-}"

mkdir -p solana/target/deploy
if [[ -f solana/deploy/commerce_invoice-keypair.json ]]; then
  cp -n solana/deploy/commerce_invoice-keypair.json solana/target/deploy/commerce_invoice-keypair.json 2>/dev/null || \
    cp solana/deploy/commerce_invoice-keypair.json solana/target/deploy/commerce_invoice-keypair.json
fi

if [[ ! -f solana/target/deploy/commerce_invoice.so ]]; then
  echo "Building commerce-invoice program…"
  (cd solana/programs/commerce-invoice && cargo-build-sbf)
fi

pkill -f solana-test-validator >/dev/null 2>&1 || true
sleep 1

npx hardhat test solana/e2e/SolanaCommerceInvoice.ts
echo "SOLANA SUCCESS TESTS OK"
