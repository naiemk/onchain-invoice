#!/usr/bin/env bash
# Digest-gated nginx gateway update.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# shellcheck source=lib-env.sh
source "$SCRIPT_DIR/lib-env.sh"
load_dotenv .env

UPDATE=0
role_auto_update_on GATEWAY_AUTO_UPDATE && UPDATE=1
if [[ "$UPDATE" -eq 0 ]]; then
  exit 0
fi
if ! command -v docker >/dev/null 2>&1; then
  log_update "$SCRIPT_DIR" "gateway: docker not found"
  exit 1
fi

run_gateway_update() {
  local image name stop_timeout pull_status
  image="${NGINX_IMAGE:-nginx:alpine}"
  name="${GATEWAY_NAME:-app-gateway}"
  stop_timeout="${GATEWAY_STOP_TIMEOUT:-30}"
  if [[ "$image" == *:local ]]; then
    log_update "$SCRIPT_DIR" "gateway: $image — skipped pull (local tag)"
  else
    pull_status="$(pull_image_if_needed "$image")"
    log_update "$SCRIPT_DIR" "gateway: $image — $pull_status"
  fi
  if ! container_needs_image "$name" "$image"; then
    log_update "$SCRIPT_DIR" "gateway: $name already on latest $image"
  else
    log_update "$SCRIPT_DIR" "gateway: updating $name"
    graceful_stop "$name" "$stop_timeout"
    PULL=0 "$SCRIPT_DIR/start-gateway.sh"
    log_update "$SCRIPT_DIR" "gateway: $name updated"
  fi
  prune_docker_images "$SCRIPT_DIR" "gateway"
}

with_update_lock "$SCRIPT_DIR" "gateway" run_gateway_update
