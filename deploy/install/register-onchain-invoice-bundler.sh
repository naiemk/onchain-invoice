#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib-env.sh
source "$ROOT/lib-env.sh"
load_nodes_env

ADMIN_KEY="${ADMIN_API_KEY:-}"
BUNDLER_ADDR="${BUNDLER_REGISTER_ADDRESS:-${BUNDLER_ADDRESS:-}}"
SERVER="${SERVER_URL:-${API_URL:-http://host.docker.internal:8080}}"

if [[ -z "$ADMIN_KEY" || -z "$BUNDLER_ADDR" ]]; then
  echo "Set ADMIN_API_KEY and BUNDLER_ADDRESS (or BUNDLER_REGISTER_ADDRESS) in .env" >&2
  exit 1
fi

curl -fsS -X POST "${SERVER%/}/api/admin/bundlers" \
  -H "x-api-key: $ADMIN_KEY" \
  -H "content-type: application/json" \
  -d "{\"address\":\"$BUNDLER_ADDR\",\"label\":\"bundler-evm\",\"chains\":[\"${WALLET_CHAIN_ID:-11155111}\"]}"

echo "Registered bundler $BUNDLER_ADDR"
