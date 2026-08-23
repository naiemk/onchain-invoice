#!/usr/bin/env bash
# Full infra packager e2e: Hardhat fork RPC + wget install (API / nodes / gateway dirs)
# + local Docker images. Validates UI + backend + worker stack via infra/install.sh.
#
# Usage:
#   npm run system-test:infra-deploy
#   BUILD_LOCAL=0 npm run system-test:infra-deploy   # skip image build, use :local if present
#   HARDHAT_FORK=0 npm run system-test:infra-deploy # in-process chain (no Sepolia fork)
set -euo pipefail

ST_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO_ROOT="$(cd "$ST_ROOT/.." && pwd)"

# shellcheck disable=SC1091
source "$ST_ROOT/scripts/lib.sh"
# shellcheck disable=SC1091
source "$ST_ROOT/scripts/packager-http.sh"

# Always use :local tags here (deploy/docker-compose.yml); ignore system-tests/.env IMAGE_TAG.
IMAGE_TAG=local
BUILD_LOCAL="${BUILD_LOCAL:-1}"
HARDHAT_FORK="${HARDHAT_FORK:-1}"
HARDHAT_PORT="${HARDHAT_PORT:-8545}"
SEPOLIA_RPC="${SEPOLIA_RPC:-https://ethereum-sepolia-rpc.publicnode.com}"
HARDHAT_RPC="http://127.0.0.1:${HARDHAT_PORT}"

API_IMAGE="ghcr.io/naiemk/trustless-commerce-api:${IMAGE_TAG}"
SWEEPER_IMAGE="ghcr.io/naiemk/trustless-commerce-sweeper:${IMAGE_TAG}"
UI_IMAGE="ghcr.io/naiemk/trustless-commerce-ui:${IMAGE_TAG}"
NGINX_IMAGE="ghcr.io/naiemk/trustless-commerce-nginx:${IMAGE_TAG}"

API_CONTAINER="testnet-api"
GATEWAY_NAME="onchain-invoice-gateway"
TESTNET_UI="testnet-ui"
DOCKER_NETWORK="trustless-commerce-edge"

ADMIN_API_KEY="${ADMIN_API_KEY:-system-test-admin}"
SWEEPER_API_KEY="${SWEEPER_API_KEY:-system-test-sweeper}"
SWEEPER_WALLET_KEY="${SWEEPER_WALLET_KEY:-0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80}"
SWEEPER_PRIVATE_KEY="${SWEEPER_PRIVATE_KEY:-$SWEEPER_WALLET_KEY}"
SWEEPER_ADDR="${SWEEPER_ADDR:-0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266}"
MERCHANT="${MERCHANT:-0xc2eCF8b48b9D5D1Fd04b8A9c15126011aa1cC3Eb}"

DEPLOY_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/infra-deploy-e2e.XXXXXX")"
API_DIR="${DEPLOY_ROOT}/api"
NODES_DIR="${DEPLOY_ROOT}/nodes"
GATEWAY_DIR="${DEPLOY_ROOT}/gateway"

HARDHAT_PID=""

