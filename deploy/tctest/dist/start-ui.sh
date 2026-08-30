#!/usr/bin/env bash
# Generic UI container — gateway nginx proxies to this container on the edge network.
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
UI_NAME="${UI_NAME:-app-ui}"
UI_IMAGE="${UI_IMAGE:-ghcr.io/example/ui:main}"
UI_MEMORY="${UI_MEMORY_LIMIT:-32m}"

if [[ "${PULL:-1}" == "1" && "$UI_IMAGE" != *:local ]]; then
  echo "Pulling $UI_IMAGE ..."
  docker pull "$UI_IMAGE"
fi

docker network create "$NETWORK" >/dev/null 2>&1 || true

if docker inspect "$UI_NAME" >/dev/null 2>&1; then
  echo "Removing existing container $UI_NAME ..."
  docker rm -f "$UI_NAME" >/dev/null
fi

echo "Starting $UI_NAME on network $NETWORK ..."
# shellcheck disable=SC2046
docker run -d \
  --name "$UI_NAME" \
  --restart unless-stopped \
  --network "$NETWORK" \
  $(memory_args "$UI_MEMORY") \
  "$UI_IMAGE" >/dev/null

echo "UI container $UI_NAME up (nginx gateway must proxy to $UI_NAME:80)"
