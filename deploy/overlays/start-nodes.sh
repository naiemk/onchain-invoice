#!/usr/bin/env bash
# Start Trustless Commerce sweeper node(s) from nodes-workers.yaml (vibed-infra 0.8 overlay).
set -euo pipefail

CONFIG="${ONCHAIN_INVOICE_NODES_CONFIG:-${CONFIG_FILE:-nodes-workers.yaml}}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# shellcheck source=lib-env.sh
[[ -f lib-env.sh ]] && source lib-env.sh && load_dotenv .env

# Load .env when unset or empty (blank shell exports must not block defaults).
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
  echo "Missing $CONFIG — run install-nodes.sh first." >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

yaml_get() {
  local path="$1"
  python3 - "$CONFIG" "$path" <<'PY'
import sys
path = sys.argv[2].split(".")
text = open(sys.argv[1], encoding="utf-8").read().splitlines()
root = {}
stack = [(-1, root)]
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
RESTART="$(yaml_get docker.restart)"
# Top-level image: from vibed nodes-workers (opaque config has no docker: block).
if [[ -z "$IMAGE" ]]; then
  IMAGE="$(yaml_get image)"
fi

export SWEEPER_IMAGE="${SWEEPER_IMAGE:-${WORKER_IMAGE:-${IMAGE:-ghcr.io/naiemk/trustless-commerce-sweeper:main}}}"
IMAGE="$SWEEPER_IMAGE"
NAME="${NAME:-onchain-invoice-node}"
RESTART="${RESTART:-unless-stopped}"
APP_PREFIX="${APP_PREFIX:-}"
DOCKER_NETWORK="${DOCKER_NETWORK:-vps-edge}"

CONFIG_ABS="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")"

# Extra hosts so serverUrl: http://host.docker.internal:8080 works on Linux.
EXTRA_HOSTS=(--add-host=host.docker.internal:host-gateway)

# Prefer SERVER_URL; fall back to API_URL for operators who only set one.
if [[ -z "${SERVER_URL:-}" && -n "${API_URL:-}" ]]; then
  SERVER_URL="$API_URL"
  export SERVER_URL
fi

# Memory cap for single-container (non-compose) path; compose uses SWEEPER_MEMORY_LIMIT via yml.
SWEEPER_MEMORY_LIMIT="${SWEEPER_MEMORY_LIMIT:-192m}"

# Solana compose profile — off unless explicitly enabled (saves RAM on small VPS).
solana_enabled=0
case "${SWEEPER_SOLANA_ENABLED:-0}" in
  1|true|TRUE|yes|YES|on|ON) solana_enabled=1 ;;
esac

# Product-aware solana container name.
if [[ -n "$APP_PREFIX" ]]; then
  SOLANA_CONTAINER="${SOLANA_CONTAINER:-${APP_PREFIX}-sweeper-solana}"
else
  SOLANA_CONTAINER="${SOLANA_CONTAINER:-onchain-invoice-sweeper-solana}"
fi

# Fail fast: ethers crashes with a redacted "invalid private key" if these are empty/malformed.
# Allow operator placeholder `_PRIVATE_KEY_` so mainnet can be staged before keys are filled
# (sweeper soft-skips until a real 64-hex key is set).
pk="${SWEEPER_WALLET_KEY:-${SWEEPER_PRIVATE_KEY:-}}"
pk="${pk#0x}"
if [[ "$pk" == "_PRIVATE_KEY_" ]]; then
  echo "warning: SWEEPER_WALLET_KEY / SWEEPER_PRIVATE_KEY is still _PRIVATE_KEY_ — sweepers will soft-skip until you set real keys." >&2
elif [[ ! "$pk" =~ ^[0-9a-fA-F]{64}$ ]]; then
  echo "Invalid or missing SWEEPER_WALLET_KEY / SWEEPER_PRIVATE_KEY in .env (need 64 hex chars, optional 0x, or _PRIVATE_KEY_ placeholder)." >&2
  echo "Unset any empty exports (unset SWEEPER_WALLET_KEY SWEEPER_PRIVATE_KEY) and ensure .env has a key." >&2
  exit 1
fi

