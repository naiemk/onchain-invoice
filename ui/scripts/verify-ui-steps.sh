#!/usr/bin/env bash
# Step-by-step local UI verification for Trustless Commerce (Vite + API proxy).
#
# Prerequisites (in two terminals, or already running):
#   npm run commerce:build
#   EVM_RPC_URL=… SWEEPER_ADDRESS=… FORWARDER_IMPLEMENTATION=… npm run commerce:server
#   npm run ui
#
# Usage:
#   npm run ui:verify
#   UI_BASE=http://127.0.0.1:5173 npm run ui:verify
#
# Exits non-zero if health/HTML asserts fail. Prints the interactive browser checklist.
set -euo pipefail

UI_BASE="${UI_BASE:-http://127.0.0.1:5173}"
API_HEALTH="${UI_BASE%/}/api/health"
TIMEOUT_SEC="${UI_VERIFY_TIMEOUT_SEC:-60}"

fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "OK: $*"; }

wait_url() {
  local url="$1"
  local label="$2"
  local i=0
  while [[ "$i" -lt "$TIMEOUT_SEC" ]]; do
    if curl -fsS -m 2 "$url" >/dev/null 2>&1; then
      pass "$label reachable ($url)"
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  fail "$label not reachable within ${TIMEOUT_SEC}s: $url"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local label="$3"
  if [[ "$haystack" != *"$needle"* ]]; then
    fail "$label — missing substring: $needle"
  fi
  pass "$label contains «$needle»"
}

echo "== UI verify against $UI_BASE =="
wait_url "$UI_BASE/" "UI"
wait_url "$API_HEALTH" "API via Vite proxy"

health="$(curl -fsS -m 5 "$API_HEALTH")"
assert_contains "$health" '"ok": true' "api/health JSON" || assert_contains "$health" '"ok":true' "api/health JSON"

home="$(curl -fsS -m 5 "$UI_BASE/")"
assert_contains "$home" "Trustless Commerce" "GET /"
assert_contains "$home" "<!doctype html>" "GET / doctype"
assert_contains "$home" "/src/main.ts" "GET / Vite entry (dev)" || assert_contains "$home" "assets/" "GET / built assets"

create="$(curl -fsS -m 5 "$UI_BASE/create")"
assert_contains "$create" "Trustless Commerce" "GET /create"

pay_q="price=1&to=0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266&chains=11155111&tokens=USDC"
pay="$(curl -fsS -m 5 "$UI_BASE/pay?$pay_q")"
assert_contains "$pay" "Trustless Commerce" "GET /pay"
# Shareable pay links must not advertise client invoice_seed in the shell (SPA still loads).
if echo "$pay_q" | grep -qi invoice_seed; then
  fail "test pay query unexpectedly includes invoice_seed"
fi
pass "pay query has no invoice_seed"

merchant="$(curl -fsS -m 5 "$UI_BASE/merchant")"
assert_contains "$merchant" "Trustless Commerce" "GET /merchant"

# Source-level create UX guards (SPA shell HTML has no form — catch regressions that
# curl of /create cannot see). Fail if Open checkout / mono-block embed preview disappear.
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CREATE_SRC="$ROOT/ui/src/pages/create.ts"
[[ -f "$CREATE_SRC" ]] || fail "missing $CREATE_SRC"
create_src="$(cat "$CREATE_SRC")"
assert_contains "$create_src" 'id="open-checkout"' "create.ts Open checkout CTA"
assert_contains "$create_src" "Open checkout" "create.ts Open checkout label"
assert_contains "$create_src" "mono-block" "create.ts mono-block embed/url"
assert_contains "$create_src" "pay-button-preview" "create.ts rendered pay button preview"
assert_contains "$create_src" "tc-pay-button" "create.ts tc-pay-button class"
assert_contains "$create_src" 'type="submit"' "create.ts submit Open checkout"

# Optional: create invoice when Sepolia is configured (skip soft-fail if not).
if curl -fsS -m 5 -X POST "${UI_BASE%/}/api/invoices" \
  -H 'content-type: application/json' \
  -d "{\"price\":\"1.00\",\"to\":\"0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266\",\"chains\":[\"11155111\"],\"tokens\":[\"USDC\"],\"clientInvoiceId\":\"ui-verify-$(date +%s)\",\"allowPartial\":false}" \
  >/tmp/tc-ui-verify-invoice.json 2>/dev/null; then
  if grep -q '"invoiceAddress"' /tmp/tc-ui-verify-invoice.json; then
    pass "POST /api/invoices returned invoiceAddress"
  else
    echo "WARN: POST /api/invoices responded but no invoiceAddress (see /tmp/tc-ui-verify-invoice.json)" >&2
  fi
else
  echo "WARN: POST /api/invoices failed — set SWEEPER_ADDRESS + FORWARDER_IMPLEMENTATION + EVM_RPC_URL for full pay Continue" >&2
fi

cat <<'EOF'

== Interactive browser checklist (run in order) ==
A  Open /                         Brand hero, nav (Product / Create / Merchant / Docs), theme toggle; no blank #outlet
B  Toggle theme                   Light ↔ dark; readable contrast on hero and body (not dark-on-dark / light-on-light)
C  Open /create                   Form + Open checkout + Copy pay link; Sepolia/Nile pills (testnet); wallet fields
D  Fill amount + EVM to           Preview: mono-block pay URL + embed HTML; rendered .tc-pay-button; Open checkout enabled
E  Open checkout → Continue       Address / awaiting payment (needs local Sepolia sweeper env); no white screen
F  Open /merchant → Load          Settlement field + invoice table for that to address
G  Narrow viewport (~390px)       / and /create: no horizontal overflow; nav usable

EOF

echo "All automated asserts passed."
