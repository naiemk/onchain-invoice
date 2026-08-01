#!/usr/bin/env bash
# Start Trustless Commerce sweeper node(s) from onchain-invoice-nodes.yaml (pulls the configured image).
set -euo pipefail

CONFIG="${ONCHAIN_INVOICE_NODES_CONFIG:-onchain-invoice-nodes.yaml}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env for unset vars only (existing exports win).
if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    key="${key%%[[:space:]]*}"
    key="${key##[[:space:]]*}"
    [[ -z "$key" || "$key" == *[!A-Za-z0-9_]* ]] && continue
    if [[ -z "${!key+x}" ]]; then
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

IMAGE="${IMAGE:-ghcr.io/naiemk/trustless-commerce-sweeper:main}"
NAME="${NAME:-onchain-invoice-node}"
RESTART="${RESTART:-unless-stopped}"

CONFIG_ABS="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")"

# Extra hosts so serverUrl: http://host.docker.internal:8080 works on Linux.
EXTRA_HOSTS=(--add-host=host.docker.internal:host-gateway)

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

# Prefer SERVER_URL; fall back to API_URL for operators who only set one.
if [[ -z "${SERVER_URL:-}" && -n "${API_URL:-}" ]]; then
  SERVER_URL="$API_URL"
fi

add_env SERVER_URL "${SERVER_URL:-}"
add_env SWEEPER_WALLET_KEY "${SWEEPER_WALLET_KEY:-}"
add_env SWEEPER_API_KEY "${SWEEPER_API_KEY:-}"
add_env SWEEPER_ADDRESS "${SWEEPER_ADDRESS:-}"
add_env SWEEPER_PRIVATE_KEY "${SWEEPER_PRIVATE_KEY:-}"
add_env EVM_RPC_URL "${EVM_RPC_URL:-}"

# Config lands in /tmp (image has no /config dir; docker cp avoids host bind-mounts).
SWEEPER_CONFIG_IN_CONTAINER=/tmp/sweeper.yaml

echo "Creating $NAME ..."
docker create \
  --name "$NAME" \
  --restart "$RESTART" \
  "${EXTRA_HOSTS[@]}" \
  -e SWEEPER_CONFIG="$SWEEPER_CONFIG_IN_CONTAINER" \
  "${env_args[@]}" \
  "$IMAGE" >/dev/null

echo "Copying config into $NAME ..."
docker cp "$CONFIG_ABS" "$NAME:$SWEEPER_CONFIG_IN_CONTAINER"

echo "Starting $NAME ..."
docker start "$NAME" >/dev/null

echo "Sweeper node running as $NAME"
echo "Logs: docker logs -f $NAME"
