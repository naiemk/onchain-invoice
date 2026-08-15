#!/usr/bin/env bash
# Stop local-testnet processes started by start.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PIDS="$DIR/pids"

stop_one() {
  local name="$1"
  local file="$PIDS/${name}.pid"
  if [[ -f "$file" ]]; then
    local pid
    pid="$(cat "$file")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping $name (pid $pid)…"
      kill "$pid" 2>/dev/null || true
      # also stop child npm/vite if present
      pkill -P "$pid" 2>/dev/null || true
    fi
    rm -f "$file"
  fi
}

stop_one api
stop_one ui
stop_one sweeper-evm
stop_one sweeper-tron
stop_one sweeper-solana

# Belt-and-suspenders for vite/node leftovers on known ports
fuser -k 8080/tcp 2>/dev/null || true
fuser -k 5173/tcp 2>/dev/null || true

echo "Local testnet stack stopped."
