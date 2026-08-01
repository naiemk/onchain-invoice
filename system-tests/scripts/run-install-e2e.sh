#!/usr/bin/env bash
# End-to-end: wget|bash installers → start scripts → API + sweeper assertions.
set -euo pipefail

ST_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ST_ROOT/.." && pwd)"
INSTALL_SRC="$REPO_ROOT/deploy/install"

# shellcheck disable=SC1091
source "$ST_ROOT/scripts/lib.sh"

IMAGE_TAG="${IMAGE_TAG:-main}"
API_IMAGE="ghcr.io/naiemk/trustless-commerce-api:${IMAGE_TAG}"
SWEEPER_IMAGE="ghcr.io/naiemk/trustless-commerce-sweeper:${IMAGE_TAG}"
API_CONTAINER="onchain-invoice-api"
NODE_CONTAINER="onchain-invoice-node"

ADMIN_API_KEY="${ADMIN_API_KEY:-system-test-admin}"
SWEEPER_API_KEY="${SWEEPER_API_KEY:-system-test-sweeper}"
SWEEPER_ADDRESS="${SWEEPER_ADDRESS:-0x1111111111111111111111111111111111111111}"
FORWARDER_IMPLEMENTATION="${FORWARDER_IMPLEMENTATION:-0x2222222222222222222222222222222222222222}"
SWEEPER_WALLET_KEY="${SWEEPER_WALLET_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
SWEEPER_PRIVATE_KEY="${SWEEPER_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
EVM_RPC_URL="${EVM_RPC_URL:-}"
MERCHANT="${MERCHANT:-0xc2eCF8b48b9D5D1Fd04b8A9c15126011aa1cC3Eb}"
SWEEPER_ADDR="${SWEEPER_ADDR:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"

INSTALL_DIR="$(mktemp -d "${TMPDIR:-/tmp}/onchain-invoice-install-e2e.XXXXXX")"
HTTP_PID=""

# Local HTTP server so wget|bash matches the operator path (wget has no file://).
pick_port() {
  python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()'
}
HTTP_PORT="$(pick_port)"
RAW_BASE="http://127.0.0.1:${HTTP_PORT}"

cleanup_install() {
  if [[ -n "$HTTP_PID" ]]; then
    kill "$HTTP_PID" >/dev/null 2>&1 || true
    wait "$HTTP_PID" 2>/dev/null || true
  fi
  docker rm -f "$API_CONTAINER" "$NODE_CONTAINER" >/dev/null 2>&1 || true
  docker volume rm -f "${API_CONTAINER}-data" >/dev/null 2>&1 || true
  rm -rf "$INSTALL_DIR"
}
trap cleanup_install EXIT

echo "======== wget install e2e ========"
echo "INSTALL_DIR=$INSTALL_DIR"
echo "ONCHAIN_INVOICE_RAW=$RAW_BASE"
echo "IMAGE_TAG=$IMAGE_TAG"

(
  cd "$INSTALL_SRC"
  exec python3 -m http.server "$HTTP_PORT" --bind 127.0.0.1
) >/dev/null 2>&1 &
HTTP_PID=$!

for _ in $(seq 1 20); do
  if wget -qO- "${RAW_BASE}/install-api.sh" >/dev/null 2>&1; then
    break
  fi
  sleep 0.2
done

docker rm -f "$API_CONTAINER" "$NODE_CONTAINER" >/dev/null 2>&1 || true

echo "== wget|bash install-api.sh =="
wget -qO- "${RAW_BASE}/install-api.sh" | \
  env ONCHAIN_INVOICE_RAW="$RAW_BASE" INSTALL_DIR="$INSTALL_DIR" bash

echo "== wget|bash install-nodes.sh =="
wget -qO- "${RAW_BASE}/install-nodes.sh" | \
  env ONCHAIN_INVOICE_RAW="$RAW_BASE" INSTALL_DIR="$INSTALL_DIR" bash

[[ -x "$INSTALL_DIR/start-onchain-invoice-api.sh" ]]
[[ -x "$INSTALL_DIR/start-onchain-invoice-nodes.sh" ]]
[[ -f "$INSTALL_DIR/onchain-invoice-api.yaml" ]]
[[ -f "$INSTALL_DIR/onchain-invoice-nodes.yaml" ]]

