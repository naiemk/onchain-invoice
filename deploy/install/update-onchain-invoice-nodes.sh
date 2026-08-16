#!/usr/bin/env bash
# Pull latest sweeper image and recreate node(s) if the digest changed.
# Honors NODES_AUTO_UPDATE=0|1 (legacy AUTO_UPDATE fallback).
#
# Compose file selection (first match):
#   1. COMPOSE_FILE from .env (absolute or relative to this dir)
#   2. docker-compose.sweepers-mainnet.yml (mainnet-sweeper-*)
#   3. docker-compose.sweepers.yml (onchain-invoice-sweeper-*)
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

resolve_compose_file() {
  local candidate="${COMPOSE_FILE:-}"
  if [[ -n "$candidate" ]]; then
    if [[ "$candidate" != /* ]]; then
      candidate="${SCRIPT_DIR}/${candidate}"
    fi
    if [[ -f "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  fi
  if [[ -f "${SCRIPT_DIR}/docker-compose.sweepers-mainnet.yml" ]]; then
    echo "${SCRIPT_DIR}/docker-compose.sweepers-mainnet.yml"
    return 0
  fi
  if [[ -f "${SCRIPT_DIR}/docker-compose.sweepers.yml" ]]; then
    echo "${SCRIPT_DIR}/docker-compose.sweepers.yml"
    return 0
  fi
  echo ""
}

compose_container_names() {
  local file="$1"
  python3 - "$file" <<'PY'
import re, sys
path = sys.argv[1]
names = []
for line in open(path, encoding="utf-8"):
    m = re.match(r"\s*container_name:\s*([^\s#]+)", line)
    if m:
        names.append(m.group(1).strip().strip('"').strip("'"))
print("\n".join(names))
PY
}

log_update "$SCRIPT_DIR" "nodes: pulling $IMAGE"
docker pull "$IMAGE" >/dev/null
export SWEEPER_IMAGE="$IMAGE"

COMPOSE_PATH="$(resolve_compose_file)"
if [[ -n "$COMPOSE_PATH" ]]; then
  mapfile -t CONTAINERS < <(compose_container_names "$COMPOSE_PATH")
  if [[ ${#CONTAINERS[@]} -eq 0 ]]; then
    log_update "$SCRIPT_DIR" "nodes: no container_name entries in $COMPOSE_PATH"
    exit 1
  fi

  needs=0
  for cname in "${CONTAINERS[@]}"; do
    if container_needs_image "$cname" "$IMAGE"; then
      needs=1
      break
    fi
    if ! docker inspect "$cname" >/dev/null 2>&1; then
      needs=1
      break
    fi
  done
  if [[ "$needs" -eq 0 ]]; then
    log_update "$SCRIPT_DIR" "nodes: compose sweepers already on latest $IMAGE ($(basename "$COMPOSE_PATH"))"
    exit 0
  fi

  log_update "$SCRIPT_DIR" "nodes: updating compose sweepers via $(basename "$COMPOSE_PATH") (stop -t $STOP_TIMEOUT)"
  for cname in "${CONTAINERS[@]}"; do
    if docker inspect "$cname" >/dev/null 2>&1; then
      graceful_stop "$cname" "$STOP_TIMEOUT"
    fi
  done
  # Ensure start script uses the same compose file we inspected.
  export COMPOSE_FILE="$COMPOSE_PATH"
  PULL=0 ONCHAIN_INVOICE_SKIP_PULL=1 "$SCRIPT_DIR/start-onchain-invoice-nodes.sh"
  log_update "$SCRIPT_DIR" "nodes: compose sweepers updated (${CONTAINERS[*]})"
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
