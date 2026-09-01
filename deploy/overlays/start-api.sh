#!/usr/bin/env bash
# Start Trustless Commerce API from api-app.yaml (vibed-infra 0.8 overlay).
# Optional: USE_COMPOSE=1 with docker-compose.backend.yml (infra packager).
set -euo pipefail

CONFIG="${ONCHAIN_INVOICE_API_CONFIG:-${CONFIG_FILE:-api-app.yaml}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# shellcheck source=lib-env.sh
[[ -f lib-env.sh ]] && source lib-env.sh && load_dotenv .env

if [[ -f docker-compose.backend.yml && "${USE_COMPOSE:-0}" == "1" ]]; then
  export BACKEND_IMAGE="${BACKEND_IMAGE:-${API_IMAGE:-ghcr.io/naiemk/trustless-commerce-api:main}}"
  export CONFIG_FILE="$CONFIG"
  export DATA_DIR="${DATA_DIR:-./data}"
  export HOST_PORT="${HOST_PORT:-0}"
  docker compose -f docker-compose.backend.yml up -d --force-recreate
  exit 0
fi

# Load .env when unset or empty (blank shell exports must not block defaults).
# Prefer lib-env.sh load_dotenv when available; otherwise inline parse.
if [[ ! -f lib-env.sh ]] && [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    key="${key%%[[:space:]]*}"
    key="${key##[[:space:]]*}"
    key="${key%$'\r'}"
    val="${val%$'\r'}"
    if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
    if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    [[ -z "$key" || "$key" == *[!A-Za-z0-9_]* ]] && continue
    if [[ -z "${!key-}" ]]; then
      export "$key=$val"
    fi
  done < .env
fi

if [[ ! -f "$CONFIG" ]]; then
  echo "Missing $CONFIG — run install-api.sh first." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

yaml_get() {
  # Top-level or docker.<key> via python3 (stdlib only).
  local path="$1"
  python3 - "$CONFIG" "$path" <<'PY'
import sys
path = sys.argv[2].split(".")
text = open(sys.argv[1], encoding="utf-8").read().splitlines()
# Minimal nested map parser for this config shape (no multi-doc, no anchors).
root = {}
stack = [( -1, root )]
for line in text:
    if not line.strip() or line.lstrip().startswith("#"):
        continue
    indent = len(line) - len(line.lstrip(" "))
    while stack and indent <= stack[-1][0]:
        stack.pop()
    parent = stack[-1][1]
    if ":" not in line:
        continue
    key, _, rest = line.lstrip().partition(":")
    key = key.strip()
    rest = rest.strip()
    if rest == "":
        child = {}
        parent[key] = child
        stack.append((indent, child))
    else:
        if (rest.startswith('"') and rest.endswith('"')) or (rest.startswith("'") and rest.endswith("'")):
            rest = rest[1:-1]
        parent[key] = rest
cur = root
for p in path:
    if not isinstance(cur, dict) or p not in cur:
        print("")
        sys.exit(0)
    cur = cur[p]
if isinstance(cur, dict):
    print("")
else:
    print(cur)
PY
}

# Only pass -e when non-empty so blank env does not override YAML literals.
# Skip `_PRIVATE_KEY_` placeholders so mainnet can boot before chain secrets are filled.
env_args=()
add_env() {
  local name="$1"
  local value="${2-}"
  if [[ -z "$value" || "$value" == "_PRIVATE_KEY_" ]]; then
    return 0
  fi
  env_args+=(-e "${name}=${value}")
}

YAML_IMAGE="$(yaml_get docker.image)"
YAML_NAME="$(yaml_get docker.name)"
YAML_PORT="$(yaml_get docker.port)"
YAML_DATA="$(yaml_get docker.dataDir)"
YAML_RESTART="$(yaml_get docker.restart)"

IMAGE="${BACKEND_IMAGE:-${YAML_IMAGE:-ghcr.io/naiemk/trustless-commerce-api:main}}"
# DOCKER_NAME overrides yaml (tctest-api / tcmain-api for HTTPS gateway).
NAME="${DOCKER_NAME:-${YAML_NAME:-app-api}}"
# Empty or 0 = no host publish (gateway reaches API on DOCKER_NETWORK only).
HOST_PORT="${HOST_PORT:-${YAML_PORT:-}}"
DATA_DIR="${DATA_DIR:-${YAML_DATA:-./data}}"
RESTART="${YAML_RESTART:-unless-stopped}"
DOCKER_NETWORK="${DOCKER_NETWORK:-vps-edge}"
API_MEMORY_LIMIT="${API_MEMORY_LIMIT:-384m}"

CONFIG_ABS="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")"

if [[ "${ONCHAIN_INVOICE_SKIP_PULL:-}" == "1" || "${PULL:-1}" == "0" ]]; then
  echo "Skipping docker pull ($IMAGE)"
else
  echo "Pulling $IMAGE ..."
  docker pull "$IMAGE"
fi

if docker inspect "$NAME" >/dev/null 2>&1; then
  echo "Removing existing container $NAME ..."
  docker rm -f "$NAME" >/dev/null
fi

