#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")/../scripts" && pwd)/lib.sh"

echo "== wallet counterfactual account =="
cfg="$(api_json GET /api/public/wallet-config)"
if ! echo "$cfg" | grep -q '"factoryAddress":null' && echo "$cfg" | grep -q '"factoryAddress"'; then
  :
else
  echo "wallet factory not configured — skip account test"
  exit 0
fi

QX="0x00000000000000000000000000000000000000000000000000000000000000aa"
QY="0x00000000000000000000000000000000000000000000000000000000000000bb"
body="{\"ownerQx\":\"${QX}\",\"ownerQy\":\"${QY}\",\"credentialId\":\"e2e-test\"}"
created="$(api_json POST /api/wallet/accounts "$body")"
assert_status "$created" 201
assert_contains "$created" '"address"'

addr="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1].split("\n",1)[1])["account"]["address"])' "$created")"
bal="$(api_json GET "/api/wallet/balance?wallet=${addr}")"
assert_status "$bal" 200
assert_contains "$bal" '"chains"'
