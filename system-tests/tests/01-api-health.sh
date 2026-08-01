#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")/../scripts" && pwd)/lib.sh"

echo "== health =="
health="$(api_json GET /api/health)"
assert_status "$health" 200
assert_body_ok "$health"

echo "== ready =="
ready="$(api_json GET /api/ready)"
assert_status "$ready" 200
assert_body_ok "$ready"

echo "== admin stats requires key =="
denied="$(api_json GET /api/admin/stats)"
assert_status "$denied" 401

echo "== admin stats with key =="
ok=""
for _ in 1 2 3; do
  ok="$(api_json GET /api/admin/stats "" "{\"x-api-key\":\"${ADMIN_API_KEY}\"}" || true)"
  [[ -n "$ok" ]] && break
  sleep 1
done
assert_status "$ok" 200
assert_contains "$ok" 'inFlight'
