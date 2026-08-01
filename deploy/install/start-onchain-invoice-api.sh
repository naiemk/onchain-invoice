#!/usr/bin/env bash
# Start Trustless Commerce API from onchain-invoice-api.yaml (pulls the configured image).
set -euo pipefail

CONFIG="${ONCHAIN_INVOICE_API_CONFIG:-onchain-invoice-api.yaml}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

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
env_args=()
add_env() {
  local name="$1"
  local value="${2-}"
  if [[ -n "$value" ]]; then
    env_args+=(-e "${name}=${value}")
  fi
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
add_env CORS_ORIGINS "${CORS_ORIGINS:-}"

NET_ARGS=()
if [[ -n "$DOCKER_NETWORK" ]]; then
  docker network create "$DOCKER_NETWORK" >/dev/null 2>&1 || true
  NET_ARGS+=(--network "$DOCKER_NETWORK")
  echo "Docker network: $DOCKER_NETWORK"
fi

echo "Creating $NAME (host port $HOST_PORT) ..."
docker create \
  --name "$NAME" \
  --restart "$RESTART" \
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
