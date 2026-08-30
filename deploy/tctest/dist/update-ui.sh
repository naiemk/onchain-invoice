#!/usr/bin/env bash
# Digest-gated UI update.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# shellcheck source=lib-env.sh
source "$SCRIPT_DIR/lib-env.sh"
load_dotenv .env

if ! role_auto_update_on UI_AUTO_UPDATE; then
  exit 0
fi
if ! command -v docker >/dev/null 2>&1; then
  log_update "$SCRIPT_DIR" "ui: docker not found"
  exit 1
fi

run_ui_update() {
  local image name stop_timeout pull_status
  image="${UI_IMAGE:-ghcr.io/example/ui:main}"
  name="${UI_NAME:-app-ui}"
  stop_timeout="${UI_STOP_TIMEOUT:-30}"
  if [[ "$image" == *:local ]]; then
    log_update "$SCRIPT_DIR" "ui: $image — skipped pull (local tag)"
  else
    pull_status="$(pull_image_if_needed "$image")"
    log_update "$SCRIPT_DIR" "ui: $image — $pull_status"
  fi
  if ! container_needs_image "$name" "$image"; then
    log_update "$SCRIPT_DIR" "ui: $name already on latest $image"
  else
    log_update "$SCRIPT_DIR" "ui: updating $name"
    graceful_stop "$name" "$stop_timeout"
    PULL=0 "$SCRIPT_DIR/start-ui.sh"
    log_update "$SCRIPT_DIR" "ui: $name updated"
  fi
  prune_docker_images "$SCRIPT_DIR" "ui"
}

with_update_lock "$SCRIPT_DIR" "ui" run_ui_update
