#!/usr/bin/env bash
# Install or remove cron for this directory's updater based on role-specific .env flags.
#
#   ./install-auto-update.sh
#
# Detects api / gateway / nodes from files present. Enable flags:
#   API_AUTO_UPDATE
#   UI_TESTNET_AUTO_UPDATE / UI_MAINNET_AUTO_UPDATE / GATEWAY_AUTO_UPDATE
#   NODES_AUTO_UPDATE
# Legacy AUTO_UPDATE is still accepted if the role flag is unset.
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
    echo "Could not detect install role (need start + update scripts for api|gateway|nodes)" >&2
    exit 1
  fi
fi

cron_enabled=0
INTERVAL_MIN=""
UPDATE_SCRIPT=""
DEFAULT_INTERVAL=15

case "$ROLE" in
  api)
    UPDATE_SCRIPT="$SCRIPT_DIR/update-onchain-invoice-api.sh"
    DEFAULT_INTERVAL=15
    if role_auto_update_on API_AUTO_UPDATE; then cron_enabled=1; fi
    INTERVAL_MIN="${API_AUTO_UPDATE_INTERVAL_MIN:-${AUTO_UPDATE_INTERVAL_MIN:-$DEFAULT_INTERVAL}}"
    ;;
  gateway)
    UPDATE_SCRIPT="$SCRIPT_DIR/update-onchain-invoice-gateway.sh"
    DEFAULT_INTERVAL=5
    if role_auto_update_on UI_TESTNET_AUTO_UPDATE \
      || role_auto_update_on UI_MAINNET_AUTO_UPDATE \
      || role_auto_update_on GATEWAY_AUTO_UPDATE; then
      cron_enabled=1
    fi
    INTERVAL_MIN="${GATEWAY_AUTO_UPDATE_INTERVAL_MIN:-${UI_AUTO_UPDATE_INTERVAL_MIN:-${AUTO_UPDATE_INTERVAL_MIN:-$DEFAULT_INTERVAL}}}"
    ;;
  nodes)
    UPDATE_SCRIPT="$SCRIPT_DIR/update-onchain-invoice-nodes.sh"
    DEFAULT_INTERVAL=15
    if role_auto_update_on NODES_AUTO_UPDATE; then cron_enabled=1; fi
    INTERVAL_MIN="${NODES_AUTO_UPDATE_INTERVAL_MIN:-${AUTO_UPDATE_INTERVAL_MIN:-$DEFAULT_INTERVAL}}"
    ;;
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
if ! [[ "$INTERVAL_MIN" =~ ^[0-9]+$ ]] || [[ "$INTERVAL_MIN" -lt 1 ]]; then
  INTERVAL_MIN="$DEFAULT_INTERVAL"
fi

CRON_SCHED="*/${INTERVAL_MIN} * * * *"
CRON_LINE="${CRON_SCHED} cd ${SCRIPT_DIR} && /bin/bash ${UPDATE_SCRIPT} >/dev/null 2>&1 ${MARKER}"

if ! command -v crontab >/dev/null 2>&1; then
  echo "crontab not found — schedule manually:" >&2
  echo "  $CRON_LINE" >&2
  exit 1
fi

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$EXISTING" | grep -vF "$MARKER" || true)"

if [[ "$cron_enabled" -eq 1 ]]; then
  {
    printf '%s\n' "$FILTERED"
    printf '%s\n' "$CRON_LINE"
  } | sed '/^$/d' | crontab -
  echo "Installed cron ($ROLE every ${INTERVAL_MIN}m):"
  echo "  $CRON_LINE"
else
  printf '%s\n' "$FILTERED" | sed '/^$/d' | crontab -
  echo "Auto-update disabled for $ROLE — removed cron ($SCRIPT_DIR)"
fi
