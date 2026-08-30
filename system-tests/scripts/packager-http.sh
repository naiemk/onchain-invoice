#!/usr/bin/env bash
# Start HTTP servers for packager e2e (vibed-infra + product tctest dist).
# Sets PACKAGER_RAW, PACKAGECONFIG_URL, PRODUCT_RAW, RAW_BASE, PACKAGER_HTTP_PID, PRODUCT_HTTP_PID.
set -euo pipefail

packager_http_pick_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
}

packager_http_start() {
  local repo_root="$1"
  local vibed_root
  vibed_root="$(node "$repo_root/scripts/packager-root.mjs")"
  local packager_port product_port
  packager_port="$(packager_http_pick_port)"
  product_port="$(packager_http_pick_port)"
  (
    cd "$vibed_root"
    exec python3 -m http.server "$packager_port" --bind 127.0.0.1
  ) >/dev/null 2>&1 &
  PACKAGER_HTTP_PID=$!
  (
    cd "$repo_root"
    exec python3 -m http.server "$product_port" --bind 127.0.0.1
  ) >/dev/null 2>&1 &
  PRODUCT_HTTP_PID=$!
  for _ in $(seq 1 30); do
    if curl -fsS "http://127.0.0.1:${packager_port}/install.sh" >/dev/null 2>&1 \
      && curl -fsS "http://127.0.0.1:${product_port}/deploy/tctest/dist/packageconfig.yaml" >/dev/null 2>&1; then
      break
    fi
    sleep 0.2
  done
  PACKAGER_RAW="http://127.0.0.1:${packager_port}"
  PACKAGECONFIG_URL="http://127.0.0.1:${product_port}/deploy/tctest/dist/packageconfig.yaml"
  PRODUCT_RAW="http://127.0.0.1:${product_port}/deploy/tctest/dist"
  RAW_BASE="http://127.0.0.1:${product_port}/deploy/tctest/dist"
  export PACKAGER_RAW PACKAGECONFIG_URL PRODUCT_RAW RAW_BASE PACKAGER_HTTP_PID PRODUCT_HTTP_PID
}

packager_http_stop() {
  if [[ -n "${PACKAGER_HTTP_PID:-}" ]]; then
    kill "$PACKAGER_HTTP_PID" >/dev/null 2>&1 || true
    wait "$PACKAGER_HTTP_PID" 2>/dev/null || true
  fi
  if [[ -n "${PRODUCT_HTTP_PID:-}" ]]; then
    kill "$PRODUCT_HTTP_PID" >/dev/null 2>&1 || true
    wait "$PRODUCT_HTTP_PID" 2>/dev/null || true
  fi
}
