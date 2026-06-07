#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ ! -f "demo-dist/fastSwapDemo/pay.js" ]]; then
  npm run fastswap:demo:build >/dev/null
fi

node demo-dist/fastSwapDemo/pay.js "$@"
