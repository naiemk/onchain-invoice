#!/usr/bin/env bash
# Start local Trustless Commerce testnet stack: API + UI + EVM (Sepolia) + Tron (Nile) sweepers.
# Solana is off by default (ENABLE_SOLANA=1 to include).
# Usage (from repo root):
#   bash local-testnet/start.sh
# Stop:
#   bash local-testnet/stop.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="$ROOT/local-testnet"
cd "$ROOT"

if [[ ! -f "$DIR/.env" ]]; then
  echo "Missing $DIR/.env — regenerate from repo .env first." >&2
  exit 1
fi

# Load local stack env (does not override already-exported vars).
set -a
# shellcheck disable=SC1091
source "$DIR/.env"
set +a

# Also pull fresh secrets from root .env when present (keys / RPC), without printing them.
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
  # Re-apply local-testnet overrides that must win over root .env
  set -a
  # shellcheck disable=SC1091
  source "$DIR/.env"
  set +a
fi

mkdir -p "$DIR/logs" "$DIR/pids"

echo "Building package + commerce…"
npm run build >/dev/null
test -d node_modules/vite || npm install >/dev/null

echo "Starting commerce API on :8080…"
# Drop a leftover listener so a rebuild is actually served (stale Node keeps old routes).
fuser -k 8080/tcp 2>/dev/null || true
sleep 0.2
nohup env CONFIG_PATH="$DIR/server.yaml" DB_PATH="$DIR/trustless-commerce.db" \
  node commerce-dist/server/index.js \
  >"$DIR/logs/api.log" 2>&1 &
echo $! >"$DIR/pids/api.pid"

for i in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done
curl -fsS http://127.0.0.1:8080/api/health
echo

SWEEPER_CHAINS="${SWEEPER_CHAINS:-11155111,nile}"
echo "Registering sweeper wallet ${SWEEPER_REGISTER_ADDRESS} for ${SWEEPER_CHAINS}…"
CHAINS_JSON=$(python3 - <<'PY'
import os, json
print(json.dumps([c.strip() for c in os.environ.get("SWEEPER_CHAINS","11155111,nile").split(",") if c.strip()]))
PY
)
curl -fsS -X POST http://127.0.0.1:8080/api/admin/sweepers \
  -H "content-type: application/json" \
  -H "x-api-key: ${ADMIN_API_KEY}" \
  -d "{\"address\":\"${SWEEPER_REGISTER_ADDRESS}\",\"label\":\"local-dev\",\"chains\":${CHAINS_JSON},\"enabled\":true}"
echo

start_sweeper() {
  local role="$1"
  local log="$DIR/logs/sweeper-${role}.log"
  local activity="$DIR/logs/activity-${role}.jsonl"
  echo "Starting sweeper role=${role}…"
  nohup env \
    SWEEPER_ROLE="$role" \
    SWEEPER_CONFIG="$DIR/sweeper.yaml" \
    ACTIVITY_LOG_PATH="$activity" \
    SERVER_URL="http://127.0.0.1:8080" \
    node commerce-dist/sweeper/index.js \
    >"$log" 2>&1 &
  echo $! >"$DIR/pids/sweeper-${role}.pid"
}

start_sweeper evm
start_sweeper tron
if [[ "${ENABLE_SOLANA:-0}" == "1" ]]; then
  start_sweeper solana
fi

echo "Starting UI on :5173…"
nohup npm run ui >"$DIR/logs/ui.log" 2>&1 &
echo $! >"$DIR/pids/ui.pid"

sleep 1
echo
echo "Local testnet stack is up:"
echo "  API      http://127.0.0.1:8080/api/health"
echo "  UI       http://127.0.0.1:5173  (proxies /api → API)"
echo "  Sweepers evm (Sepolia) + tron (Nile)"
echo "  Logs     local-testnet/logs/"
echo "  Stop     bash local-testnet/stop.sh"
echo
echo "Notes:"
echo "  - Uses public Sepolia + Nile RPCs (not local chain nodes)."
echo "  - Tron sponsor needs staked ENERGY/BANDWIDTH for Nile sweeps."
echo "  - Solana off (ENABLE_SOLANA=1 to add)."
