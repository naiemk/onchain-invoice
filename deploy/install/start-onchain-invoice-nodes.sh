#!/usr/bin/env bash
# Start Trustless Commerce sweeper node(s) from onchain-invoice-nodes.yaml (pulls the configured image).
set -euo pipefail

CONFIG="${ONCHAIN_INVOICE_NODES_CONFIG:-onchain-invoice-nodes.yaml}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

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

IMAGE="$(yaml_get docker.image)"
NAME="$(yaml_get docker.name)"
RESTART="$(yaml_get docker.restart)"

IMAGE="${IMAGE:-ghcr.io/naiemk/trustless-commerce-sweeper:main}"
NAME="${NAME:-onchain-invoice-node}"
RESTART="${RESTART:-unless-stopped}"

CONFIG_ABS="$(cd "$(dirname "$CONFIG")" && pwd)/$(basename "$CONFIG")"

# Extra hosts so serverUrl: http://host.docker.internal:8080 works on Linux.
EXTRA_HOSTS=(--add-host=host.docker.internal:host-gateway)

echo "Pulling $IMAGE ..."
docker pull "$IMAGE"

if docker inspect "$NAME" >/dev/null 2>&1; then
  echo "Removing existing container $NAME ..."
  docker rm -f "$NAME" >/dev/null
fi

echo "Starting $NAME ..."
docker run -d \
  --name "$NAME" \
  --restart "$RESTART" \
  "${EXTRA_HOSTS[@]}" \
  -e SWEEPER_CONFIG=/config/sweeper.yaml \
  -e SERVER_URL="${SERVER_URL:-}" \
  -e SWEEPER_WALLET_KEY="${SWEEPER_WALLET_KEY:-}" \
  -e SWEEPER_API_KEY="${SWEEPER_API_KEY:-}" \
  -e SWEEPER_ADDRESS="${SWEEPER_ADDRESS:-}" \
  -e SWEEPER_PRIVATE_KEY="${SWEEPER_PRIVATE_KEY:-}" \
  -e EVM_RPC_URL="${EVM_RPC_URL:-}" \
  -v "$CONFIG_ABS:/config/sweeper.yaml:ro" \
  "$IMAGE"

echo "Sweeper node running as $NAME"
echo "Logs: docker logs -f $NAME"
