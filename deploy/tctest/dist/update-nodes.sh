#!/usr/bin/env bash
# Pull latest sweeper image and recreate node(s) if the digest changed.
# Honors NODES_AUTO_UPDATE=0|1 (legacy AUTO_UPDATE fallback).
# Prefers COMPOSE_FILE=docker-compose.workers.yml when present.
# Host flock + digest-gated pull (see lib-env.sh) — safe on small VPS.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# shellcheck source=lib-env.sh
source "$SCRIPT_DIR/lib-env.sh"
load_dotenv .env

if ! role_auto_update_on NODES_AUTO_UPDATE; then
  exit 0
fi

if ! command -v docker >/dev/null 2>&1; then
  log_update "$SCRIPT_DIR" "nodes: docker not found"
  exit 1
fi

run_nodes_update() {
  CONFIG="${ONCHAIN_INVOICE_NODES_CONFIG:-${CONFIG_FILE:-nodes-workers.yaml}}"
  COMPOSE_FILE="${COMPOSE_FILE:-${SCRIPT_DIR}/docker-compose.workers.yml}"
  if [[ "$COMPOSE_FILE" != /* ]]; then
    COMPOSE_FILE="${SCRIPT_DIR}/${COMPOSE_FILE}"
  fi
  APP_PREFIX="${APP_PREFIX:-}"
  IMAGE="${SWEEPER_IMAGE:-${WORKER_IMAGE:-ghcr.io/naiemk/trustless-commerce-sweeper:main}}"
  NAME="onchain-invoice-node"
  if [[ -f "$CONFIG" ]]; then
    yaml_image="$(python3 - "$CONFIG" <<'PY'
import sys
text = open(sys.argv[1], encoding="utf-8").read().splitlines()
for line in text:
    s = line.strip()
    if s.startswith("image:"):
        v = s.split(":", 1)[1].strip().strip('"').strip("'")
        print(v)
        break
PY
)"
    if [[ -n "$yaml_image" && -z "${SWEEPER_IMAGE:-}" && -z "${WORKER_IMAGE:-}" ]]; then
      IMAGE="$yaml_image"
    fi
  fi
  IMAGE="${SWEEPER_IMAGE:-${WORKER_IMAGE:-${IMAGE:-ghcr.io/naiemk/trustless-commerce-sweeper:main}}}"
  NAME="${NAME:-onchain-invoice-node}"
  STOP_TIMEOUT="${NODES_STOP_TIMEOUT:-${STOP_TIMEOUT:-180}}"

  pull_status="$(pull_image_if_needed "$IMAGE")"
  log_update "$SCRIPT_DIR" "nodes: $IMAGE — $pull_status"
  export SWEEPER_IMAGE="$IMAGE"
  export WORKER_IMAGE="${WORKER_IMAGE:-$IMAGE}"

  if [[ -f "$COMPOSE_FILE" ]]; then
    local containers=()
    if [[ -n "$APP_PREFIX" ]]; then
      containers=(
        "${APP_PREFIX}-sweeper-evm"
        "${APP_PREFIX}-sweeper-tron"
        "${APP_PREFIX}-bundler-evm"
        "${APP_PREFIX}-wallet-deployer-evm"
      )
      if [[ "$APP_PREFIX" == "tctest" ]] && env_flag_on SWEEPER_SOLANA_ENABLED; then
        containers+=("${APP_PREFIX}-sweeper-solana")
      elif [[ "$APP_PREFIX" == "tctest" ]] && docker inspect "${APP_PREFIX}-sweeper-solana" >/dev/null 2>&1; then
        log_update "$SCRIPT_DIR" "nodes: SWEEPER_SOLANA_ENABLED off — stopping ${APP_PREFIX}-sweeper-solana"
        graceful_stop "${APP_PREFIX}-sweeper-solana" "$STOP_TIMEOUT"
        docker rm -f "${APP_PREFIX}-sweeper-solana" >/dev/null 2>&1 || true
      fi
    else
      containers=(
        onchain-invoice-sweeper-evm
        onchain-invoice-sweeper-tron
        onchain-invoice-bundler-evm
        onchain-invoice-wallet-deployer-evm
      )
      if env_flag_on SWEEPER_SOLANA_ENABLED; then
        containers+=(onchain-invoice-sweeper-solana)
      elif docker inspect onchain-invoice-sweeper-solana >/dev/null 2>&1; then
        log_update "$SCRIPT_DIR" "nodes: SWEEPER_SOLANA_ENABLED off — stopping solana sweeper"
        graceful_stop onchain-invoice-sweeper-solana "$STOP_TIMEOUT"
        docker rm -f onchain-invoice-sweeper-solana >/dev/null 2>&1 || true
      fi
    fi

    needs=0
    for cname in "${containers[@]}"; do
      if container_needs_image "$cname" "$IMAGE"; then
        needs=1
        break
      fi
      if ! docker inspect "$cname" >/dev/null 2>&1; then
        needs=1
        break
      fi
    done
    if [[ "$needs" -eq 0 ]]; then
      log_update "$SCRIPT_DIR" "nodes: compose sweepers already on latest $IMAGE"
      if declare -F prune_docker_images >/dev/null 2>&1; then
        prune_docker_images "$SCRIPT_DIR" "nodes"
      fi
      return 0
    fi
    log_update "$SCRIPT_DIR" "nodes: updating compose sweepers (stop -t $STOP_TIMEOUT, recreate)"
    for cname in "${containers[@]}"; do
      if docker inspect "$cname" >/dev/null 2>&1; then
        graceful_stop "$cname" "$STOP_TIMEOUT"
      fi
    done
    PULL=0 ONCHAIN_INVOICE_SKIP_PULL=1 "$SCRIPT_DIR/start-nodes.sh"
    log_update "$SCRIPT_DIR" "nodes: compose sweepers updated"
    if declare -F prune_docker_images >/dev/null 2>&1; then
      prune_docker_images "$SCRIPT_DIR" "nodes"
    fi
    return 0
  fi

  if ! container_needs_image "$NAME" "$IMAGE"; then
    log_update "$SCRIPT_DIR" "nodes: $NAME already on latest $IMAGE"
    if declare -F prune_docker_images >/dev/null 2>&1; then
      prune_docker_images "$SCRIPT_DIR" "nodes"
    fi
    return 0
  fi

  log_update "$SCRIPT_DIR" "nodes: updating $NAME (stop -t $STOP_TIMEOUT, recreate)"
  graceful_stop "$NAME" "$STOP_TIMEOUT"
  PULL=0 ONCHAIN_INVOICE_SKIP_PULL=1 USE_COMPOSE=0 "$SCRIPT_DIR/start-nodes.sh"
  log_update "$SCRIPT_DIR" "nodes: $NAME updated"
  if declare -F prune_docker_images >/dev/null 2>&1; then
    prune_docker_images "$SCRIPT_DIR" "nodes"
  fi
}

with_update_lock "$SCRIPT_DIR" "nodes" run_nodes_update