cleanup() {
  local code=$?
  packager_http_stop
  if [[ -n "$HARDHAT_PID" ]]; then
    kill "$HARDHAT_PID" >/dev/null 2>&1 || true
    wait "$HARDHAT_PID" 2>/dev/null || true
  fi
  docker rm -f "$API_CONTAINER" "$GATEWAY_NAME" "$TESTNET_UI" mainnet-ui \
    onchain-invoice-sweeper-evm onchain-invoice-sweeper-tron onchain-invoice-sweeper-solana \
    >/dev/null 2>&1 || true
  docker network rm "$DOCKER_NETWORK" >/dev/null 2>&1 || true
  docker network prune -f >/dev/null 2>&1 || true
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

echo "======== infra deploy e2e (Hardhat + packager) ========"
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
# Hardhat fork RPC reports chainId 31337; API uses offline CREATE2 for product chain 11155111.
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
  # Override root .env EVM_PRIVATE_KEY — Hardhat node account #0 is funded on the fork.
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
    docker compose -f deploy/docker-compose.yml build api ui nginx
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

for img in "$API_IMAGE" "$UI_IMAGE" "$NGINX_IMAGE"; do
  if ! docker image inspect "$img" >/dev/null 2>&1; then
    echo "Missing Docker image $img — run with BUILD_LOCAL=1 or build deploy/docker-compose.yml first." >&2
    exit 1
  fi
done

echo "== dev TLS certs for gateway =="
CERT_DIR="$ST_ROOT/certs"
if [[ ! -f "$CERT_DIR/fullchain.pem" ]]; then
  bash "$REPO_ROOT/deploy/gen-dev-certs.sh" >/dev/null
  CERT_DIR="$REPO_ROOT/deploy/certs"
fi

packager_http_start "$REPO_ROOT"
INSTALL_WRAPPER="$RAW_BASE"

docker rm -f "$API_CONTAINER" "$GATEWAY_NAME" "$TESTNET_UI" mainnet-ui \
  onchain-invoice-sweeper-evm onchain-invoice-sweeper-tron onchain-invoice-sweeper-solana \
  >/dev/null 2>&1 || true

install_profile() {
  local profile="$1"
  local dest="$2"
  mkdir -p "$dest"
  wget -qO- "${INSTALL_WRAPPER}/install-${profile}.sh" | \
    env PACKAGER_RAW="$PACKAGER_RAW" \
        PACKAGECONFIG_URL="$PACKAGECONFIG_URL" \
        ONCHAIN_INVOICE_RAW="$PRODUCT_RAW" \
        INSTALL_DIR="$dest" bash
}

echo "== infra install: api / nodes / gateway (separate dirs) =="
install_profile api "$API_DIR"
install_profile nodes "$NODES_DIR"
install_profile gateway "$GATEWAY_DIR"

patch_yaml_image() {
  local path="$1" image="$2"
  python3 - "$path" "$image" <<'PY'
import sys
path, image = sys.argv[1], sys.argv[2]
lines = open(path, encoding="utf-8").read().splitlines()
out = []
for line in lines:
    if line.strip().startswith("image:"):
        indent = line[: len(line) - len(line.lstrip(" "))]
        out.append(f"{indent}image: {image}")
    elif line.strip().startswith("createPerSecond:"):
        indent = line[: len(line) - len(line.lstrip(" "))]
        out.append(f"{indent}createPerSecond: 10")
    else:
        out.append(line)
open(path, "w", encoding="utf-8").write("\n".join(out) + "\n")
PY
}

patch_yaml_image "$API_DIR/onchain-invoice-api.yaml" "$API_IMAGE"
patch_yaml_image "$NODES_DIR/onchain-invoice-nodes.yaml" "$SWEEPER_IMAGE"

cat >"$API_DIR/.env" <<EOF
ADMIN_API_KEY=${ADMIN_API_KEY}
SWEEPER_API_KEY=${SWEEPER_API_KEY}
BASE_URL=http://127.0.0.1:18443
DOCKER_NETWORK=${DOCKER_NETWORK}
DOCKER_NAME=${API_CONTAINER}
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
SWEEPER_SOLANA_ENABLED=0
NODES_AUTO_UPDATE=0
ONCHAIN_INVOICE_SKIP_HOST_MOUNTS=1
DOCKER_NETWORK=${DOCKER_NETWORK}
EOF

cat >"$GATEWAY_DIR/.env" <<EOF
IMAGE_TAG=${IMAGE_TAG}
DOCKER_NETWORK=${DOCKER_NETWORK}
TESTNET_UI_NAME=${TESTNET_UI}
MAINNET_UI_NAME=mainnet-ui
GATEWAY_NAME=${GATEWAY_NAME}
UI_IMAGE=${UI_IMAGE%:*}
NGINX_IMAGE=${NGINX_IMAGE%:*}
TLS_FULLCHAIN=${CERT_DIR}/fullchain.pem
TLS_PRIVKEY=${CERT_DIR}/privkey.pem
CERTBOT_WWW=${GATEWAY_DIR}/certbot-www
HTTP_PORT=18080
HTTPS_PORT=18443
UI_TESTNET_AUTO_UPDATE=0
UI_MAINNET_AUTO_UPDATE=0
GATEWAY_AUTO_UPDATE=0
EOF

echo "== start backend (API dir) =="
(
  cd "$API_DIR"
  export ONCHAIN_INVOICE_SKIP_HOST_MOUNTS=1 PULL=0 ONCHAIN_INVOICE_SKIP_PULL=1
  ./start-onchain-invoice-api.sh
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
  ./start-onchain-invoice-nodes.sh
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
[[ "$me_ok" -eq 1 ]] || { docker logs --tail=40 onchain-invoice-sweeper-evm >&2; exit 1; }

echo "== start gateway + UI (gateway dir) =="
start_gateway_e2e() {
  local gw_dir="$1"
  docker network create "$DOCKER_NETWORK" >/dev/null 2>&1 || true
  for ui_name in "$TESTNET_UI" mainnet-ui; do
    docker rm -f "$ui_name" >/dev/null 2>&1 || true
    docker run -d --name "$ui_name" --restart unless-stopped \
      --network "$DOCKER_NETWORK" --memory "${UI_MEMORY_LIMIT:-64m}" \
      "$UI_IMAGE" >/dev/null
  done
  docker rm -f "$GATEWAY_NAME" >/dev/null 2>&1 || true
  docker create --name "$GATEWAY_NAME" --restart unless-stopped \
    --network "$DOCKER_NETWORK" --memory "${GATEWAY_MEMORY_LIMIT:-64m}" \
    -p "${HTTP_PORT:-18080}:80" -p "${HTTPS_PORT:-18443}:443" \
    --entrypoint /bin/sh \
    "$NGINX_IMAGE" \
    -c 'rm -f /etc/nginx/conf.d/api.conf /etc/nginx/conf.d/ui.conf && exec nginx -g "daemon off;"' \
    >/dev/null
  docker cp "$gw_dir/gateway/nginx.conf" "$GATEWAY_NAME:/etc/nginx/nginx.conf"
  docker cp "$gw_dir/gateway/conf.d/domains.conf" "$GATEWAY_NAME:/etc/nginx/conf.d/domains.conf"
  docker start "$GATEWAY_NAME" >/dev/null
  sleep 1
  if ! docker inspect -f '{{.State.Running}}' "$GATEWAY_NAME" 2>/dev/null | grep -q true; then
    echo "Gateway failed to start; logs:" >&2
    docker logs "$GATEWAY_NAME" 2>&1 | tail -30 >&2 || true
    exit 1
  fi
}
HTTP_PORT=18080
HTTPS_PORT=18443
start_gateway_e2e "$GATEWAY_DIR"

echo "== UI via nginx (HTTPS) =="
ui_ok=0
for _ in $(seq 1 30); do
  if docker exec "$GATEWAY_NAME" wget -qO- --no-check-certificate \
    --header "Host: testnet.trustless-commerce.com" \
    "https://127.0.0.1/" 2>/dev/null | grep -qi trustless; then
    ui_ok=1
    break
  fi
  sleep 1
done
[[ "$ui_ok" -eq 1 ]] || {
  echo "UI smoke failed; nginx logs:" >&2
  docker logs --tail=40 "$GATEWAY_NAME" 2>&1 >&2 || true
  exit 1
}

gw_health="$(docker exec "$GATEWAY_NAME" wget -qO- --no-check-certificate \
  --header "Host: testnet.trustless-commerce.com" \
  "https://127.0.0.1/api/health" 2>/dev/null || true)"
assert_contains "$gw_health" '"ok": true'

echo ""
echo "INFRA DEPLOY E2E OK (api + nodes + gateway on Hardhat fork)"
