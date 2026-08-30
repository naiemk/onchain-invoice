#!/usr/bin/env bash
# Full infra packager e2e: Hardhat fork RPC + wget install (api / nodes) + local Docker images.
# Host gateway / product nginx are out of scope (vibed-infra 0.8 host gateway on VPS).
# UI is started as a plain container on the shared edge network for smoke.
#
# Usage:
#   npm run system-test:infra-deploy
#   BUILD_LOCAL=0 npm run system-test:infra-deploy
#   HARDHAT_FORK=0 npm run system-test:infra-deploy
set -euo pipefail

ST_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ST_ROOT/.." && pwd)"

# shellcheck disable=SC1091
source "$ST_ROOT/scripts/lib.sh"
# shellcheck disable=SC1091
source "$ST_ROOT/scripts/packager-http.sh"

IMAGE_TAG=local
BUILD_LOCAL="${BUILD_LOCAL:-1}"
HARDHAT_FORK="${HARDHAT_FORK:-1}"
HARDHAT_PORT="${HARDHAT_PORT:-8545}"
SEPOLIA_RPC="${SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"
HARDHAT_RPC="http://127.0.0.1:${HARDHAT_PORT}"

API_IMAGE="ghcr.io/naiemk/trustless-commerce-api:${IMAGE_TAG}"
SWEEPER_IMAGE="ghcr.io/naiemk/trustless-commerce-sweeper:${IMAGE_TAG}"
UI_IMAGE="ghcr.io/naiemk/trustless-commerce-ui:${IMAGE_TAG}"

API_CONTAINER="tctest-api"
UI_CONTAINER="tctest-ui"
DOCKER_NETWORK="vps-edge"
APP_PREFIX="tctest"

ADMIN_API_KEY="${ADMIN_API_KEY:-system-test-admin}"
SWEEPER_API_KEY="${SWEEPER_API_KEY:-system-test-sweeper}"
SWEEPER_WALLET_KEY="${SWEEPER_WALLET_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
SWEEPER_PRIVATE_KEY="${SWEEPER_PRIVATE_KEY:-$SWEEPER_WALLET_KEY}"
SWEEPER_ADDR="${SWEEPER_ADDR:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
MERCHANT="${MERCHANT:-0xc2eCF8b48b9D5D1Fd04b8A9c15126011aa1cC3Eb}"

DEPLOY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/infra-deploy-e2e.XXXXXX")"
API_DIR="${DEPLOY_ROOT}/api"
NODES_DIR="${DEPLOY_ROOT}/nodes"

HARDHAT_PID=""

cleanup() {
  local code=$?
  packager_http_stop
  if [[ -n "$HARDHAT_PID" ]]; then
    kill "$HARDHAT_PID" >/dev/null 2>&1 || true
    wait "$HARDHAT_PID" 2>/dev/null || true
  fi
  docker rm -f "$API_CONTAINER" "$UI_CONTAINER" \
    tctest-sweeper-evm tctest-sweeper-tron tctest-sweeper-solana \
    tctest-bundler-evm tctest-wallet-deployer-evm \
    >/dev/null 2>&1 || true
  docker network rm "$DOCKER_NETWORK" >/dev/null 2>&1 || true
  rm -rf "$DEPLOY_ROOT"
  exit "$code"
}
trap cleanup EXIT

wait_rpc() {
  local url="$1"
  for _ in $(seq 1 60); do
    if curl -fsS -X POST "$url" \
      -H 'content-type: application/json' \
      -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "Hardhat RPC not ready at $url" >&2
  return 1
}

free_hardhat_port() {
  local port="$1"
  if command -v fuser >/dev/null 2>&1; then
    fuser -k "${port}/tcp" >/dev/null 2>&1 || true
  fi
  pkill -f "hardhat node --port ${port}" >/dev/null 2>&1 || true
  sleep 0.5
}

echo "======== infra deploy e2e (Hardhat + tctest packager) ========"
echo "DEPLOY_ROOT=$DEPLOY_ROOT"

echo "== compile contracts =="
(
  cd "$REPO_ROOT"
  npm run compile >/dev/null
)

echo "== start Hardhat node (fork=${HARDHAT_FORK}) =="
HARDHAT_ARGS=(node --port "$HARDHAT_PORT" --hostname 127.0.0.1)
if [[ "$HARDHAT_FORK" == "1" ]]; then
  HARDHAT_ARGS+=(--fork "$SEPOLIA_RPC")
fi
PRODUCT_CHAIN_ID=11155111
free_hardhat_port "$HARDHAT_PORT"
(
  cd "$REPO_ROOT"
  npx hardhat "${HARDHAT_ARGS[@]}"
) >/tmp/infra-e2e-hardhat.log 2>&1 &
HARDHAT_PID=$!
wait_rpc "$HARDHAT_RPC"

