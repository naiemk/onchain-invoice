#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")/../scripts" && pwd)/lib.sh"

CLIENT_ID="sys-$(date +%s)-$$"
BODY=$(printf '%s' "{\"price\":\"1.00\",\"to\":[\"$MERCHANT\"],\"chains\":[\"11155111\"],\"tokens\":[\"USDC\"],\"clientInvoiceId\":\"$CLIENT_ID\",\"chainId\":\"11155111\",\"token\":\"USDC\",\"selectedTo\":\"$MERCHANT\",\"title\":\"System test\"}")

echo "== create invoice =="
created="$(api_json POST /api/invoices "$BODY")"
# 201 on first create; 200 if a flaky retry already created the same deterministic id
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d["status"] in (200,201), d; b=json.loads(d["body"]); assert b.get("invoiceAddress") or (b.get("invoice") or {}).get("invoiceAddress"); assert (b.get("invoice") or {}).get("status")=="awaiting_payment"' "$created"
assert_contains "$created" 'invoiceAddress'
assert_contains "$created" 'awaiting_payment'

invoice_id="$(python3 -c 'import json,sys; print(json.loads(json.loads(sys.argv[1])["body"])["invoice"]["id"])' "$created")"
echo "invoice_id=$invoice_id"

echo "== get invoice =="
got="$(api_json GET "/api/invoices/$invoice_id")"
assert_status "$got" 200
assert_contains "$got" "$invoice_id"

echo "== idempotent recreate =="
sleep 1
again="$(api_json POST /api/invoices "$BODY")"
assert_status "$again" 200
assert_body_field "$again" 'b.get("created") is False'
assert_contains "$again" "$invoice_id"
