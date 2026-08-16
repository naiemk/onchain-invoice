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
#
# Scheduling:
#   1. If /etc/cron.d is writable (or ONCHAIN_INVOICE_CRON_D_DIR is set), write a host
#      cron.d drop-in as root — required when install runs inside an ephemeral Docker
#      helper (user crontab inside the container does not persist).
#   2. Else fall back to the invoking user's crontab.
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

# Prefer host /etc/cron.d when available (persists across Docker helper runs).
CRON_D_DIR="${ONCHAIN_INVOICE_CRON_D_DIR:-}"
if [[ -z "$CRON_D_DIR" && -d /etc/cron.d && -w /etc/cron.d ]]; then
  CRON_D_DIR=/etc/cron.d
fi

if [[ -n "$CRON_D_DIR" ]]; then
  # cron.d basenames: letters, digits, underscore, hyphen only.
  SAFE_BASE="$(basename "$SCRIPT_DIR" | tr -c 'A-Za-z0-9_-' '_' )"
  CRON_D_FILE="${CRON_D_DIR}/tc-${ROLE}-${SAFE_BASE}"
  if [[ "$cron_enabled" -eq 1 ]]; then
    # Run as root so docker.sock + /root/tc are reachable on typical VPS layouts.
    {
      echo "# Managed by install-auto-update.sh — ${ROLE} @ ${SCRIPT_DIR}"
      echo "SHELL=/bin/bash"
      echo "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
      echo "${CRON_SCHED} root cd ${SCRIPT_DIR} && /bin/bash ${UPDATE_SCRIPT} >>${SCRIPT_DIR}/logs/auto-update.log 2>&1"
    } >"$CRON_D_FILE"
    chmod 644 "$CRON_D_FILE" || true
    mkdir -p "$SCRIPT_DIR/logs"
    echo "Installed host cron.d ($ROLE every ${INTERVAL_MIN}m):"
    echo "  $CRON_D_FILE"
  else
    rm -f "$CRON_D_FILE"
    echo "Auto-update disabled for $ROLE — removed $CRON_D_FILE (if present)"
  fi
  exit 0
fi

if ! command -v crontab >/dev/null 2>&1; then
  echo "crontab not found and /etc/cron.d not writable — schedule manually:" >&2
  echo "  $CRON_LINE" >&2
  echo "  Or remount with: -v /etc/cron.d:/etc/cron.d" >&2
  exit 1
fi

EXISTING="$(crontab -l 2>/dev/null || true)"
FILTERED="$(printf '%s\n' "$EXISTING" | grep -vF "$MARKER" || true)"

if [[ "$cron_enabled" -eq 1 ]]; then
  {
    printf '%s\n' "$FILTERED"
    printf '%s\n' "$CRON_LINE"
  } | sed '/^$/d' | crontab -
  echo "Installed user cron ($ROLE every ${INTERVAL_MIN}m):"
  echo "  $CRON_LINE"
else
  printf '%s\n' "$FILTERED" | sed '/^$/d' | crontab -
  echo "Auto-update disabled for $ROLE — removed user cron ($SCRIPT_DIR)"
fi