# Config is docker cp'd (works with remote/DoD Docker where host bind-mounts fail).
# Data: host bind by default; named volume when ONCHAIN_INVOICE_SKIP_HOST_MOUNTS=1.
# Image runs as USER node (uid/gid 1000). Root-created bind mounts otherwise cause SQLITE_CANTOPEN.
chown_uid1000() {
  local path="$1"
  if [[ "$(id -u)" -eq 0 ]]; then
    chown -R 1000:1000 "$path" || true
  elif command -v sudo >/dev/null 2>&1 && sudo -n chown -R 1000:1000 "$path" 2>/dev/null; then
    true
  elif command -v docker >/dev/null 2>&1; then
    docker run --rm -v "$path:/target" alpine:3.20 chown -R 1000:1000 /target
  else
    echo "warning: could not chown $path to 1000:1000 — API may fail to open SQLite" >&2
  fi
}

VOLUME_ARGS=()
if [[ "${ONCHAIN_INVOICE_SKIP_HOST_MOUNTS:-}" == "1" ]]; then
  DATA_VOLUME="${NAME}-data"
  docker volume create "$DATA_VOLUME" >/dev/null
  VOLUME_ARGS+=(-v "${DATA_VOLUME}:/data")
else
  mkdir -p "$DATA_DIR"
  DATA_ABS="$(cd "$DATA_DIR" && pwd)"
  chown_uid1000 "$DATA_ABS"
  chmod 755 "$DATA_ABS" 2>/dev/null || true
  VOLUME_ARGS+=(-v "${DATA_ABS}:/data")
fi

add_env BASE_URL "${BASE_URL:-}"
add_env ADMIN_API_KEY "${ADMIN_API_KEY:-}"
add_env SWEEPER_API_KEY "${SWEEPER_API_KEY:-}"
add_env EVM_RPC_URL "${EVM_RPC_URL:-}"
add_env SWEEPER_ADDRESS "${SWEEPER_ADDRESS:-}"
add_env FORWARDER_IMPLEMENTATION "${FORWARDER_IMPLEMENTATION:-}"
add_env EVM_8453_RPC_URL "${EVM_8453_RPC_URL:-}"
add_env EVM_8453_SWEEPER_ADDRESS "${EVM_8453_SWEEPER_ADDRESS:-}"
add_env EVM_8453_FORWARDER_IMPLEMENTATION "${EVM_8453_FORWARDER_IMPLEMENTATION:-}"
add_env EVM_56_RPC_URL "${EVM_56_RPC_URL:-}"
add_env EVM_56_SWEEPER_ADDRESS "${EVM_56_SWEEPER_ADDRESS:-}"
add_env EVM_56_FORWARDER_IMPLEMENTATION "${EVM_56_FORWARDER_IMPLEMENTATION:-}"
add_env TRON_FULL_HOST "${TRON_FULL_HOST:-}"
add_env TRON_INVOICE_MASTER_SECRET "${TRON_INVOICE_MASTER_SECRET:-}"
add_env TRON_USDT_ADDRESS "${TRON_USDT_ADDRESS:-}"
add_env SOLANA_RPC_URL "${SOLANA_RPC_URL:-}"
add_env SOLANA_PROGRAM_ID "${SOLANA_PROGRAM_ID:-}"
add_env SOLANA_USDC_MINT "${SOLANA_USDC_MINT:-}"
add_env SOLANA_USDT_MINT "${SOLANA_USDT_MINT:-}"
add_env SOLANA_MAINNET_ENABLED "${SOLANA_MAINNET_ENABLED:-}"
add_env SOLANA_MAINNET_RPC_URL "${SOLANA_MAINNET_RPC_URL:-}"
add_env SOLANA_MAINNET_PROGRAM_ID "${SOLANA_MAINNET_PROGRAM_ID:-}"
add_env CORS_ORIGINS "${CORS_ORIGINS:-}"
add_env ONRAMPER_ENABLED "${ONRAMPER_ENABLED:-}"
add_env ONRAMPER_API_KEY "${ONRAMPER_API_KEY:-}"
add_env ONRAMPER_SIGNING_KEY "${ONRAMPER_SIGNING_KEY:-}"
add_env ONRAMPER_WEBHOOK_SECRET "${ONRAMPER_WEBHOOK_SECRET:-}"
add_env ONRAMPER_WIDGET_ORIGIN "${ONRAMPER_WIDGET_ORIGIN:-}"
add_env ONRAMPER_FIATS "${ONRAMPER_FIATS:-}"
add_env WALLET_CHAIN_ID "${WALLET_CHAIN_ID:-}"
add_env WALLET_FACTORY_ADDRESS "${WALLET_FACTORY_ADDRESS:-}"
add_env WALLET_IMPLEMENTATION_ADDRESS "${WALLET_IMPLEMENTATION_ADDRESS:-}"
add_env WALLET_RECOVERY_ADDRESS "${WALLET_RECOVERY_ADDRESS:-}"
add_env WALLET_RECOVERY_TIMELOCK "${WALLET_RECOVERY_TIMELOCK:-}"
add_env WALLET_RPC_URL "${WALLET_RPC_URL:-}"
add_env WALLET_ENTRYPOINT_ADDRESS "${WALLET_ENTRYPOINT_ADDRESS:-}"
add_env WALLET_BUNDLER_FEE_USDC "${WALLET_BUNDLER_FEE_USDC:-}"
add_env WALLET_BUNDLER_BENEFICIARY "${WALLET_BUNDLER_BENEFICIARY:-}"
add_env WALLET_BUNDLER_FEE_TOKEN "${WALLET_BUNDLER_FEE_TOKEN:-}"
add_env WALLET_FEE_TOKEN_SYMBOL "${WALLET_FEE_TOKEN_SYMBOL:-}"
add_env SWEEPER_PRIVATE_KEY "${SWEEPER_PRIVATE_KEY:-}"
add_env FAUCET_ENABLED "${FAUCET_ENABLED:-}"
add_env FAUCET_SECRET "${FAUCET_SECRET:-}"
add_env FAUCET_PRIVATE_KEY "${FAUCET_PRIVATE_KEY:-}"
add_env FAUCET_TRON_PRIVATE_KEY "${FAUCET_TRON_PRIVATE_KEY:-}"
add_env FAUCET_DRY_RUN "${FAUCET_DRY_RUN:-}"

