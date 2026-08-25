#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")/../scripts" && pwd)/lib.sh"

echo "== wallet counterfactual account =="
cfg="$(api_json GET /api/public/wallet-config)"
assert_status "$cfg" 200
if ! python3 -c 'import json,sys; d=json.loads(sys.argv[1]); b=json.loads(d["body"]); raise SystemExit(0 if b.get("factoryAddress") and b.get("implementationAddress") else 1)' "$cfg"; then
  echo "wallet factory not configured — skip account test"
  exit 0
fi

QX="0x00000000000000000000000000000000000000000000000000000000000000aa"
QY="0x00000000000000000000000000000000000000000000000000000000000000bb"
body="{\"ownerQx\":\"${QX}\",\"ownerQy\":\"${QY}\",\"credentialId\":\"e2e-test\"}"
created="$(api_json POST /api/wallet/accounts "$body")"
assert_status "$created" 201
assert_contains "$created" 'address'
assert_body_field "$created" 'isinstance(b.get("account"), dict) and b["account"].get("address")'

addr="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(json.loads(d["body"])["account"]["address"])' "$created")"
bal="$(api_json GET "/api/wallet/balance?wallet=${addr}")"
assert_status "$bal" 200
assert_contains "$bal" 'chains'
assert_body_field "$bal" 'isinstance(b.get("chains"), list)'
