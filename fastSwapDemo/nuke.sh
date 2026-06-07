#!/usr/bin/env bash
set -euo pipefail

DEMO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$DEMO_DIR/.." && pwd)"
STATE_DIR="$DEMO_DIR/state"
PORTS=(9545 9546 4010 4011 4012)

cd "$ROOT_DIR"

echo "[fastswap-demo:nuke] stopping demo services"
for port in "${PORTS[@]}"; do
  pids="$(lsof -ti ":$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "[fastswap-demo:nuke] SIGTERM port $port: $pids"
    kill -TERM $pids 2>/dev/null || true
  fi
done

sleep 1

for port in "${PORTS[@]}"; do
  pids="$(lsof -ti ":$port" 2>/dev/null || true)"
  if [[ -n "$pids" ]]; then
    echo "[fastswap-demo:nuke] SIGKILL port $port: $pids"
    kill -KILL $pids 2>/dev/null || true
  fi
done

# Clean up a parent demo process that may no longer hold a port after child nodes are killed.
pkill -TERM -f "demo-dist/fastSwapDemo/start.js" 2>/dev/null || true

echo "[fastswap-demo:nuke] removing demo DB, deployment, and progress state"
mkdir -p "$STATE_DIR"
rm -f \
  "$STATE_DIR/deployment.json" \
  "$STATE_DIR/relay-progress.json" \
  "$STATE_DIR/fastswap.sqlite" \
  "$STATE_DIR/fastswap.sqlite-shm" \
  "$STATE_DIR/fastswap.sqlite-wal" \
  "$STATE_DIR/sweep-node.sqlite" \
  "$STATE_DIR/sweep-node.sqlite-shm" \
  "$STATE_DIR/sweep-node.sqlite-wal"

echo "[fastswap-demo:nuke] rebuilding demo"
npm run fastswap:demo:build

echo "[fastswap-demo:nuke] starting demo"
exec npm run fastswap:demo