NET_ARGS=()
if [[ -n "$DOCKER_NETWORK" ]]; then
  docker network create "$DOCKER_NETWORK" >/dev/null 2>&1 || true
  NET_ARGS+=(--network "$DOCKER_NETWORK")
  echo "Docker network: $DOCKER_NETWORK"
fi

MEM_ARGS=()
if [[ -n "$API_MEMORY_LIMIT" ]]; then
  MEM_ARGS+=(--memory="$API_MEMORY_LIMIT")
fi

PORT_ARGS=()
if [[ -n "${HOST_PORT}" && "${HOST_PORT}" != "0" ]]; then
  PORT_ARGS+=(-p "${HOST_PORT}:8080")
  echo "Creating $NAME (host port $HOST_PORT, memory ${API_MEMORY_LIMIT:-unlimited}) ..."
else
  echo "Creating $NAME (no host port publish, memory ${API_MEMORY_LIMIT:-unlimited}) ..."
fi

PERSIST_ARGS=()
if [[ -n "${PERSIST_LOG_DIR:-}" ]]; then
  mkdir -p "$PERSIST_LOG_DIR"
  PERSIST_ABS="$(cd "$PERSIST_LOG_DIR" && pwd)"
  chown_uid1000 "$PERSIST_ABS"
  PERSIST_ARGS+=(-e "PERSIST_LOG_DIR=/persist-logs" -v "${PERSIST_ABS}:/persist-logs")
fi

docker create \
  --name "$NAME" \
  --restart "$RESTART" \
  "${MEM_ARGS[@]}" \
  "${NET_ARGS[@]}" \
  "${PORT_ARGS[@]}" \
  -e CONFIG_PATH=/config/server.yaml \
  -e DB_PATH=/data/trustless-commerce.db \
  "${env_args[@]}" \
  "${VOLUME_ARGS[@]}" \
  "${PERSIST_ARGS[@]}" \
  "$IMAGE" >/dev/null

echo "Copying config into $NAME ..."
docker cp "$CONFIG_ABS" "$NAME:/config/server.yaml"

echo "Starting $NAME ..."
docker start "$NAME" >/dev/null

if [[ -n "${HOST_PORT}" && "${HOST_PORT}" != "0" ]]; then
  echo "API listening on http://localhost:${HOST_PORT} (container $NAME)"
  echo "Health: curl -s http://localhost:${HOST_PORT}/api/health"
else
  echo "API running as $NAME (gateway / network only — no host port)"
  echo "Health: docker exec $NAME wget -qO- http://127.0.0.1:8080/api/health"
fi
if [[ -n "$DOCKER_NETWORK" ]]; then
  echo "On network $DOCKER_NETWORK as hostname $NAME (use with install-gateway.sh)"
fi

# After recreate the SQLite DB is empty until wallets are upserted. Nodes live in
# a sibling install dir; skip quietly when that dir is not present yet.
register_sibling_node_wallets() {
  local nodes_dir
  nodes_dir="$(cd "$SCRIPT_DIR/../nodes" 2>/dev/null && pwd)" || return 0
  if [[ ! -x "$nodes_dir/register-onchain-invoice-node.sh" ]]; then
    return 0
  fi
  local i
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    if docker exec "$NAME" wget -qO- http://127.0.0.1:8080/api/health >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  echo "Registering node wallets from $nodes_dir (idempotent) ..."
  (cd "$nodes_dir" && ./register-onchain-invoice-node.sh) || \
    echo "WARNING: sweeper register after API start failed — run $nodes_dir/register-onchain-invoice-node.sh" >&2
  if [[ -x "$nodes_dir/register-onchain-invoice-bundler.sh" ]]; then
    (cd "$nodes_dir" && ./register-onchain-invoice-bundler.sh) || \
      echo "WARNING: bundler register after API start failed — run $nodes_dir/register-onchain-invoice-bundler.sh" >&2
  fi
}
register_sibling_node_wallets