echo "== patch YAML images / rate limit =="
python3 - "$INSTALL_DIR/onchain-invoice-api.yaml" "$API_IMAGE" <<'PY'
import sys
path, image = sys.argv[1], sys.argv[2]
text = open(path, encoding="utf-8").read().splitlines()
out = []
for line in text:
    if line.strip().startswith("image:"):
        indent = line[: len(line) - len(line.lstrip(" "))]
        out.append(f"{indent}image: {image}")
    elif line.strip().startswith("createPerSecond:"):
        indent = line[: len(line) - len(line.lstrip(" "))]
        out.append(f"{indent}createPerSecond: 10")
    elif line.strip().startswith("adminApiKey:"):
        indent = line[: len(line) - len(line.lstrip(" "))]
        out.append(f"{indent}adminApiKey: ${{ADMIN_API_KEY}}")
    elif line.strip().startswith("sweeperApiKey:"):
        indent = line[: len(line) - len(line.lstrip(" "))]
        out.append(f"{indent}sweeperApiKey: ${{SWEEPER_API_KEY}}")
    else:
        out.append(line)
open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")
PY

python3 - "$INSTALL_DIR/onchain-invoice-nodes.yaml" "$SWEEPER_IMAGE" "$SWEEPER_WALLET_KEY" "$SWEEPER_PRIVATE_KEY" "$SWEEPER_ADDRESS" <<'PY'
import sys
path, image, wallet_key, private_key, sweeper_addr = sys.argv[1:6]
text = open(path, encoding="utf-8").read().splitlines()
out = []
for line in text:
    stripped = line.strip()
    indent = line[: len(line) - len(line.lstrip(" "))]
    if stripped.startswith("image:"):
        out.append(f"{indent}image: {image}")
    elif stripped.startswith("sweeperWalletKey:"):
        out.append(f'{indent}sweeperWalletKey: "{wallet_key}"')
    elif stripped.startswith("privateKey:"):
        out.append(f'{indent}privateKey: "{private_key}"')
    elif stripped.startswith("sweeperAddress:") and "${" in stripped:
        out.append(f'{indent}sweeperAddress: "{sweeper_addr}"')
    elif stripped.startswith("apiKey:"):
        out.append(f'{indent}apiKey: "system-test-sweeper"')
    else:
        out.append(line)
open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")
PY

export ADMIN_API_KEY SWEEPER_API_KEY SWEEPER_ADDRESS FORWARDER_IMPLEMENTATION
export SWEEPER_WALLET_KEY SWEEPER_PRIVATE_KEY EVM_RPC_URL
export BASE_URL="${BASE_URL:-http://localhost:8080}"
# Same-host installer e2e: API published on host 8080
export SERVER_URL="${SERVER_URL:-http://host.docker.internal:8080}"
export API_URL="${API_URL:-http://host.docker.internal:8080}"
export PULL="${PULL:-1}"
export ONCHAIN_INVOICE_SKIP_PULL="${ONCHAIN_INVOICE_SKIP_PULL:-}"
# DooD / remote Docker: avoid host bind-mounts for data dirs.
export ONCHAIN_INVOICE_SKIP_HOST_MOUNTS=1
if [[ "$PULL" == "0" ]]; then
  export ONCHAIN_INVOICE_SKIP_PULL=1
fi

# Installer .env must not override our exports (start scripts prefer already-set env).
cat > "$INSTALL_DIR/.env" <<EOF
ADMIN_API_KEY=${ADMIN_API_KEY}
SWEEPER_API_KEY=${SWEEPER_API_KEY}
BASE_URL=${BASE_URL}
EVM_RPC_URL=${EVM_RPC_URL}
SWEEPER_ADDRESS=${SWEEPER_ADDRESS}
FORWARDER_IMPLEMENTATION=${FORWARDER_IMPLEMENTATION}
SERVER_URL=${SERVER_URL}
API_URL=${API_URL}
SWEEPER_WALLET_KEY=${SWEEPER_WALLET_KEY}
SWEEPER_PRIVATE_KEY=${SWEEPER_PRIVATE_KEY}
SWEEPER_REGISTER_ADDRESS=${SWEEPER_ADDR}
SWEEPER_LABEL=install-e2e
SWEEPER_CHAINS=11155111
EOF

container_api_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local api_key="${4:-}"
  # Retries cover docker-exec races after compose teardown; POST body uses unique client ids.
  local attempts=5
  local attempt out=""
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    out="$(docker exec \
      -e T_METHOD="$method" \
      -e T_PATH="$path" \
      -e T_BODY="$body" \
      -e T_API_KEY="$api_key" \
      "$API_CONTAINER" node -e '
fetch("http://127.0.0.1:8080" + process.env.T_PATH, {
  method: process.env.T_METHOD,
  headers: Object.assign(
    {},
    process.env.T_BODY ? { "content-type": "application/json" } : {},
    process.env.T_API_KEY ? { "x-api-key": process.env.T_API_KEY } : {}
  ),
  body: process.env.T_BODY || undefined,
}).then(async (res) => {
  process.stdout.write(JSON.stringify({ status: res.status, body: await res.text() }));
}).then(() => process.exit(0)).catch((e) => { console.error(String(e)); process.exit(1); });
' 2>/dev/null || true)"
    if [[ -n "$out" ]]; then
      printf '%s' "$out"
      return 0
    fi
    sleep 1
  done
  echo "container_api_json failed: $method $path" >&2
  docker logs --tail=40 "$API_CONTAINER" >&2 || true
  return 1
}

