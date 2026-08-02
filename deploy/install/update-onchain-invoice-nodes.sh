#!/usr/bin/env bash
# Pull latest sweeper image and recreate the node if the digest changed.
# Honors NODES_AUTO_UPDATE=0|1 (legacy AUTO_UPDATE fallback).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# shellcheck source=lib-env.sh
source "$SCRIPT_DIR/lib-env.sh"
load_dotenv .env

if ! role_auto_update_on NODES_AUTO_UPDATE; then
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  log_update "$SCRIPT_DIR" "nodes: docker not found"
  exit 1
fi

CONFIG="${ONCHAIN_INVOICE_NODES_CONFIG:-onchain-invoice-nodes.yaml}"
IMAGE="ghcr.io/naiemk/trustless-commerce-sweeper:main"
NAME="onchain-invoice-node"
if [[ -f "$CONFIG" ]]; then
  IMAGE="$(python3 - "$CONFIG" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read().splitlines()
for line in text:
    s = line.strip()
    if s.startswith("image:"):
        v = s.split(":", 1)[1].strip().strip('"').strip("'")
        print(v)
        break
else:
    print("ghcr.io/naiemk/trustless-commerce-sweeper:main")
PY
)"
  NAME="$(python3 - "$CONFIG" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read().splitlines()
in_docker = False
for line in text:
    if line.startswith("docker:"):
        in_docker = True
        continue
    if in_docker and line.strip() and not line.startswith(" ") and not line.startswith("\t"):
        break
    if in_docker and line.strip().startswith("name:"):
        print(line.split(":", 1)[1].strip().strip('"').strip("'"))
        break
else:
    print("onchain-invoice-node")
PY
)"
fi
IMAGE="${IMAGE:-ghcr.io/naiemk/trustless-commerce-sweeper:main}"
NAME="${NAME:-onchain-invoice-node}"
STOP_TIMEOUT="${NODES_STOP_TIMEOUT:-${STOP_TIMEOUT:-180}}"

log_update "$SCRIPT_DIR" "nodes: pulling $IMAGE"
docker pull "$IMAGE" >/dev/null

if ! container_needs_image "$NAME" "$IMAGE"; then
  log_update "$SCRIPT_DIR" "nodes: $NAME already on latest $IMAGE"
  exit 0
fi

log_update "$SCRIPT_DIR" "nodes: updating $NAME (stop -t $STOP_TIMEOUT, recreate)"
graceful_stop "$NAME" "$STOP_TIMEOUT"
PULL=0 ONCHAIN_INVOICE_SKIP_PULL=1 "$SCRIPT_DIR/start-onchain-invoice-nodes.sh"
log_update "$SCRIPT_DIR" "nodes: $NAME updated"
