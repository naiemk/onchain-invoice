#!/usr/bin/env bash
# Pull latest UI/nginx images; recreate only the containers whose auto-update flag is on.
#
#   UI_TESTNET_AUTO_UPDATE=1   → testnet-ui
#   UI_MAINNET_AUTO_UPDATE=1   → mainnet-ui
#   GATEWAY_AUTO_UPDATE=1      → onchain-invoice-gateway (nginx)
#
# Order under host flock: digest-check + pull BEFORE any stop, then recreate if needed.
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

run_gateway_update() {
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
  UI_MEMORY_LIMIT="${UI_MEMORY_LIMIT:-64m}"
  GATEWAY_MEMORY_LIMIT="${GATEWAY_MEMORY_LIMIT:-64m}"

  NGINX_CONF="$SCRIPT_DIR/gateway/nginx.conf"
  CONF_D="$SCRIPT_DIR/gateway/conf.d"
  TLS_FULLCHAIN="${TLS_FULLCHAIN:-/etc/letsencrypt/live/trustless-commerce.com/fullchain.pem}"
  TLS_PRIVKEY="${TLS_PRIVKEY:-/etc/letsencrypt/live/trustless-commerce.com/privkey.pem}"
  CERTBOT_WWW="${CERTBOT_WWW:-/var/www/certbot}"
  HTTP_PORT="${HTTP_PORT:-80}"
  HTTPS_PORT="${HTTPS_PORT:-443}"
  # Host-mounted domains.conf is not inside the nginx image — refresh from git on update.
  ONCHAIN_INVOICE_REF="${ONCHAIN_INVOICE_REF:-${IMAGE_TAG:-main}}"
  DOMAINS_CONF_URL="${DOMAINS_CONF_URL:-https://raw.githubusercontent.com/naiemk/onchain-invoice/${ONCHAIN_INVOICE_REF}/deploy/templates/gateway/conf.d/domains.conf}"

  need_ui_pull=0
  need_nginx_pull=0
  [[ "$UPDATE_TESTNET" -eq 1 || "$UPDATE_MAINNET" -eq 1 ]] && need_ui_pull=1
  [[ "$UPDATE_GATEWAY" -eq 1 ]] && need_nginx_pull=1

  refresh_domains_conf() {
    local dest="$CONF_D/domains.conf"
    local tmp
    unset GATEWAY_DOMAINS_CONF_REFRESHED
    mkdir -p "$CONF_D"
    tmp="$(mktemp)"
    if ! curl -fsSL "$DOMAINS_CONF_URL" -o "$tmp"; then
      rm -f "$tmp"
      log_update "$SCRIPT_DIR" "gateway: could not fetch domains.conf from $DOMAINS_CONF_URL"
      return 1
    fi
    if ! grep -q "location = /pay" "$tmp"; then
      rm -f "$tmp"
      log_update "$SCRIPT_DIR" "gateway: fetched domains.conf missing /pay location — keep existing"
      return 1
    fi
    if [[ -f "$dest" ]] && cmp -s "$tmp" "$dest"; then
      rm -f "$tmp"
      log_update "$SCRIPT_DIR" "gateway: domains.conf already current"
      return 0
    fi
    mv "$tmp" "$dest"
    GATEWAY_DOMAINS_CONF_REFRESHED=1
    log_update "$SCRIPT_DIR" "gateway: refreshed domains.conf from $ONCHAIN_INVOICE_REF"
    return 0
  }

  # Pull BEFORE any stop so a wedged pull cannot leave the site down.
  if [[ "$need_ui_pull" -eq 1 ]]; then
    pull_status="$(pull_image_if_needed "$UI_IMAGE")"
    log_update "$SCRIPT_DIR" "gateway: $UI_IMAGE — $pull_status"
  fi
  if [[ "$need_nginx_pull" -eq 1 ]]; then
    pull_status="$(pull_image_if_needed "$NGINX_IMAGE")"
    log_update "$SCRIPT_DIR" "gateway: $NGINX_IMAGE — $pull_status"
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
    # shellcheck disable=SC2046
    docker run -d \
      --name "$name" \
      --restart unless-stopped \
      --network "$DOCKER_NETWORK" \
      $(memory_args "$UI_MEMORY_LIMIT") \
      "$UI_IMAGE" >/dev/null
    log_update "$SCRIPT_DIR" "gateway: $name updated"
  }

  recreate_gateway() {
    local conf_changed=0
    if refresh_domains_conf; then
      # refresh_domains_conf returns 0 for both "updated" and "already current".
      # Detect change via mtime window or force reload when GATEWAY_FORCE_CONF_RELOAD=1.
      :
    fi
    # Re-fetch status: if dest was rewritten in this run, reload even when image is current.
    if [[ -n "${GATEWAY_DOMAINS_CONF_REFRESHED:-}" ]]; then
      conf_changed=1
    fi
    if ! container_needs_image "$GATEWAY_NAME" "$NGINX_IMAGE" && [[ "$conf_changed" -eq 0 ]]; then
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
    # Conf-only change: try reload first (no downtime).
    if [[ "$conf_changed" -eq 1 ]] && ! container_needs_image "$GATEWAY_NAME" "$NGINX_IMAGE"; then
      if docker exec "$GATEWAY_NAME" nginx -t >/dev/null 2>&1 && docker exec "$GATEWAY_NAME" nginx -s reload >/dev/null 2>&1; then
        log_update "$SCRIPT_DIR" "gateway: reloaded $GATEWAY_NAME after domains.conf refresh"
        return 0
      fi
      log_update "$SCRIPT_DIR" "gateway: reload failed — recreating $GATEWAY_NAME"
    fi
    log_update "$SCRIPT_DIR" "gateway: updating $GATEWAY_NAME (stop -t $STOP_TIMEOUT)"
    graceful_stop "$GATEWAY_NAME" "$STOP_TIMEOUT"
    docker rm -f "$GATEWAY_NAME" >/dev/null 2>&1 || true
    mkdir -p "$CERTBOT_WWW"
    docker network create "$DOCKER_NETWORK" >/dev/null 2>&1 || true
    # shellcheck disable=SC2046
    docker run -d \
      --name "$GATEWAY_NAME" \
      --restart unless-stopped \
      --network "$DOCKER_NETWORK" \
      $(memory_args "$GATEWAY_MEMORY_LIMIT") \
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
}

with_update_lock "$SCRIPT_DIR" "gateway" run_gateway_update
