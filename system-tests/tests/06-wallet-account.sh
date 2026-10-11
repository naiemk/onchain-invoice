#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")/../scripts" && pwd)/lib.sh"

echo "== wallet counterfactual account =="

# Public passkey registration is closed. Wallets are created for an identity.
retired="$(api_json POST /api/wallet/accounts '{"ownerQx":"0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","ownerQy":"0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","credentialId":"retired-e2e"}')"
assert_status "$retired" 410
assert_body_field "$retired" 'b.get("error") == "use_identity"'

cfg="$(api_json GET /api/public/wallet-config)"
assert_status "$cfg" 200
if ! python3 -c 'import json,sys; d=json.loads(sys.argv[1]); b=json.loads(d["body"]); raise SystemExit(0 if b.get("factoryAddress") and b.get("implementationAddress") else 1)' "$cfg"; then
  echo "wallet factory not configured — skip account test"
  exit 0
fi

created="$(create_identity_wallet account)"
addr="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["address"])' "$created")"
cookie="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["cookie"])' "$created")"
cred="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["credentialId"])' "$created")"
identity="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["identityId"])' "$created")"

stored="$(api_json GET "/api/wallet/accounts/${addr}")"
assert_status "$stored" 200
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); b=json.loads(d["body"]); a=b.get("account") or {}; assert a.get("address","").lower()==sys.argv[2].lower(), b; assert (a.get("identityId") or "").lower()==sys.argv[3].lower(), b' "$stored" "$addr" "$identity"

bal="$(api_json GET "/api/wallet/balance?wallet=${addr}")"
assert_status "$bal" 200
assert_contains "$bal" 'chains'
assert_body_field "$bal" 'isinstance(b.get("chains"), list)'

login="$(api_json POST /api/identity/passkey/login "{\"credentialId\":\"${cred}\"}")"
assert_status "$login" 200
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); b=json.loads(d["body"]); addrs=[w.get("address","").lower() for w in b.get("wallets") or []]; assert sys.argv[2].lower() in addrs, b' "$login" "$addr"

headers="$(python3 -c 'import json,sys; print(json.dumps({"cookie": sys.argv[1]}))' "$cookie")"
second="$(api_json POST /api/identity/wallets '{"label":"Spare"}' "$headers")"
assert_status "$second" 201
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); b=json.loads(d["body"]); a=(b.get("account") or {}).get("address") or ""; assert a and a.lower()!=sys.argv[2].lower(), b' "$second" "$addr"
