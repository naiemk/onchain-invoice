#!/usr/bin/env bash
# Pull latest sweeper image and recreate node(s) if the digest changed.
# Honors NODES_AUTO_UPDATE=0|1 (legacy AUTO_UPDATE fallback).
# Prefers docker-compose.sweepers.yml (evm + tron) when present.
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
COMPOSE_FILE="$SCRIPT_DIR/docker-compose.sweepers.yml"
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
export SWEEPER_IMAGE="$IMAGE"

if [[ -f "$COMPOSE_FILE" ]]; then
  needs=0
  for cname in onchain-invoice-sweeper-evm onchain-invoice-sweeper-tron; do
    if container_needs_image "$cname" "$IMAGE"; then
      needs=1
      break
    fi
    # Also recreate if container missing
    if ! docker inspect "$cname" >/dev/null 2>&1; then
      needs=1
      break
    fi
  done
  if [[ "$needs" -eq 0 ]]; then
    log_update "$SCRIPT_DIR" "nodes: compose sweepers already on latest $IMAGE"
    exit 0
  fi
  log_update "$SCRIPT_DIR" "nodes: updating compose sweepers (stop -t $STOP_TIMEOUT, recreate)"
  for cname in onchain-invoice-sweeper-evm onchain-invoice-sweeper-tron; do
    if docker inspect "$cname" >/dev/null 2>&1; then
      graceful_stop "$cname" "$STOP_TIMEOUT"
    fi
  done
  PULL=0 ONCHAIN_INVOICE_SKIP_PULL=1 "$SCRIPT_DIR/start-onchain-invoice-nodes.sh"
  log_update "$SCRIPT_DIR" "nodes: compose sweepers updated"
  exit 0
fi

if ! container_needs_image "$NAME" "$IMAGE"; then
  log_update "$SCRIPT_DIR" "nodes: $NAME already on latest $IMAGE"
  exit 0
fi

log_update "$SCRIPT_DIR" "nodes: updating $NAME (stop -t $STOP_TIMEOUT, recreate)"
graceful_stop "$NAME" "$STOP_TIMEOUT"
PULL=0 ONCHAIN_INVOICE_SKIP_PULL=1 USE_COMPOSE=0 "$SCRIPT_DIR/start-onchain-invoice-nodes.sh"
log_update "$SCRIPT_DIR" "nodes: $NAME updated"
