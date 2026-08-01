#!/usr/bin/env bash
# Start HTTPS edge: testnet-ui + mainnet-ui + nginx (Let's Encrypt mounts).
# APIs must already be running on DOCKER_NETWORK as testnet-api / mainnet-api.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    key="${key%%[[:space:]]*}"
    key="${key##[[:space:]]*}"
    key="${key%$'\r'}"
    val="${val%$'\r'}"
    if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
    if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    [[ -z "$key" || "$key" == *[!A-Za-z0-9_]* ]] && continue
    if [[ -z "${!key-}" ]]; then
      export "$key=$val"
    fi
  done < .env
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

IMAGE_TAG="${IMAGE_TAG:-main}"
DOCKER_NETWORK="${DOCKER_NETWORK:-trustless-commerce-edge}"
TESTNET_UI_NAME="${TESTNET_UI_NAME:-testnet-ui}"
MAINNET_UI_NAME="${MAINNET_UI_NAME:-mainnet-ui}"
GATEWAY_NAME="${GATEWAY_NAME:-onchain-invoice-gateway}"
UI_IMAGE="${UI_IMAGE:-ghcr.io/naiemk/trustless-commerce-ui}:${IMAGE_TAG}"
NGINX_IMAGE="${NGINX_IMAGE:-ghcr.io/naiemk/trustless-commerce-nginx}:${IMAGE_TAG}"
# Allow UI_IMAGE/NGINX_IMAGE without tag in .env
[[ "$UI_IMAGE" != *:* ]] && UI_IMAGE="${UI_IMAGE}:${IMAGE_TAG}"
[[ "$NGINX_IMAGE" != *:* ]] && NGINX_IMAGE="${NGINX_IMAGE}:${IMAGE_TAG}"

TLS_FULLCHAIN="${TLS_FULLCHAIN:-/etc/letsencrypt/live/trustless-commerce.com/fullchain.pem}"
TLS_PRIVKEY="${TLS_PRIVKEY:-/etc/letsencrypt/live/trustless-commerce.com/privkey.pem}"
CERTBOT_WWW="${CERTBOT_WWW:-/var/www/certbot}"
HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="${HTTPS_PORT:-443}"

NGINX_CONF="$SCRIPT_DIR/gateway/nginx.conf"
CONF_D="$SCRIPT_DIR/gateway/conf.d"
if [[ ! -f "$NGINX_CONF" || ! -d "$CONF_D" ]]; then
  echo "Missing gateway/nginx.conf or gateway/conf.d — re-run install-gateway.sh" >&2
  exit 1
fi

if [[ ! -f "$TLS_FULLCHAIN" || ! -f "$TLS_PRIVKEY" ]]; then
  echo "TLS certs not found:" >&2
  echo "  $TLS_FULLCHAIN" >&2
  echo "  $TLS_PRIVKEY" >&2
  echo "Issue with certbot (port 80 free), then retry." >&2
  exit 1
fi

mkdir -p "$CERTBOT_WWW"

if [[ "${ONCHAIN_INVOICE_SKIP_PULL:-}" == "1" || "${PULL:-1}" == "0" ]]; then
  echo "Skipping docker pull"
else
  echo "Pulling $UI_IMAGE ..."
  docker pull "$UI_IMAGE"
  echo "Pulling $NGINX_IMAGE ..."
  docker pull "$NGINX_IMAGE"
fi

docker network create "$DOCKER_NETWORK" >/dev/null 2>&1 || true

run_ui() {
  local name="$1"
  if docker inspect "$name" >/dev/null 2>&1; then
    echo "Removing existing container $name ..."
    docker rm -f "$name" >/dev/null
  fi
  echo "Starting $name ..."
  docker run -d \
    --name "$name" \
    --restart unless-stopped \
    --network "$DOCKER_NETWORK" \
    "$UI_IMAGE" >/dev/null
}

run_ui "$TESTNET_UI_NAME"
run_ui "$MAINNET_UI_NAME"

if docker inspect "$GATEWAY_NAME" >/dev/null 2>&1; then
  echo "Removing existing container $GATEWAY_NAME ..."
  docker rm -f "$GATEWAY_NAME" >/dev/null
fi

echo "Starting $GATEWAY_NAME (HTTPS ${HTTPS_PORT}, HTTP ${HTTP_PORT}) ..."
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

echo ""
echo "Gateway up on network $DOCKER_NETWORK"
echo "  https://testnet.trustless-commerce.com  → ${TESTNET_UI_NAME} + testnet-api"
echo "  https://trustless-commerce.com          → ${MAINNET_UI_NAME} + mainnet-api"
echo "Health: curl -fsS https://testnet.trustless-commerce.com/api/health"
echo "Ensure APIs are running as containers named testnet-api and mainnet-api on $DOCKER_NETWORK"
