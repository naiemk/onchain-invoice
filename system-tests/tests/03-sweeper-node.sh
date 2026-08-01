#!/usr/bin/env bash
set -euo pipefail
# shellcheck disable=SC1091
source "$(cd "$(dirname "$0")/../scripts" && pwd)/lib.sh"

signed_sweeper() {
  local path="$1"
  "${COMPOSE[@]}" exec -T \
    -e T_PATH="$path" \
    -e SWEEPER_WALLET_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" \
    sweeper node -e '
const { Wallet } = require("ethers");
const { createHash, randomUUID } = require("crypto");
const path = process.env.T_PATH;
const wallet = new Wallet(process.env.SWEEPER_WALLET_KEY);
const method = "GET";
const body = "";
const bodyHash = createHash("sha256").update(body).digest("hex");
const timestamp = String(Date.now());
const nonce = randomUUID();
const message = [
  "Trustless Commerce sweeper request",
  "Method: " + method,
  "Path: " + path,
  "Body-SHA256: " + bodyHash,
  "Timestamp: " + timestamp,
  "Nonce: " + nonce,
].join("\n");
wallet.signMessage(message).then((signature) =>
  fetch("http://api:8080" + path, {
    method,
    headers: {
      "x-sweeper-address": wallet.address,
      "x-sweeper-timestamp": timestamp,
      "x-sweeper-nonce": nonce,
      "x-sweeper-signature": signature,
      "x-sweeper-body-hash": bodyHash,
    },
  }).then(async (res) => {
    process.stdout.write(JSON.stringify({ status: res.status, body: await res.text(), address: wallet.address }));
  })
).then(() => process.exit(0)).catch((e) => { console.error(String(e)); process.exit(1); });
'
}

echo "== register sweeper wallet =="
reg_body=$(printf '%s' "{\"address\":\"$SWEEPER_ADDR\",\"label\":\"system-test\",\"chains\":[\"11155111\"],\"enabled\":true}")
reg="$(api_json POST /api/admin/sweepers "$reg_body" "{\"x-api-key\":\"${ADMIN_API_KEY}\"}")"
assert_status "$reg" 201
assert_contains_ci "$reg" "$SWEEPER_ADDR"

echo "== wait for signed /api/sweeper/me =="
me_ok=0
for _ in $(seq 1 30); do
  me="$(signed_sweeper /api/sweeper/me || true)"
  if [[ "$me" == *'"status":200'* ]]; then
    me_ok=1
    break
  fi
  sleep 2
done
if [[ "$me_ok" -ne 1 ]]; then
  echo "sweeper /me failed; last=$me" >&2
  "${COMPOSE[@]}" logs --tail=50 sweeper >&2 || true
  exit 1
fi
echo "sweeper auth OK"

echo "== create invoice for sweeper list =="
CLIENT_ID="sweep-$(date +%s)-$$"
BODY=$(printf '%s' "{\"price\":\"2.00\",\"to\":[\"$MERCHANT\"],\"chains\":[\"11155111\"],\"tokens\":[\"USDC\"],\"clientInvoiceId\":\"$CLIENT_ID\",\"chainId\":\"11155111\",\"token\":\"USDC\",\"selectedTo\":\"$MERCHANT\",\"title\":\"Sweeper list test\"}")
created="$(api_json POST /api/invoices "$BODY")"
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d["status"] in (200,201), d' "$created"
invoice_id="$(python3 -c 'import json,sys; print(json.loads(json.loads(sys.argv[1])["body"])["invoice"]["id"])' "$created")"

echo "== sweeper lists invoice =="
listed=0
for _ in $(seq 1 20); do
  out="$(signed_sweeper /api/sweeper/invoices || true)"
  if [[ "$out" == *"$invoice_id"* ]] && [[ "$out" == *'"status":200'* ]]; then
    listed=1
    break
  fi
  sleep 2
done
if [[ "$listed" -ne 1 ]]; then
  echo "sweeper did not list invoice $invoice_id; last=$out" >&2
  exit 1
fi
echo "sweeper listed invoice $invoice_id"
