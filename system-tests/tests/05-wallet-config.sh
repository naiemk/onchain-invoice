#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")/../scripts" && pwd)/lib.sh"

echo "== wallet public config =="
cfg="$(api_json GET /api/public/wallet-config)"
assert_status "$cfg" 200
# api_json wraps the body as a JSON string, so match bare keys / use assert_body_field.
assert_contains "$cfg" 'factoryAddress'
assert_contains "$cfg" 'implementationAddress'
assert_contains "$cfg" 'chains'
assert_body_field "$cfg" 'b.get("factoryAddress") is not None'
assert_body_field "$cfg" 'b.get("implementationAddress") is not None'
assert_body_field "$cfg" 'isinstance(b.get("chains"), list) and len(b["chains"]) >= 1'
