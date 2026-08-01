#!/usr/bin/env bash
# Install or remove a cron entry for this install directory's auto-updater.
#
#   ROLE=gateway ./install-auto-update.sh
#   ROLE=nodes ./install-auto-update.sh
#   ROLE=api ./install-auto-update.sh
#
# Reads AUTO_UPDATE and AUTO_UPDATE_INTERVAL_MIN from .env in this directory.
# If AUTO_UPDATE is off, removes any matching cron line.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# shellcheck source=lib-env.sh
source "$SCRIPT_DIR/lib-env.sh"
load_dotenv .env

ROLE="${ROLE:-}"
if [[ -z "$ROLE" ]]; then
  if [[ -f start-onchain-invoice-gateway.sh && -f update-onchain-invoice-gateway.sh ]]; then
    ROLE=gateway
  elif [[ -f start-onchain-invoice-nodes.sh && -f update-onchain-invoice-nodes.sh ]]; then
    ROLE=nodes
  elif [[ -f start-onchain-invoice-api.sh && -f update-onchain-invoice-api.sh ]]; then
    ROLE=api
  else
    echo "Set ROLE=api|gateway|nodes" >&2
    exit 1
  fi
fi

case "$ROLE" in
  api) UPDATE_SCRIPT="$SCRIPT_DIR/update-onchain-invoice-api.sh" ; DEFAULT_INTERVAL=15 ;;
  gateway) UPDATE_SCRIPT="$SCRIPT_DIR/update-onchain-invoice-gateway.sh" ; DEFAULT_INTERVAL=5 ;;
  nodes) UPDATE_SCRIPT="$SCRIPT_DIR/update-onchain-invoice-nodes.sh" ; DEFAULT_INTERVAL=15 ;;
  *)
    echo "ROLE must be api, gateway, or nodes" >&2
    exit 1
    ;;
esac

if [[ ! -f "$UPDATE_SCRIPT" ]]; then
  echo "Missing $UPDATE_SCRIPT — re-run the matching install-*.sh" >&2
  exit 1
fi
chmod +x "$UPDATE_SCRIPT" "$SCRIPT_DIR/lib-env.sh" 2>/dev/null || true

MARKER="# onchain-invoice-auto-update:${ROLE}:${SCRIPT_DIR}"
INTERVAL_MIN="${AUTO_UPDATE_INTERVAL_MIN:-$DEFAULT_INTERVAL}"
if ! [[ "$INTERVAL_MIN" =~ ^[0-9]+$ ]] || [[ "$INTERVAL_MIN" -lt 1 ]]; then
  INTERVAL_MIN="$DEFAULT_INTERVAL"
fi

# cron: every N minutes
CRON_SCHED="*/${INTERVAL_MIN} * * * *"
CRON_LINE="${CRON_SCHED} cd ${SCRIPT_DIR} && /bin/bash ${UPDATE_SCRIPT} >/dev/null 2>&1 ${MARKER}"

if ! command -v crontab >/dev/null 2>&1; then
  echo "crontab not found — schedule manually:" >&2
  echo "  $CRON_LINE" >&2
  exit 1
fi

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$EXISTING" | grep -vF "$MARKER" || true)"

if auto_update_enabled; then
  {
    printf '%s\n' "$FILTERED"
    printf '%s\n' "$CRON_LINE"
  } | sed '/^$/d' | crontab -
  echo "Installed cron ($ROLE every ${INTERVAL_MIN}m):"
  echo "  $CRON_LINE"
else
  printf '%s\n' "$FILTERED" | sed '/^$/d' | crontab -
  echo "AUTO_UPDATE disabled — removed cron for $ROLE ($SCRIPT_DIR)"
fi
