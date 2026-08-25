#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")/../scripts" && pwd)/lib.sh"

echo "== wallet public config =="
cfg="$(api_json GET /api/public/wallet-config)"
assert_status "$cfg" 200
assert_contains "$cfg" '"factoryAddress"'
assert_contains "$cfg" '"implementationAddress"'
assert_contains "$cfg" '"chains"'
