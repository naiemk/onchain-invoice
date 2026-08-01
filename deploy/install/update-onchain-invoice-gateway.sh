#!/usr/bin/env bash
# Pull latest UI/nginx images and recreate gateway containers if digests changed.
# Honors AUTO_UPDATE=0|1 (default on for gateway .env example).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# shellcheck source=lib-env.sh
source "$SCRIPT_DIR/lib-env.sh"
load_dotenv .env

if ! auto_update_enabled; then
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  log_update "$SCRIPT_DIR" "gateway: docker not found"
  exit 1
fi

IMAGE_TAG="${IMAGE_TAG:-main}"
TESTNET_UI_NAME="${TESTNET_UI_NAME:-testnet-ui}"
MAINNET_UI_NAME="${MAINNET_UI_NAME:-mainnet-ui}"
GATEWAY_NAME="${GATEWAY_NAME:-onchain-invoice-gateway}"
UI_IMAGE="${UI_IMAGE:-ghcr.io/naiemk/trustless-commerce-ui}:${IMAGE_TAG}"
NGINX_IMAGE="${NGINX_IMAGE:-ghcr.io/naiemk/trustless-commerce-nginx}:${IMAGE_TAG}"
[[ "$UI_IMAGE" != *:* ]] && UI_IMAGE="${UI_IMAGE}:${IMAGE_TAG}"
[[ "$NGINX_IMAGE" != *:* ]] && NGINX_IMAGE="${NGINX_IMAGE}:${IMAGE_TAG}"
STOP_TIMEOUT="${STOP_TIMEOUT:-60}"

log_update "$SCRIPT_DIR" "gateway: pulling $UI_IMAGE and $NGINX_IMAGE"
docker pull "$UI_IMAGE" >/dev/null
docker pull "$NGINX_IMAGE" >/dev/null

need=0
if container_needs_image "$TESTNET_UI_NAME" "$UI_IMAGE"; then need=1; fi
if container_needs_image "$MAINNET_UI_NAME" "$UI_IMAGE"; then need=1; fi
if container_needs_image "$GATEWAY_NAME" "$NGINX_IMAGE"; then need=1; fi

if [[ "$need" -eq 0 ]]; then
  log_update "$SCRIPT_DIR" "gateway: already on latest images"
  exit 0
fi

log_update "$SCRIPT_DIR" "gateway: updating UI/nginx (stop -t $STOP_TIMEOUT, recreate)"
graceful_stop "$GATEWAY_NAME" "$STOP_TIMEOUT"
graceful_stop "$TESTNET_UI_NAME" "$STOP_TIMEOUT"
graceful_stop "$MAINNET_UI_NAME" "$STOP_TIMEOUT"
PULL=0 ONCHAIN_INVOICE_SKIP_PULL=1 "$SCRIPT_DIR/start-onchain-invoice-gateway.sh"
log_update "$SCRIPT_DIR" "gateway: updated"
