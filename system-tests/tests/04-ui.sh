#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")/../scripts" && pwd)/lib.sh"

echo "== UI home =="
home="$(https_get /)"
assert_contains "$home" "Trustless Commerce"
assert_contains "$home" "<!doctype html>"

echo "== UI create =="
create="$(https_get /create)"
assert_contains "$create" "Trustless Commerce"

echo "== UI wallet =="
wallet="$(https_get /wallet)"
assert_contains "$wallet" "Trustless Commerce"

echo "== UI wallet create =="
wallet_create="$(https_get /wallet/create)"
assert_contains "$wallet_create" "Trustless Commerce"

echo "== UI pay route =="
pay="$(https_get "/pay?price=1&to=0xc2eCF8b48b9D5D1Fd04b8A9c15126011aa1cC3Eb&chains=11155111&tokens=USDC")"
assert_contains "$pay" "Trustless Commerce"

echo "== API health via network =="
health="$(api_json GET /api/health)"
assert_body_ok "$health"
