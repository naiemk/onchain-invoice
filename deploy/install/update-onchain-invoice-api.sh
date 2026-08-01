#!/usr/bin/env bash
# Pull latest API image and recreate if the digest changed.
# Honors AUTO_UPDATE=0|1 (default off).
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
  log_update "$SCRIPT_DIR" "api: docker not found"
  exit 1
fi

CONFIG="${ONCHAIN_INVOICE_API_CONFIG:-onchain-invoice-api.yaml}"
IMAGE="ghcr.io/naiemk/trustless-commerce-api:main"
NAME="onchain-invoice-api"
if [[ -f "$CONFIG" ]]; then
  IMAGE="$(python3 - "$CONFIG" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read().splitlines()
for line in text:
    s = line.strip()
    if s.startswith("image:"):
        v = s.split(":", 1)[1].strip().strip('"').strip("'")
        print(v)
        break
else:
    print("ghcr.io/naiemk/trustless-commerce-api:main")
PY
)"
  NAME="$(python3 - "$CONFIG" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read().splitlines()
in_docker = False
for line in text:
    if line.startswith("docker:"):
        in_docker = True
        continue
    if in_docker and line.strip() and not line.startswith(" ") and not line.startswith("\t"):
        break
    if in_docker and line.strip().startswith("name:"):
        print(line.split(":", 1)[1].strip().strip('"').strip("'"))
        break
else:
    print("onchain-invoice-api")
PY
)"
fi
NAME="${DOCKER_NAME:-${NAME:-onchain-invoice-api}}"
IMAGE="${IMAGE:-ghcr.io/naiemk/trustless-commerce-api:main}"
STOP_TIMEOUT="${STOP_TIMEOUT:-120}"

log_update "$SCRIPT_DIR" "api: pulling $IMAGE"
docker pull "$IMAGE" >/dev/null

if ! container_needs_image "$NAME" "$IMAGE"; then
  log_update "$SCRIPT_DIR" "api: $NAME already on latest $IMAGE"
  exit 0
fi

log_update "$SCRIPT_DIR" "api: updating $NAME (stop -t $STOP_TIMEOUT, recreate)"
graceful_stop "$NAME" "$STOP_TIMEOUT"
PULL=0 ONCHAIN_INVOICE_SKIP_PULL=1 "$SCRIPT_DIR/start-onchain-invoice-api.sh"
log_update "$SCRIPT_DIR" "api: $NAME updated"
