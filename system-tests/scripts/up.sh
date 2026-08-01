#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  cp .env.example .env
fi

# Allow IMAGE_TAG / PULL from the caller to override .env
if [[ -n "${IMAGE_TAG:-}" ]]; then
  if grep -q '^IMAGE_TAG=' .env; then
    sed -i "s/^IMAGE_TAG=.*/IMAGE_TAG=${IMAGE_TAG}/" .env
  else
    echo "IMAGE_TAG=${IMAGE_TAG}" >> .env
  fi
fi

# shellcheck disable=SC1091
set -a && source .env && set +a
export IMAGE_TAG="${IMAGE_TAG:-main}"

"$REPO/deploy/gen-dev-certs.sh" >/dev/null 2>&1 || true

echo "Pulling images (IMAGE_TAG=${IMAGE_TAG})..."
if [[ "${PULL:-1}" != "0" ]]; then
  docker compose pull
else
  echo "Skipping pull (PULL=0)"
fi

echo "Starting stack..."
docker compose up -d

echo "Waiting for API healthy..."
for _ in $(seq 1 40); do
  if docker compose exec -T api node -e "fetch('http://127.0.0.1:8080/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
    echo "API is healthy"
    exit 0
  fi
  sleep 2
done
echo "API did not become healthy in time" >&2
docker compose ps >&2 || true
docker compose logs --tail=80 api >&2 || true
exit 1
