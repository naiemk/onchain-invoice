#!/usr/bin/env bash
# End-to-end: wget|bash tctest installers → start-api/start-nodes → API + sweeper assertions.
# Uses separate install dirs (api + nodes) — vibed register fails if both share one .env.
set -euo pipefail

ST_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ST_ROOT/.." && pwd)"

# shellcheck disable=SC1091
source "$ST_ROOT/scripts/lib.sh"
# shellcheck disable=SC1091
source "$ST_ROOT/scripts/packager-http.sh"

IMAGE_TAG="${IMAGE_TAG:-main}"
API_IMAGE="ghcr.io/naiemk/trustless-commerce-api:${IMAGE_TAG}"
SWEEPER_IMAGE="ghcr.io/naiemk/trustless-commerce-sweeper:${IMAGE_TAG}"
API_CONTAINER="tctest-api"
DOCKER_NETWORK="${DOCKER_NETWORK:-vps-edge}"
APP_PREFIX="tctest"

ADMIN_API_KEY="${ADMIN_API_KEY:-system-test-admin}"
SWEEPER_API_KEY="${SWEEPER_API_KEY:-system-test-sweeper}"
SWEEPER_ADDRESS="${SWEEPER_ADDRESS:-0x1111111111111111111111111111111111111111}"
FORWARDER_IMPLEMENTATION="${FORWARDER_IMPLEMENTATION:-0x2222222222222222222222222222222222222222}"
SWEEPER_WALLET_KEY="${SWEEPER_WALLET_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
SWEEPER_PRIVATE_KEY="${SWEEPER_PRIVATE_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
EVM_RPC_URL="${EVM_RPC_URL:-}"
MERCHANT="${MERCHANT:-0xc2eCF8b48b9D5D1Fd04b8A9c15126011aa1cC3Eb}"
SWEEPER_ADDR="${SWEEPER_ADDR:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"

INSTALL_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/onchain-invoice-install-e2e.XXXXXX")"
API_DIR="${INSTALL_ROOT}/api"
NODES_DIR="${INSTALL_ROOT}/nodes"

cleanup_install() {
  packager_http_stop
  docker rm -f "$API_CONTAINER" \
    tctest-sweeper-evm tctest-sweeper-tron tctest-sweeper-solana \
    tctest-bundler-evm tctest-wallet-deployer-evm \
    >/dev/null 2>&1 || true
  docker volume rm -f "${API_CONTAINER}-data" >/dev/null 2>&1 || true
  rm -rf "$INSTALL_ROOT"
}
trap cleanup_install EXIT

echo "======== wget install e2e (tctest / vibed-infra 0.8) ========"
echo "INSTALL_ROOT=$INSTALL_ROOT"
echo "IMAGE_TAG=$IMAGE_TAG"

if [[ "${BUILD_LOCAL:-1}" == "1" ]] && [[ "$IMAGE_TAG" != "main" ]]; then
  echo "== build local Docker images (:${IMAGE_TAG}) =="
  (
    cd "$REPO_ROOT"
    npm run commerce:build >/dev/null
    docker compose -f deploy/docker-compose.yml build api
    docker build -f deploy/Dockerfile.sweeper -t "$SWEEPER_IMAGE" .
  )
  export PULL=0
  export ONCHAIN_INVOICE_SKIP_PULL=1
fi

packager_http_start "$REPO_ROOT"
echo "PACKAGER_RAW=$PACKAGER_RAW"
echo "PRODUCT_RAW=$PRODUCT_RAW"
echo "PACKAGECONFIG_URL=$PACKAGECONFIG_URL"
echo "RAW_BASE=$RAW_BASE"

# Dry-run: install wrappers must be reachable over HTTP.
for script in install-api.sh install-nodes.sh; do
  curl -fsS "${RAW_BASE}/${script}" >/dev/null
done
echo "packager install scripts reachable"

docker rm -f "$API_CONTAINER" \
  tctest-sweeper-evm tctest-sweeper-tron tctest-sweeper-solana \
  tctest-bundler-evm tctest-wallet-deployer-evm \
  >/dev/null 2>&1 || true

mkdir -p "$API_DIR" "$NODES_DIR"

echo "== wget|bash install-api.sh (tctest dist) =="
wget -qO- "${RAW_BASE}/install-api.sh" | \
  env PACKAGER_RAW="$PACKAGER_RAW" \
      PACKAGECONFIG_URL="$PACKAGECONFIG_URL" \
      PRODUCT_RAW="$PRODUCT_RAW" \
      INSTALL_DIR="$API_DIR" bash

echo "== wget|bash install-nodes.sh (tctest dist) =="
wget -qO- "${RAW_BASE}/install-nodes.sh" | \
  env PACKAGER_RAW="$PACKAGER_RAW" \
      PACKAGECONFIG_URL="$PACKAGECONFIG_URL" \
      PRODUCT_RAW="$PRODUCT_RAW" \
      INSTALL_DIR="$NODES_DIR" bash