signed_sweeper_me() {
  # Sign from the API container (always up); proves the registered wallet can auth.
  docker exec \
    -e SWEEPER_WALLET_KEY="$SWEEPER_WALLET_KEY" \
    "$API_CONTAINER" node -e '
const { Wallet } = require("ethers");
const { createHash, randomUUID } = require("crypto");
const path = "/api/sweeper/me";
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
  fetch("http://127.0.0.1:8080" + path, {
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
' 2>/dev/null || true
}

echo "== start API via installer script =="
(
  cd "$INSTALL_DIR"
  ./start-onchain-invoice-api.sh
)

echo "== wait for API health =="
health_ok=0
health=""
for _ in $(seq 1 60); do
  if docker inspect -f '{{.State.Running}}' "$API_CONTAINER" 2>/dev/null | grep -q true; then
    health="$(container_api_json GET /api/health || true)"
    if [[ -n "$health" ]] && python3 -c 'import json,sys; d=json.loads(sys.argv[1]); raise SystemExit(0 if d.get("status")==200 else 1)' "$health" 2>/dev/null; then
      health_ok=1
      break
    fi
  fi
  sleep 1
done
if [[ "$health_ok" -ne 1 ]]; then
  echo "API failed to become healthy; last=$health" >&2
  docker logs --tail=80 "$API_CONTAINER" >&2 || true
  exit 1
fi
assert_status "$health" 200
assert_body_ok "$health"

echo "== admin stats =="
stats="$(container_api_json GET /api/admin/stats "" "$ADMIN_API_KEY")"
assert_status "$stats" 200
assert_contains "$stats" 'inFlight'

echo "== create invoice =="
CLIENT_ID="install-$(date +%s)-$$"
BODY=$(printf '%s' "{\"price\":\"1.00\",\"to\":[\"$MERCHANT\"],\"chains\":[\"11155111\"],\"tokens\":[\"USDC\"],\"clientInvoiceId\":\"$CLIENT_ID\",\"chainId\":\"11155111\",\"token\":\"USDC\",\"selectedTo\":\"$MERCHANT\",\"title\":\"Install e2e\"}")
created="$(container_api_json POST /api/invoices "$BODY")"
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d["status"] in (200,201), d; b=json.loads(d["body"]); assert b.get("invoiceAddress") or (b.get("invoice") or {}).get("invoiceAddress")' "$created"
assert_contains "$created" 'invoiceAddress'

echo "== register sweeper wallet (register-onchain-invoice-node.sh) =="
# Script talks to API_URL; use host-published port from inside this environment via docker network gateway.
# Prefer hitting the API container loopback through our helper, then also exercise the install register script
# against localhost (published 8080) when reachable; fall back to direct API register.
if API_URL="http://127.0.0.1:8080" ADMIN_API_KEY="$ADMIN_API_KEY" \
  SWEEPER_REGISTER_ADDRESS="$SWEEPER_ADDR" SWEEPER_LABEL=install-e2e SWEEPER_CHAINS=11155111 \
  bash "$INSTALL_DIR/register-onchain-invoice-node.sh" 2>/dev/null; then
  echo "register script OK"
else
  echo "register script could not reach host:8080; registering via docker exec"
  reg_body=$(printf '%s' "{\"address\":\"$SWEEPER_ADDR\",\"label\":\"install-e2e\",\"chains\":[\"11155111\"],\"enabled\":true}")
  reg="$(container_api_json POST /api/admin/sweepers "$reg_body" "$ADMIN_API_KEY")"
  assert_status "$reg" 201
  assert_contains_ci "$reg" "$SWEEPER_ADDR"
fi

echo "== start sweeper via installer script =="
(
  cd "$INSTALL_DIR"
  ./start-onchain-invoice-nodes.sh
)

echo "== wait for signed /api/sweeper/me =="
me_ok=0
me=""
for _ in $(seq 1 30); do
  me="$(signed_sweeper_me || true)"
  if [[ "$me" == *'"status":200'* ]]; then
    me_ok=1
    break
  fi
  sleep 2
done
if [[ "$me_ok" -ne 1 ]]; then
  echo "sweeper /me failed; last=$me" >&2
  docker logs --tail=80 "$NODE_CONTAINER" >&2 || true
  docker logs --tail=40 "$API_CONTAINER" >&2 || true
  exit 1
fi
echo "sweeper auth OK"

echo ""
echo "WGET INSTALL E2E OK"