HARDHAT_DEPLOYER_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
echo "== deploy CommerceInvoiceSweeper to Hardhat RPC =="
(
  cd "$REPO_ROOT"
  EVM_PRIVATE_KEY="$HARDHAT_DEPLOYER_KEY" HARDHAT_RPC_URL="$HARDHAT_RPC" \
    npx hardhat run scripts/deploy-commerce.ts --network localhost >/tmp/infra-e2e-deploy.log 2>&1
)
DEPLOY_JSON="$(python3 - <<'PY'
import json, re, pathlib
text = pathlib.Path("/tmp/infra-e2e-deploy.log").read_text()
m = re.search(r"\{[\s\S]*\}", text)
if not m:
    raise SystemExit("deploy output missing JSON")
print(json.dumps(json.loads(m.group())))
PY
)"
SWEEPER_ADDRESS="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["sweeper"])' "$DEPLOY_JSON")"
FORWARDER_IMPLEMENTATION="$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["forwarderImplementation"])' "$DEPLOY_JSON")"
CHAIN_ID="$PRODUCT_CHAIN_ID"
echo "sweeper=$SWEEPER_ADDRESS forwarder=$FORWARDER_IMPLEMENTATION productChainId=$CHAIN_ID"

if [[ "$BUILD_LOCAL" == "1" ]]; then
  echo "== build local Docker images (:${IMAGE_TAG}) =="
  (
    cd "$REPO_ROOT"
    npm run commerce:build >/dev/null
    docker compose -f deploy/docker-compose.yml build api ui
    docker build -f deploy/Dockerfile.sweeper -t "$SWEEPER_IMAGE" .
  )
else
  echo "== skip local build (BUILD_LOCAL=0) =="
fi

if ! docker image inspect "$SWEEPER_IMAGE" >/dev/null 2>&1; then
  ALT="ghcr.io/naiemk/trustless-commerce-sweeper:system-test-local"
  if docker image inspect "$ALT" >/dev/null 2>&1; then
    echo "== tag $ALT -> $SWEEPER_IMAGE =="
    docker tag "$ALT" "$SWEEPER_IMAGE"
  else
    echo "== build sweeper image $SWEEPER_IMAGE =="
    docker build -f "$REPO_ROOT/deploy/Dockerfile.sweeper" -t "$SWEEPER_IMAGE" "$REPO_ROOT"
  fi
fi

for img in "$API_IMAGE" "$UI_IMAGE"; do
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    echo "Missing Docker image $img — run with BUILD_LOCAL=1 or build deploy/docker-compose.yml first." >&2
    exit 1
  fi
done

packager_http_start "$REPO_ROOT"
INSTALL_WRAPPER="$RAW_BASE"

docker rm -f "$API_CONTAINER" "$UI_CONTAINER" \
  tctest-sweeper-evm tctest-sweeper-tron tctest-sweeper-solana \
  tctest-bundler-evm tctest-wallet-deployer-evm \
  >/dev/null 2>&1 || true

install_profile() {
  local profile="$1"
  local dest="$2"
  mkdir -p "$dest"
  wget -qO- "${INSTALL_WRAPPER}/install-${profile}.sh" | \
    env PACKAGER_RAW="$PACKAGER_RAW" \
        PACKAGECONFIG_URL="$PACKAGECONFIG_URL" \
        PRODUCT_RAW="$PRODUCT_RAW" \
        INSTALL_DIR="$dest" bash
}

echo "== infra install: api / nodes (separate dirs; no product nginx) =="
install_profile api "$API_DIR"
install_profile nodes "$NODES_DIR"

[[ -x "$API_DIR/start-api.sh" ]]
[[ -x "$NODES_DIR/start-nodes.sh" ]]
[[ -f "$API_DIR/api-app.yaml" ]]
[[ -f "$NODES_DIR/nodes-workers.yaml" ]]

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

cat >"$API_DIR/.env" <<EOF
ADMIN_API_KEY=${ADMIN_API_KEY}
SWEEPER_API_KEY=${SWEEPER_API_KEY}
BASE_URL=http://127.0.0.1:8080
DOCKER_NETWORK=${DOCKER_NETWORK}
DOCKER_NAME=${API_CONTAINER}
HOST_PORT=8080
BACKEND_IMAGE=${API_IMAGE}
EVM_RPC_URL=http://host.docker.internal:${HARDHAT_PORT}
SWEEPER_ADDRESS=${SWEEPER_ADDRESS}
FORWARDER_IMPLEMENTATION=${FORWARDER_IMPLEMENTATION}
API_AUTO_UPDATE=0
EOF

cat >"$NODES_DIR/.env" <<EOF
ADMIN_API_KEY=${ADMIN_API_KEY}
SWEEPER_API_KEY=${SWEEPER_API_KEY}
API_URL=http://${API_CONTAINER}:8080
SERVER_URL=http://${API_CONTAINER}:8080
SWEEPER_WALLET_KEY=${SWEEPER_WALLET_KEY}
SWEEPER_PRIVATE_KEY=${SWEEPER_PRIVATE_KEY}
SWEEPER_ADDRESS=${SWEEPER_ADDRESS}
EVM_RPC_URL=http://host.docker.internal:${HARDHAT_PORT}
SWEEPER_CHAINS=${CHAIN_ID}
SWEEPER_REGISTER_ADDRESS=${SWEEPER_ADDR}
SWEEPER_LABEL=infra-e2e
SWEEPER_IMAGE=${SWEEPER_IMAGE}
WORKER_IMAGE=${SWEEPER_IMAGE}
SWEEPER_SOLANA_ENABLED=0
NODES_AUTO_UPDATE=0
ONCHAIN_INVOICE_SKIP_HOST_MOUNTS=1
DOCKER_NETWORK=${DOCKER_NETWORK}
APP_PREFIX=${APP_PREFIX}
EOF