[[ -x "$API_DIR/start-api.sh" ]]
[[ -f "$API_DIR/api-app.yaml" ]]
[[ -x "$NODES_DIR/start-nodes.sh" ]]
[[ -f "$NODES_DIR/nodes-workers.yaml" ]]
[[ -f "$NODES_DIR/docker-compose.workers.yml" ]]
[[ -x "$NODES_DIR/register-onchain-invoice-node.sh" ]]

echo "== patch api-app.yaml rate limit =="
python3 - "$API_DIR/api-app.yaml" <<'PY'
import sys
path = sys.argv[1]
text = open(path, encoding="utf-8").read().splitlines()
out = []
for line in text:
    if line.strip().startswith("createPerSecond:"):
        indent = line[: len(line) - len(line.lstrip(" "))]
        out.append(f"{indent}createPerSecond: 10")
    else:
        out.append(line)
open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")
PY

export ADMIN_API_KEY SWEEPER_API_KEY SWEEPER_ADDRESS FORWARDER_IMPLEMENTATION
export SWEEPER_WALLET_KEY SWEEPER_PRIVATE_KEY EVM_RPC_URL
export BASE_URL="${BASE_URL:-http://localhost:8080}"
export SERVER_URL="${SERVER_URL:-http://host.docker.internal:8080}"
export API_URL="${API_URL:-http://host.docker.internal:8080}"
export PULL="${PULL:-1}"
export ONCHAIN_INVOICE_SKIP_PULL="${ONCHAIN_INVOICE_SKIP_PULL:-}"
export ONCHAIN_INVOICE_SKIP_HOST_MOUNTS=1
if [[ "$PULL" == "0" ]]; then
  export ONCHAIN_INVOICE_SKIP_PULL=1
fi

# Images + container naming via env (api-app.yaml has no docker.image block).
cat > "$API_DIR/.env" <<EOF
ADMIN_API_KEY=${ADMIN_API_KEY}
SWEEPER_API_KEY=${SWEEPER_API_KEY}
BASE_URL=${BASE_URL}
EVM_RPC_URL=${EVM_RPC_URL}
SWEEPER_ADDRESS=${SWEEPER_ADDRESS}
FORWARDER_IMPLEMENTATION=${FORWARDER_IMPLEMENTATION}
DOCKER_NAME=${API_CONTAINER}
DOCKER_NETWORK=${DOCKER_NETWORK}
HOST_PORT=8080
BACKEND_IMAGE=${API_IMAGE}
EOF

cat > "$NODES_DIR/.env" <<EOF
ADMIN_API_KEY=${ADMIN_API_KEY}
SWEEPER_API_KEY=${SWEEPER_API_KEY}
BASE_URL=${BASE_URL}
EVM_RPC_URL=${EVM_RPC_URL}
SWEEPER_ADDRESS=${SWEEPER_ADDRESS}
FORWARDER_IMPLEMENTATION=${FORWARDER_IMPLEMENTATION}
SERVER_URL=http://${API_CONTAINER}:8080
API_URL=http://${API_CONTAINER}:8080
SWEEPER_WALLET_KEY=${SWEEPER_WALLET_KEY}
SWEEPER_PRIVATE_KEY=${SWEEPER_PRIVATE_KEY}
SWEEPER_REGISTER_ADDRESS=${SWEEPER_ADDR}
SWEEPER_LABEL=install-e2e
SWEEPER_CHAINS=11155111
DOCKER_NETWORK=${DOCKER_NETWORK}
APP_PREFIX=${APP_PREFIX}
SWEEPER_IMAGE=${SWEEPER_IMAGE}
WORKER_IMAGE=${SWEEPER_IMAGE}
SWEEPER_SOLANA_ENABLED=0
EOF

container_api_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local api_key="${4:-}"
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

echo "== start API via start-api.sh =="
(
  cd "$API_DIR"
  ./start-api.sh
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

echo "== register sweeper wallet =="
if API_URL="http://127.0.0.1:8080" ADMIN_API_KEY="$ADMIN_API_KEY" \
  SWEEPER_REGISTER_ADDRESS="$SWEEPER_ADDR" SWEEPER_LABEL=install-e2e SWEEPER_CHAINS=11155111 \
  bash "$NODES_DIR/register-onchain-invoice-node.sh" 2>/dev/null; then
  echo "register script OK"
else
  echo "register script could not reach host:8080; registering via docker exec"
  reg_body=$(printf '%s' "{\"address\":\"$SWEEPER_ADDR\",\"label\":\"install-e2e\",\"chains\":[\"11155111\"],\"enabled\":true}")
  reg="$(container_api_json POST /api/admin/sweepers "$reg_body" "$ADMIN_API_KEY")"
  assert_status "$reg" 201
  assert_contains_ci "$reg" "$SWEEPER_ADDR"
fi

echo "== start nodes via start-nodes.sh =="
(
  cd "$NODES_DIR"
  ./start-nodes.sh
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
  docker logs --tail=80 tctest-sweeper-evm >&2 || true
  docker logs --tail=40 "$API_CONTAINER" >&2 || true
  exit 1
fi
echo "sweeper auth OK"

echo ""
echo "WGET INSTALL E2E OK"
