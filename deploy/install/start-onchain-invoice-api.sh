#!/usr/bin/env bash
# Start Trustless Commerce API from onchain-invoice-api.yaml (pulls the configured image).
# Optional: USE_COMPOSE=1 with docker-compose.backend.yml (infra packager).
set -euo pipefail

CONFIG="${ONCHAIN_INVOICE_API_CONFIG:-onchain-invoice-api.yaml}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -f docker-compose.backend.yml && "${USE_COMPOSE:-0}" == "1" ]]; then
  # shellcheck source=lib-env.sh
  [[ -f lib-env.sh ]] && source lib-env.sh && load_dotenv .env
  export BACKEND_IMAGE="${BACKEND_IMAGE:-${API_IMAGE:-ghcr.io/naiemk/trustless-commerce-api:main}}"
  export CONFIG_FILE="$CONFIG"
  export DATA_DIR="${DATA_DIR:-./data/onchain-invoice-api}"
  export HOST_PORT="${HOST_PORT:-8080}"
  docker compose -f docker-compose.backend.yml up -d --force-recreate
  exit 0
fi

# Load .env when unset or empty (blank shell exports must not block defaults).
if [[ -f .env ]]; then
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

IMAGE="$(yaml_get docker.image)"
NAME="$(yaml_get docker.name)"
HOST_PORT="$(yaml_get docker.port)"
DATA_DIR="$(yaml_get docker.dataDir)"
RESTART="$(yaml_get docker.restart)"

IMAGE="${IMAGE:-ghcr.io/naiemk/trustless-commerce-api:main}"
# DOCKER_NAME overrides yaml (use testnet-api / mainnet-api for HTTPS gateway).
NAME="${DOCKER_NAME:-${NAME:-onchain-invoice-api}}"
HOST_PORT="${HOST_PORT:-8080}"
DATA_DIR="${DATA_DIR:-./data/onchain-invoice-api}"
RESTART="${RESTART:-unless-stopped}"
DOCKER_NETWORK="${DOCKER_NETWORK:-}"
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
VOLUME_ARGS=()
if [[ "${ONCHAIN_INVOICE_SKIP_HOST_MOUNTS:-}" == "1" ]]; then
  DATA_VOLUME="${NAME}-data"
  docker volume create "$DATA_VOLUME" >/dev/null
  VOLUME_ARGS+=(-v "${DATA_VOLUME}:/data")
else
  mkdir -p "$DATA_DIR"
  DATA_ABS="$(cd "$DATA_DIR" && pwd)"
  # Image runs as USER node (uid/gid 1000). Root-created bind mounts otherwise cause SQLITE_CANTOPEN.
  if [[ "$(id -u)" -eq 0 ]]; then
    chown -R 1000:1000 "$DATA_ABS" || true
  elif command -v sudo >/dev/null 2>&1; then
    sudo chown -R 1000:1000 "$DATA_ABS" 2>/dev/null || \
      echo "warning: could not chown $DATA_ABS to 1000:1000 — fix if API fails to open SQLite" >&2
  else
    echo "warning: ensure $DATA_ABS is writable by uid 1000 (container user node)" >&2
  fi
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
add_env ONRAMPER_WIDGET_ORIGIN "${ONRAMPER_WIDGET_ORIGIN:-}"
add_env ONRAMPER_FIATS "${ONRAMPER_FIATS:-}"

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

echo "Creating $NAME (host port $HOST_PORT, memory ${API_MEMORY_LIMIT:-unlimited}) ..."
docker create \
  --name "$NAME" \
  --restart "$RESTART" \
  "${MEM_ARGS[@]}" \
  "${NET_ARGS[@]}" \
  -p "${HOST_PORT}:8080" \
  -e CONFIG_PATH=/config/server.yaml \
  -e DB_PATH=/data/trustless-commerce.db \
  "${env_args[@]}" \
  "${VOLUME_ARGS[@]}" \
  "$IMAGE" >/dev/null

echo "Copying config into $NAME ..."
docker cp "$CONFIG_ABS" "$NAME:/config/server.yaml"

echo "Starting $NAME ..."
docker start "$NAME" >/dev/null

echo "API listening on http://localhost:${HOST_PORT} (container $NAME)"
echo "Health: curl -s http://localhost:${HOST_PORT}/api/health"
if [[ -n "$DOCKER_NETWORK" ]]; then
  echo "On network $DOCKER_NETWORK as hostname $NAME (use with install-gateway.sh)"
fi