ACTIVITY_LOG_PATH="${ACTIVITY_LOG_PATH:-/data/logs/activity.jsonl}"
LOGS_DIR="${LOGS_DIR:-./logs}"
mkdir -p "$LOGS_DIR"
LOGS_ABS="$(cd "$LOGS_DIR" && pwd)"
# Image runs as USER node (uid/gid 1000).
chown_uid1000() {
  local path="$1"
  if [[ "$(id -u)" -eq 0 ]]; then
    chown -R 1000:1000 "$path" || true
  elif command -v sudo >/dev/null 2>&1 && sudo -n chown -R 1000:1000 "$path" 2>/dev/null; then
    true
  elif command -v docker >/dev/null 2>&1; then
    docker run --rm -v "$path:/target" alpine:3.20 chown -R 1000:1000 /target
  else
    echo "warning: could not chown $path to 1000:1000 — activity log may fail to write" >&2
  fi
}
chown_uid1000 "$LOGS_ABS"
chmod 755 "$LOGS_ABS" 2>/dev/null || true

COMPOSE_FILE="${COMPOSE_FILE:-${SCRIPT_DIR}/docker-compose.workers.yml}"
# Allow COMPOSE_FILE=docker-compose.workers.yml (relative to install dir)
if [[ "$COMPOSE_FILE" != /* ]]; then
  COMPOSE_FILE="${SCRIPT_DIR}/${COMPOSE_FILE}"
fi
if [[ -f "$COMPOSE_FILE" && "${USE_COMPOSE:-1}" != "0" ]]; then
  if [[ "${ONCHAIN_INVOICE_SKIP_PULL:-}" == "1" || "${PULL:-1}" == "0" ]]; then
    echo "Skipping docker pull ($IMAGE)"
    PULL_ARGS=(--pull never)
  else
    echo "Pulling $IMAGE ..."
    docker pull "$IMAGE"
    PULL_ARGS=()
  fi

  # Stop legacy single container if present
  if docker inspect onchain-invoice-node >/dev/null 2>&1; then
    echo "Removing legacy container onchain-invoice-node ..."
    docker rm -f onchain-invoice-node >/dev/null || true
  fi

  # Materialize .env.runtime: blank operator placeholders so current images soft-skip
  # until real keys are filled in .env (keeps `_PRIVATE_KEY_` visible in .env for operators).
  if [[ -f .env ]]; then
    sed -E \
      -e 's/^(SWEEPER_WALLET_KEY|SWEEPER_PRIVATE_KEY|TRON_SPONSOR_PRIVATE_KEY|SOLANA_SWEEPER_KEY|TRON_INVOICE_MASTER_SECRET|BUNDLER_WALLET_KEY|BUNDLER_PRIVATE_KEY|WALLET_DEPLOYER_PRIVATE_KEY)=_PRIVATE_KEY_$/\1=/' \
      -e 's/^(SWEEPER_WALLET_KEY|SWEEPER_PRIVATE_KEY|TRON_SPONSOR_PRIVATE_KEY|SOLANA_SWEEPER_KEY|TRON_INVOICE_MASTER_SECRET|BUNDLER_WALLET_KEY|BUNDLER_PRIVATE_KEY|WALLET_DEPLOYER_PRIVATE_KEY)=change-me.*$/\1=/' \
      .env > .env.runtime
  fi

  COMPOSE_ARGS=(-f "$COMPOSE_FILE")
  if [[ "$solana_enabled" -eq 1 ]]; then
    COMPOSE_ARGS+=(--profile solana)
  else
    # Ensure idle solana is not left running when disabled.
    if docker inspect "$SOLANA_CONTAINER" >/dev/null 2>&1; then
      echo "SWEEPER_SOLANA_ENABLED off — removing $SOLANA_CONTAINER ..."
      docker rm -f "$SOLANA_CONTAINER" >/dev/null || true
    fi
  fi

  echo "Starting nodes via $COMPOSE_FILE (sweepers + bundler + wallet-deployer, memory ${SWEEPER_MEMORY_LIMIT}) ..."
  docker network create "$DOCKER_NETWORK" >/dev/null 2>&1 || true
  export DOCKER_NETWORK
  export SWEEPER_IMAGE
  # Isolate compose project names when multiple products share one host.
  export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-${APP_PREFIX:-nodes}-nodes}"
  if [[ "$solana_enabled" -eq 1 ]]; then
    echo "  (Solana profile enabled)"
  fi
  if [[ -f .env.runtime ]]; then
    docker compose "${COMPOSE_ARGS[@]}" --env-file .env.runtime up -d --force-recreate "${PULL_ARGS[@]}"
  else
    docker compose "${COMPOSE_ARGS[@]}" up -d --force-recreate "${PULL_ARGS[@]}"
  fi
  echo "Nodes up (container names from $COMPOSE_FILE)"
  echo "  Register bundler once: ./register-onchain-invoice-bundler.sh"
  if [[ "$solana_enabled" -eq 1 ]]; then
    echo "Activity: tail -f $LOGS_ABS/activity-evm.jsonl $LOGS_ABS/activity-tron.jsonl $LOGS_ABS/activity-solana.jsonl $LOGS_ABS/activity-bundler.jsonl $LOGS_ABS/activity-wallet-deployer.jsonl"
  else
    echo "Activity: tail -f $LOGS_ABS/activity-evm.jsonl $LOGS_ABS/activity-tron.jsonl $LOGS_ABS/activity-bundler.jsonl $LOGS_ABS/activity-wallet-deployer.jsonl"
    echo "(Solana sweeper off — set SWEEPER_SOLANA_ENABLED=1 to start)"
  fi
  exit 0
fi

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

add_env SERVER_URL "${SERVER_URL:-}"
add_env SWEEPER_WALLET_KEY "${SWEEPER_WALLET_KEY:-}"
add_env SWEEPER_API_KEY "${SWEEPER_API_KEY:-}"
add_env SWEEPER_ADDRESS "${SWEEPER_ADDRESS:-}"
add_env SWEEPER_PRIVATE_KEY "${SWEEPER_PRIVATE_KEY:-}"
add_env EVM_RPC_URL "${EVM_RPC_URL:-}"
add_env EVM_8453_RPC_URL "${EVM_8453_RPC_URL:-}"
add_env EVM_8453_SWEEPER_ADDRESS "${EVM_8453_SWEEPER_ADDRESS:-}"
add_env EVM_56_RPC_URL "${EVM_56_RPC_URL:-}"
add_env EVM_56_SWEEPER_ADDRESS "${EVM_56_SWEEPER_ADDRESS:-}"
add_env TRON_CHAIN_ID "${TRON_CHAIN_ID:-}"
add_env TRON_FULL_HOST "${TRON_FULL_HOST:-}"
add_env TRON_INVOICE_MASTER_SECRET "${TRON_INVOICE_MASTER_SECRET:-}"
add_env TRON_USDT_ADDRESS "${TRON_USDT_ADDRESS:-}"
add_env TRON_SPONSOR_PRIVATE_KEY "${TRON_SPONSOR_PRIVATE_KEY:-}"
add_env SOLANA_RPC_URL "${SOLANA_RPC_URL:-}"
add_env SOLANA_PROGRAM_ID "${SOLANA_PROGRAM_ID:-}"
add_env SOLANA_USDC_MINT "${SOLANA_USDC_MINT:-}"
add_env SOLANA_USDT_MINT "${SOLANA_USDT_MINT:-}"
add_env SOLANA_SWEEPER_KEY "${SOLANA_SWEEPER_KEY:-}"
add_env SOLANA_FEE_RECIPIENT "${SOLANA_FEE_RECIPIENT:-}"
add_env SOLANA_MAINNET_RPC_URL "${SOLANA_MAINNET_RPC_URL:-}"
add_env SOLANA_MAINNET_PROGRAM_ID "${SOLANA_MAINNET_PROGRAM_ID:-}"
add_env ACTIVITY_LOG_PATH "$ACTIVITY_LOG_PATH"

# Config lands in /tmp (image has no /config dir; docker cp avoids host bind-mounts).
SWEEPER_CONFIG_IN_CONTAINER=/tmp/sweeper.yaml

MEM_ARGS=()
if [[ -n "$SWEEPER_MEMORY_LIMIT" ]]; then
  MEM_ARGS+=(--memory="$SWEEPER_MEMORY_LIMIT")
fi

echo "Creating $NAME (memory ${SWEEPER_MEMORY_LIMIT:-unlimited}) ..."
docker create \
  --name "$NAME" \
  --restart "$RESTART" \
  "${MEM_ARGS[@]}" \
  "${EXTRA_HOSTS[@]}" \
  -v "${LOGS_ABS}:/data/logs" \
  -e SWEEPER_CONFIG="$SWEEPER_CONFIG_IN_CONTAINER" \
  "${env_args[@]}" \
  "$IMAGE" >/dev/null

echo "Copying config into $NAME ..."
docker cp "$CONFIG_ABS" "$NAME:$SWEEPER_CONFIG_IN_CONTAINER"

echo "Starting $NAME ..."
docker start "$NAME" >/dev/null

echo "Sweeper node running as $NAME"
echo "Logs: docker logs -f $NAME"
echo "Activity: tail -f $LOGS_ABS/activity.jsonl"