echo "== start backend (API dir) =="
(
  cd "$API_DIR"
  export ONCHAIN_INVOICE_SKIP_HOST_MOUNTS=1 PULL=0 ONCHAIN_INVOICE_SKIP_PULL=1
  ./start-api.sh
)

container_api_json() {
  local method="$1" path="$2" body="${3:-}" api_key="${4:-}"
  docker exec \
    -e T_METHOD="$method" -e T_PATH="$path" -e T_BODY="$body" -e T_API_KEY="$api_key" \
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
'
}

echo "== wait API health =="
health_ok=0
for _ in $(seq 1 60); do
  health="$(container_api_json GET /api/health 2>/dev/null || true)"
  if [[ -n "$health" ]] && python3 -c 'import json,sys; d=json.loads(sys.argv[1]); raise SystemExit(0 if d.get("status")==200 else 1)' "$health" 2>/dev/null; then
    health_ok=1
    break
  fi
  sleep 1
done
[[ "$health_ok" -eq 1 ]] || { docker logs --tail=60 "$API_CONTAINER" >&2; exit 1; }
assert_status "$health" 200
assert_body_ok "$health"

echo "== create invoice (CREATE2 against deployed sweeper) =="
CLIENT_ID="infra-e2e-$(date +%s)"
BODY=$(printf '%s' "{\"price\":\"1.00\",\"to\":[\"$MERCHANT\"],\"chains\":[\"$CHAIN_ID\"],\"tokens\":[\"USDC\"],\"clientInvoiceId\":\"$CLIENT_ID\",\"chainId\":\"$CHAIN_ID\",\"token\":\"USDC\",\"selectedTo\":\"$MERCHANT\",\"title\":\"Infra e2e\"}")
created="$(container_api_json POST /api/invoices "$BODY")"
python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d["status"] in (200,201), d; b=json.loads(d["body"]); assert b.get("invoiceAddress") or (b.get("invoice") or {}).get("invoiceAddress")' "$created"

echo "== register sweeper + start workers (nodes dir) =="
reg_body=$(printf '%s' "{\"address\":\"$SWEEPER_ADDR\",\"label\":\"infra-e2e\",\"chains\":[\"$CHAIN_ID\"],\"enabled\":true}")
reg="$(container_api_json POST /api/admin/sweepers "$reg_body" "$ADMIN_API_KEY")"
assert_status "$reg" 201
assert_contains_ci "$reg" "$SWEEPER_ADDR"
(
  cd "$NODES_DIR"
  export ONCHAIN_INVOICE_SKIP_HOST_MOUNTS=1 PULL=0 ONCHAIN_INVOICE_SKIP_PULL=1 SWEEPER_IMAGE="$SWEEPER_IMAGE"
  ./start-nodes.sh
)

signed_sweeper_me() {
  docker exec -e SWEEPER_WALLET_KEY="$SWEEPER_WALLET_KEY" "$API_CONTAINER" node -e '
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
    process.stdout.write(JSON.stringify({ status: res.status, body: await res.text() }));
  })
).then(() => process.exit(0)).catch((e) => { console.error(String(e)); process.exit(1); });
'
}

me_ok=0
for _ in $(seq 1 30); do
  me="$(signed_sweeper_me 2>/dev/null || true)"
  if [[ "$me" == *'"status":200'* ]]; then me_ok=1; break; fi
  sleep 2
done
[[ "$me_ok" -eq 1 ]] || { docker logs --tail=40 tctest-sweeper-evm >&2; exit 1; }

echo "== start UI container on edge network (no product nginx) =="
docker network create "$DOCKER_NETWORK" >/dev/null 2>&1 || true
docker rm -f "$UI_CONTAINER" >/dev/null 2>&1 || true
docker run -d --name "$UI_CONTAINER" --restart unless-stopped \
  --network "$DOCKER_NETWORK" --memory "${UI_MEMORY_LIMIT:-64m}" \
  "$UI_IMAGE" >/dev/null

echo "== UI smoke via docker network =="
ui_ok=0
for _ in $(seq 1 30); do
  if docker exec "$API_CONTAINER" node -e '
fetch("http://tctest-ui/").then(async (r)=>{const t=await r.text(); process.exit(r.ok && /trustless/i.test(t)?0:1)}).catch(()=>process.exit(1))
' 2>/dev/null; then
    ui_ok=1
    break
  fi
  sleep 1
done
[[ "$ui_ok" -eq 1 ]] || {
  echo "UI smoke failed" >&2
  docker logs --tail=40 "$UI_CONTAINER" 2>&1 >&2 || true
  exit 1
}

echo ""
echo "INFRA DEPLOY E2E OK (api + nodes + ui on Hardhat fork; host gateway skipped)"
