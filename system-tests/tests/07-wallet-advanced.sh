#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")/../scripts" && pwd)/lib.sh"

echo "== wallet advanced config + API smoke =="
cfg="$(api_json GET /api/public/wallet-config)"
assert_status "$cfg" 200
assert_contains "$cfg" 'advancedWalletAbi'
assert_body_field "$cfg" 'isinstance(b.get("advancedWalletAbi"), list) and len(b["advancedWalletAbi"]) > 0'

EXPECTED_FACTORY="${WALLET_FACTORY_ADDRESS:-0x06964dE197ed29A4DC2D34F68aD4510Afa25f537}"
factory="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(json.loads(d["body"]).get("factoryAddress") or "")' "$cfg")"
if [[ -z "$factory" ]]; then
  echo "wallet factory not configured — skip advanced smoke"
  exit 0
fi
factory_lc="$(printf '%s' "$factory" | tr '[:upper:]' '[:lower:]')"
expected_lc="$(printf '%s' "$EXPECTED_FACTORY" | tr '[:upper:]' '[:lower:]')"
if [[ "$factory_lc" != "$expected_lc" ]]; then
  echo "factory mismatch (got $factory, expected $EXPECTED_FACTORY) — skip advanced proposal smoke"
  exit 0
fi

QX="0x00000000000000000000000000000000000000000000000000000000000000aa"
QY="0x00000000000000000000000000000000000000000000000000000000000000bb"
body="{\"ownerQx\":\"${QX}\",\"ownerQy\":\"${QY}\",\"credentialId\":\"advanced-e2e\"}"
created="$(api_json POST /api/wallet/accounts "$body")"
assert_status "$created" 201
addr="$(python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(json.loads(d["body"])["account"]["address"])' "$created")"

policy="$(api_json GET "/api/wallet/${addr}/advanced-policy")"
# Undeployed counterfactual may 400/503 — both acceptable for smoke.
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); s=d["status"]; sys.exit(0 if s in (200,400,503) else 1)' "$policy"

entities="$(api_json GET "/api/wallet/${addr}/entities")"
assert_status "$entities" 200
assert_body_field "$entities" 'isinstance(b.get("entities"), list) and isinstance(b.get("keys"), list)'

entity_id="0x$(printf 'cc%.0s' {1..32})"
reg="$(api_json POST "/api/wallet/${addr}/entities" "{\"entityId\":\"${entity_id}\",\"label\":\"e2e\"}")"
assert_status "$reg" 200

FEE_TOKEN="0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238"
proposal_body="{\"chainId\":\"11155111\",\"target\":\"${FEE_TOKEN}\",\"value\":\"0\",\"data\":\"0x\"}"
prop="$(api_json POST "/api/wallet/${addr}/proposals" "$proposal_body")"
assert_status "$prop" 201
assert_body_field "$prop" 'b.get("proposal", {}).get("status") == "draft"'

echo "advanced wallet API smoke OK"
