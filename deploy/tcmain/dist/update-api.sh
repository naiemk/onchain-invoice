#!/usr/bin/env bash
# Pull latest API image and recreate if the digest changed.
# Honors API_AUTO_UPDATE=0|1 (legacy AUTO_UPDATE fallback).
# Host flock + digest-gated pull (see lib-env.sh) — safe on small VPS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# shellcheck source=lib-env.sh
source "$SCRIPT_DIR/lib-env.sh"
load_dotenv .env

if ! role_auto_update_on API_AUTO_UPDATE; then
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  log_update "$SCRIPT_DIR" "api: docker not found"
  exit 1
fi

run_api_update() {
  CONFIG="${ONCHAIN_INVOICE_API_CONFIG:-${CONFIG_FILE:-api-app.yaml}}"
  IMAGE="${BACKEND_IMAGE:-ghcr.io/naiemk/trustless-commerce-api:main}"
  NAME="${DOCKER_NAME:-app-api}"
  if [[ -f "$CONFIG" ]]; then
    # Prefer top-level image: (vibed api-app) or docker.image (legacy).
    yaml_image="$(python3 - "$CONFIG" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read().splitlines()
for line in text:
    s = line.strip()
    if s.startswith("image:"):
        v = s.split(":", 1)[1].strip().strip('"').strip("'")
        print(v)
        break
PY
)"
    if [[ -n "$yaml_image" && -z "${BACKEND_IMAGE:-}" ]]; then
      IMAGE="$yaml_image"
    fi
  fi
  IMAGE="${BACKEND_IMAGE:-${IMAGE:-ghcr.io/naiemk/trustless-commerce-api:main}}"
  NAME="${DOCKER_NAME:-${NAME:-app-api}}"
  STOP_TIMEOUT="${API_STOP_TIMEOUT:-${STOP_TIMEOUT:-120}}"

  pull_status="$(pull_image_if_needed "$IMAGE")"
  log_update "$SCRIPT_DIR" "api: $IMAGE — $pull_status"

  if ! container_needs_image "$NAME" "$IMAGE"; then
    log_update "$SCRIPT_DIR" "api: $NAME already on latest $IMAGE"
    if declare -F prune_docker_images >/dev/null 2>&1; then
      prune_docker_images "$SCRIPT_DIR" "api"
    fi
    return 0
  fi

  log_update "$SCRIPT_DIR" "api: updating $NAME (stop -t $STOP_TIMEOUT, recreate)"
  graceful_stop "$NAME" "$STOP_TIMEOUT"
  PULL=0 ONCHAIN_INVOICE_SKIP_PULL=1 "$SCRIPT_DIR/start-api.sh"
  log_update "$SCRIPT_DIR" "api: $NAME updated"
  if declare -F prune_docker_images >/dev/null 2>&1; then
    prune_docker_images "$SCRIPT_DIR" "api"
  fi
}

with_update_lock "$SCRIPT_DIR" "api" run_api_update
