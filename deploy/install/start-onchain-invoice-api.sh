#!/usr/bin/env bash
# Start Trustless Commerce API from onchain-invoice-api.yaml (pulls the configured image).
set -euo pipefail

CONFIG="${ONCHAIN_INVOICE_API_CONFIG:-onchain-invoice-api.yaml}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

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

IMAGE="$(yaml_get docker.image)"
NAME="$(yaml_get docker.name)"
HOST_PORT="$(yaml_get docker.port)"
DATA_DIR="$(yaml_get docker.dataDir)"
RESTART="$(yaml_get docker.restart)"

IMAGE="${IMAGE:-ghcr.io/naiemk/trustless-commerce-api:main}"
NAME="${NAME:-onchain-invoice-api}"
HOST_PORT="${HOST_PORT:-8080}"
DATA_DIR="${DATA_DIR:-./data/onchain-invoice-api}"
RESTART="${RESTART:-unless-stopped}"

mkdir -p "$DATA_DIR"
CONFIG_ABS="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")"
DATA_ABS="$(cd "$DATA_DIR" && pwd)"

echo "Pulling $IMAGE ..."
docker pull "$IMAGE"

if docker inspect "$NAME" >/dev/null 2>&1; then
  echo "Removing existing container $NAME ..."
  docker rm -f "$NAME" >/dev/null
fi

echo "Starting $NAME (host port $HOST_PORT) ..."
docker run -d \
  --name "$NAME" \
  --restart "$RESTART" \
  -p "${HOST_PORT}:8080" \
  -e CONFIG_PATH=/config/server.yaml \
  -e DB_PATH=/data/trustless-commerce.db \
  -e BASE_URL="${BASE_URL:-http://localhost:${HOST_PORT}}" \
  -e ADMIN_API_KEY="${ADMIN_API_KEY:-}" \
  -e SWEEPER_API_KEY="${SWEEPER_API_KEY:-}" \
  -e EVM_RPC_URL="${EVM_RPC_URL:-}" \
  -e SWEEPER_ADDRESS="${SWEEPER_ADDRESS:-}" \
  -e FORWARDER_IMPLEMENTATION="${FORWARDER_IMPLEMENTATION:-}" \
  -e CORS_ORIGINS="${CORS_ORIGINS:-*}" \
  -v "$CONFIG_ABS:/config/server.yaml:ro" \
  -v "$DATA_ABS:/data" \
  "$IMAGE"

echo "API listening on http://localhost:${HOST_PORT} (container $NAME)"
echo "Health: curl -s http://localhost:${HOST_PORT}/api/health"
