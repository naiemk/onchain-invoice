#!/usr/bin/env bash
# Generic HTTPS nginx gateway — UI and API must already be on DOCKER_NETWORK.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# shellcheck source=lib-env.sh
[[ -f lib-env.sh ]] && source lib-env.sh && load_dotenv .env

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

NETWORK="${DOCKER_NETWORK:-app-edge}"
GATEWAY_NAME="${GATEWAY_NAME:-app-gateway}"
NGINX_IMAGE="${NGINX_IMAGE:-nginx:alpine}"
TLS_FULLCHAIN="${TLS_FULLCHAIN:-/etc/letsencrypt/live/example.com/fullchain.pem}"
TLS_PRIVKEY="${TLS_PRIVKEY:-/etc/letsencrypt/live/example.com/privkey.pem}"
CERTBOT_WWW="${CERTBOT_WWW:-./certbot-www}"
HTTP_PORT="${HTTP_PORT:-80}"
HTTPS_PORT="${HTTPS_PORT:-443}"
GW_MEMORY="${GATEWAY_MEMORY_LIMIT:-64m}"

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
  echo "Run ./gen-dev-certs.sh for lab, or certbot for production." >&2
  exit 1
fi

if [[ "${PULL:-1}" == "1" && "$NGINX_IMAGE" != *:local ]]; then
  echo "Pulling $NGINX_IMAGE ..."
  docker pull "$NGINX_IMAGE"
fi

docker network create "$NETWORK" >/dev/null 2>&1 || true
mkdir -p "$CERTBOT_WWW"

if docker inspect "$GATEWAY_NAME" >/dev/null 2>&1; then
  echo "Removing existing container $GATEWAY_NAME ..."
  docker rm -f "$GATEWAY_NAME" >/dev/null
fi

CONF_VOL="${GATEWAY_NAME}-nginx-cfg"
docker volume rm "$CONF_VOL" 2>/dev/null || true
docker volume create "$CONF_VOL" >/dev/null

STAGE="$(mktemp -d)"
cleanup_stage() { rm -rf "$STAGE"; }
trap cleanup_stage EXIT

mkdir -p "$STAGE/conf.d" "$STAGE/certs" "$STAGE/certbot"
cp "$NGINX_CONF" "$STAGE/nginx.conf"
cp -r "$CONF_D/." "$STAGE/conf.d/"
cp "$TLS_FULLCHAIN" "$STAGE/certs/fullchain.pem"
cp "$TLS_PRIVKEY" "$STAGE/certs/privkey.pem"
if [[ -d "$CERTBOT_WWW" ]]; then
  cp -r "$CERTBOT_WWW/." "$STAGE/certbot/" 2>/dev/null || true
fi

tar -C "$STAGE" -cf - . | docker run --rm -i -v "${CONF_VOL}:/cfg" alpine tar -xf - -C /cfg

echo "Starting $GATEWAY_NAME (HTTP ${HTTP_PORT}, HTTPS ${HTTPS_PORT}) ..."
# shellcheck disable=SC2046
docker run -d \
  --name "$GATEWAY_NAME" \
  --restart unless-stopped \
  --network "$NETWORK" \
  $(memory_args "$GW_MEMORY") \
  -p "${HTTP_PORT}:80" \
  -p "${HTTPS_PORT}:443" \
  -v "${CONF_VOL}:/gateway-cfg:ro" \
  "$NGINX_IMAGE" \
  sh -c 'mkdir -p /etc/nginx/certs /etc/nginx/conf.d /var/www/certbot && \
    cp /gateway-cfg/nginx.conf /etc/nginx/nginx.conf && \
    cp /gateway-cfg/conf.d/*.conf /etc/nginx/conf.d/ && \
    cp /gateway-cfg/certs/fullchain.pem /etc/nginx/certs/fullchain.pem && \
    cp /gateway-cfg/certs/privkey.pem /etc/nginx/certs/privkey.pem && \
    cp -r /gateway-cfg/certbot/. /var/www/certbot/ 2>/dev/null || true && \
    exec nginx -g "daemon off;"' >/dev/null

trap - EXIT
cleanup_stage

echo "Gateway $GATEWAY_NAME up on network $NETWORK"
