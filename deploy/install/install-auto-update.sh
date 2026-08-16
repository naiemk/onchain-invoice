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
# Prefers /etc/cron.d/tc-<role>-<dir> when writable (Docker-helper installs persist);
# else falls back to the invoking user's crontab.
# Schedules are staggered by role so api/nodes/gateway do not fire together.
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
DEFAULT_INTERVAL=30
CRON_OFFSET=0

case "$ROLE" in
  api)
    UPDATE_SCRIPT="$SCRIPT_DIR/update-onchain-invoice-api.sh"
    DEFAULT_INTERVAL=30
    CRON_OFFSET=0
    if role_auto_update_on API_AUTO_UPDATE; then cron_enabled=1; fi
    INTERVAL_MIN="${API_AUTO_UPDATE_INTERVAL_MIN:-${AUTO_UPDATE_INTERVAL_MIN:-$DEFAULT_INTERVAL}}"
    ;;
  gateway)
    UPDATE_SCRIPT="$SCRIPT_DIR/update-onchain-invoice-gateway.sh"
    DEFAULT_INTERVAL=20
    CRON_OFFSET=20
    if role_auto_update_on UI_TESTNET_AUTO_UPDATE \
      || role_auto_update_on UI_MAINNET_AUTO_UPDATE \
      || role_auto_update_on GATEWAY_AUTO_UPDATE; then
      cron_enabled=1
    fi
    INTERVAL_MIN="${GATEWAY_AUTO_UPDATE_INTERVAL_MIN:-${UI_AUTO_UPDATE_INTERVAL_MIN:-${AUTO_UPDATE_INTERVAL_MIN:-$DEFAULT_INTERVAL}}}"
    ;;
  nodes)
    UPDATE_SCRIPT="$SCRIPT_DIR/update-onchain-invoice-nodes.sh"
    DEFAULT_INTERVAL=30
    CRON_OFFSET=10
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
if [[ "$INTERVAL_MIN" -gt 59 ]]; then
  INTERVAL_MIN=59
fi

# Build minute list: offset, offset+interval, ... < 60 (api :00, nodes :10, gateway :20).
build_cron_minutes() {
  local offset="$1"
  local interval="$2"
  local m="$offset"
  local parts=()
  while [[ "$m" -lt 60 ]]; do
    parts+=("$m")
    m=$((m + interval))
  done
  if [[ "${#parts[@]}" -eq 0 ]]; then
    parts=(0)
  fi
  local IFS=,
  echo "${parts[*]}"
}

CRON_MINUTES="$(build_cron_minutes "$CRON_OFFSET" "$INTERVAL_MIN")"
CRON_SCHED="${CRON_MINUTES} * * * *"
CRON_CMD="cd ${SCRIPT_DIR} && /bin/bash ${UPDATE_SCRIPT} >/dev/null 2>&1"

# Sanitize install dir for /etc/cron.d filename.
dir_slug="$(basename "$SCRIPT_DIR" | tr -c 'A-Za-z0-9._-' '_')"
CRON_D_FILE="/etc/cron.d/tc-${ROLE}-${dir_slug}"

remove_user_crontab_marker() {
  if ! command -v crontab >/dev/null 2>&1; then
    return 0
  fi
  local existing filtered
  existing="$(crontab -l 2>/dev/null || true)"
  filtered="$(printf '%s\n' "$existing" | grep -vF "$MARKER" || true)"
  printf '%s\n' "$filtered" | sed '/^$/d' | crontab - 2>/dev/null || true
}

install_cron_d() {
  local enabled="$1"
  if [[ "$enabled" -eq 1 ]]; then
    # cron.d requires a user field; root is correct for host Docker installs.
    cat >"$CRON_D_FILE" <<EOF
# Managed by onchain-invoice install-auto-update.sh — do not edit by hand
# ${MARKER}
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
${CRON_SCHED} root ${CRON_CMD}
EOF
    chmod 644 "$CRON_D_FILE"
    echo "Installed /etc/cron.d ($ROLE minutes ${CRON_MINUTES} every hour ≈${INTERVAL_MIN}m):"
    echo "  $CRON_D_FILE"
  else
    rm -f "$CRON_D_FILE"
    echo "Auto-update disabled for $ROLE — removed $CRON_D_FILE (if present)"
  fi
  # Avoid duplicate fires from an older user crontab entry.
  remove_user_crontab_marker
}

install_user_crontab() {
  local enabled="$1"
  if ! command -v crontab >/dev/null 2>&1; then
    echo "crontab not found and cannot write $CRON_D_FILE — schedule manually:" >&2
    echo "  ${CRON_SCHED} ${CRON_CMD} ${MARKER}" >&2
    exit 1
  fi
  local existing filtered cron_line
  existing="$(crontab -l 2>/dev/null || true)"
  filtered="$(printf '%s\n' "$existing" | grep -vF "$MARKER" || true)"
  cron_line="${CRON_SCHED} ${CRON_CMD} ${MARKER}"
  if [[ "$enabled" -eq 1 ]]; then
    {
      printf '%s\n' "$filtered"
      printf '%s\n' "$cron_line"
    } | sed '/^$/d' | crontab -
    echo "Installed user cron ($ROLE minutes ${CRON_MINUTES} every hour ≈${INTERVAL_MIN}m):"
    echo "  $cron_line"
  else
    printf '%s\n' "$filtered" | sed '/^$/d' | crontab -
    echo "Auto-update disabled for $ROLE — removed cron ($SCRIPT_DIR)"
  fi
}

if [[ -d /etc/cron.d && -w /etc/cron.d ]]; then
  install_cron_d "$cron_enabled"
else
  # Stale root cron.d from a previous root install — leave a hint if we can see it.
  if [[ -f "$CRON_D_FILE" && ! -w /etc/cron.d ]]; then
    echo "note: $CRON_D_FILE exists but /etc/cron.d is not writable — remove as root if switching to user crontab" >&2
  fi
  install_user_crontab "$cron_enabled"
fi
