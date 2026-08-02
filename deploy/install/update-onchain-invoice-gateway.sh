#!/usr/bin/env bash
# Pull latest UI/nginx images; recreate only the containers whose auto-update flag is on.
#
#   UI_TESTNET_AUTO_UPDATE=1   → testnet-ui
#   UI_MAINNET_AUTO_UPDATE=1   → mainnet-ui
#   GATEWAY_AUTO_UPDATE=1      → onchain-invoice-gateway (nginx)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# shellcheck source=lib-env.sh
source "$SCRIPT_DIR/lib-env.sh"
load_dotenv .env

UPDATE_TESTNET=0
UPDATE_MAINNET=0
UPDATE_GATEWAY=0
role_auto_update_on UI_TESTNET_AUTO_UPDATE && UPDATE_TESTNET=1
role_auto_update_on UI_MAINNET_AUTO_UPDATE && UPDATE_MAINNET=1
role_auto_update_on GATEWAY_AUTO_UPDATE && UPDATE_GATEWAY=1

if [[ "$UPDATE_TESTNET$UPDATE_MAINNET$UPDATE_GATEWAY" == "000" ]]; then
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  log_update "$SCRIPT_DIR" "gateway: docker not found"
  exit 1
fi

IMAGE_TAG="${IMAGE_TAG:-main}"
DOCKER_NETWORK="${DOCKER_NETWORK:-trustless-commerce-edge}"
TESTNET_UI_NAME="${TESTNET_UI_NAME:-testnet-ui}"
MAINNET_UI_NAME="${MAINNET_UI_NAME:-mainnet-ui}"
GATEWAY_NAME="${GATEWAY_NAME:-onchain-invoice-gateway}"
UI_IMAGE="${UI_IMAGE:-ghcr.io/naiemk/trustless-commerce-ui}:${IMAGE_TAG}"
NGINX_IMAGE="${NGINX_IMAGE:-ghcr.io/naiemk/trustless-commerce-nginx}:${IMAGE_TAG}"
[[ "$UI_IMAGE" != *:* ]] && UI_IMAGE="${UI_IMAGE}:${IMAGE_TAG}"
[[ "$NGINX_IMAGE" != *:* ]] && NGINX_IMAGE="${NGINX_IMAGE}:${IMAGE_TAG}"
STOP_TIMEOUT="${GATEWAY_STOP_TIMEOUT:-${STOP_TIMEOUT:-60}}"

NGINX_CONF="$SCRIPT_DIR/gateway/nginx.conf"
CONF_D="$SCRIPT_DIR/gateway/conf.d"
TLS_FULLCHAIN="${TLS_FULLCHAIN:-/etc/letsencrypt/live/trustless-commerce.com/fullchain.pem}"
TLS_PRIVKEY="${TLS_PRIVKEY:-/etc/letsencrypt/live/trustless-commerce.com/privkey.pem}"
CERTBOT_WWW="${CERTBOT_WWW:-/var/www/certbot}"
HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="${HTTPS_PORT:-443}"

need_ui_pull=0
need_nginx_pull=0
[[ "$UPDATE_TESTNET" -eq 1 || "$UPDATE_MAINNET" -eq 1 ]] && need_ui_pull=1
[[ "$UPDATE_GATEWAY" -eq 1 ]] && need_nginx_pull=1

if [[ "$need_ui_pull" -eq 1 ]]; then
  log_update "$SCRIPT_DIR" "gateway: pulling $UI_IMAGE"
  docker pull "$UI_IMAGE" >/dev/null
fi
if [[ "$need_nginx_pull" -eq 1 ]]; then
  log_update "$SCRIPT_DIR" "gateway: pulling $NGINX_IMAGE"
  docker pull "$NGINX_IMAGE" >/dev/null
fi

recreate_ui() {
  local name="$1"
  if ! container_needs_image "$name" "$UI_IMAGE"; then
    log_update "$SCRIPT_DIR" "gateway: $name already on latest UI image"
    return 0
  fi
  log_update "$SCRIPT_DIR" "gateway: updating $name (stop -t $STOP_TIMEOUT)"
  graceful_stop "$name" "$STOP_TIMEOUT"
  docker rm -f "$name" >/dev/null 2>&1 || true
  docker network create "$DOCKER_NETWORK" >/dev/null 2>&1 || true
  docker run -d \
    --name "$name" \
    --restart unless-stopped \
    --network "$DOCKER_NETWORK" \
    "$UI_IMAGE" >/dev/null
  log_update "$SCRIPT_DIR" "gateway: $name updated"
}

recreate_gateway() {
  if ! container_needs_image "$GATEWAY_NAME" "$NGINX_IMAGE"; then
    log_update "$SCRIPT_DIR" "gateway: $GATEWAY_NAME already on latest nginx image"
    return 0
  fi
  if [[ ! -f "$NGINX_CONF" || ! -d "$CONF_D" ]]; then
    log_update "$SCRIPT_DIR" "gateway: missing nginx conf — run install-gateway.sh"
    return 1
  fi
  if [[ ! -f "$TLS_FULLCHAIN" || ! -f "$TLS_PRIVKEY" ]]; then
    log_update "$SCRIPT_DIR" "gateway: TLS certs missing — skip nginx update"
    return 1
  fi
  log_update "$SCRIPT_DIR" "gateway: updating $GATEWAY_NAME (stop -t $STOP_TIMEOUT)"
  graceful_stop "$GATEWAY_NAME" "$STOP_TIMEOUT"
  docker rm -f "$GATEWAY_NAME" >/dev/null 2>&1 || true
  mkdir -p "$CERTBOT_WWW"
  docker network create "$DOCKER_NETWORK" >/dev/null 2>&1 || true
  docker run -d \
    --name "$GATEWAY_NAME" \
    --restart unless-stopped \
    --network "$DOCKER_NETWORK" \
    -p "${HTTP_PORT}:80" \
    -p "${HTTPS_PORT}:443" \
    -v "$NGINX_CONF:/etc/nginx/nginx.conf:ro" \
    -v "$CONF_D:/etc/nginx/conf.d:ro" \
    -v "$TLS_FULLCHAIN:/etc/nginx/certs/fullchain.pem:ro" \
    -v "$TLS_PRIVKEY:/etc/nginx/certs/privkey.pem:ro" \
    -v "$CERTBOT_WWW:/var/www/certbot:ro" \
    "$NGINX_IMAGE" >/dev/null
  log_update "$SCRIPT_DIR" "gateway: $GATEWAY_NAME updated"
}

[[ "$UPDATE_TESTNET" -eq 1 ]] && recreate_ui "$TESTNET_UI_NAME"
[[ "$UPDATE_MAINNET" -eq 1 ]] && recreate_ui "$MAINNET_UI_NAME"
[[ "$UPDATE_GATEWAY" -eq 1 ]] && recreate_gateway
