#!/usr/bin/env bash
# Install cron for profile auto-update flags (.infra-profile + lib-env.sh).
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
# shellcheck source=lib-env.sh
source "$SCRIPT_DIR/lib-env.sh"
load_dotenv .env

PROFILE="${INFRA_PROFILE:-}"
ROLE="${ROLE:-}"
START_SCRIPT=""
UPDATE_SCRIPT=""
if [[ -f .infra-profile ]]; then
  # shellcheck source=/dev/null
  source .infra-profile
fi

if [[ -z "$ROLE" && -n "$PROFILE" ]]; then
  case "$PROFILE" in
    api) ROLE=backend ;;
    nodes) ROLE=workers ;;
    gateway) ROLE=gateway ;;
  esac
fi
if [[ -z "$ROLE" ]]; then
  if [[ -f start-onchain-invoice-gateway.sh ]]; then ROLE=gateway
  elif [[ -f start-onchain-invoice-nodes.sh ]]; then ROLE=workers
  elif [[ -f start-onchain-invoice-api.sh ]]; then ROLE=backend
  else ROLE=backend
  fi
fi

UPDATE_SCRIPT="${UPDATE_SCRIPT:-update.sh}"
[[ -x "$SCRIPT_DIR/$UPDATE_SCRIPT" ]] || UPDATE_SCRIPT="update.sh"

cron_enabled=0
INTERVAL_MIN=30
CRON_OFFSET=0

case "$ROLE" in
  backend|api)
    ROLE=api
    if role_auto_update_on API_AUTO_UPDATE; then cron_enabled=1; fi
    INTERVAL_MIN="${API_AUTO_UPDATE_INTERVAL_MIN:-30}"
    CRON_OFFSET=0
    ;;
  workers|nodes)
    ROLE=nodes
    if role_auto_update_on NODES_AUTO_UPDATE; then cron_enabled=1; fi
    INTERVAL_MIN="${NODES_AUTO_UPDATE_INTERVAL_MIN:-30}"
    CRON_OFFSET=10
    ;;
  gateway)
    if role_auto_update_on UI_TESTNET_AUTO_UPDATE \
      || role_auto_update_on UI_MAINNET_AUTO_UPDATE \
      || role_auto_update_on GATEWAY_AUTO_UPDATE \
      || role_auto_update_on UI_AUTO_UPDATE; then
      cron_enabled=1
    fi
    INTERVAL_MIN="${GATEWAY_AUTO_UPDATE_INTERVAL_MIN:-20}"
    CRON_OFFSET=20
    ;;
  *)
    ROLE="${ROLE:-api}"
    ;;
esac

MARKER="# infra-auto-update:${ROLE}:${SCRIPT_DIR}"
build_cron_minutes() {
  local cron_offset="${1:-0}"
  local cron_interval="${2:-30}"
  local m="$cron_offset" parts=()
  while [[ "$m" -lt 60 ]]; do parts+=("$m"); m=$((m + cron_interval)); done
  [[ "${#parts[@]}" -eq 0 ]] && parts=(0)
  local IFS=,
  echo "${parts[*]}"
}
CRON_MINUTES="$(build_cron_minutes "${CRON_OFFSET:-0}" "${INTERVAL_MIN:-30}")"
CRON_SCHED="${CRON_MINUTES} * * * *"
CRON_CMD="cd ${SCRIPT_DIR} && /bin/bash ${SCRIPT_DIR}/${UPDATE_SCRIPT} >/dev/null 2>&1"
dir_slug="$(basename "$SCRIPT_DIR" | tr -c 'A-Za-z0-9._-' '_')"
CRON_D_FILE="/etc/cron.d/infra-${ROLE}-${dir_slug}"

remove_user_crontab_marker() {
  command -v crontab >/dev/null 2>&1 || return 0
  local existing filtered
  existing="$(crontab -l 2>/dev/null || true)"
  filtered="$(printf '%s\n' "$existing" | grep -vF "$MARKER" || true)"
  printf '%s\n' "$filtered" | sed '/^$/d' | crontab - 2>/dev/null || true
}

if [[ "$cron_enabled" -eq 1 ]]; then
  if [[ -d /etc/cron.d && -w /etc/cron.d ]]; then
    cat >"$CRON_D_FILE" <<EOF
# Managed by infra install-auto-update.sh
# ${MARKER}
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/sbin:/bin:/usr/sbin:/usr/bin
${CRON_SCHED} root ${CRON_CMD}
EOF
    chmod 644 "$CRON_D_FILE"
    echo "Installed $CRON_D_FILE (minutes ${CRON_MINUTES})"
    remove_user_crontab_marker
  elif command -v crontab >/dev/null 2>&1; then
    existing="$(crontab -l 2>/dev/null || true)"
    filtered="$(printf '%s\n' "$existing" | grep -vF "$MARKER" || true)"
    { printf '%s\n' "$filtered"; echo "${CRON_SCHED} ${CRON_CMD} ${MARKER}"; } | sed '/^$/d' | crontab -
    echo "Installed user cron for $ROLE"
  fi
else
  rm -f "$CRON_D_FILE" 2>/dev/null || true
  remove_user_crontab_marker
  echo "Auto-update disabled for $ROLE"
fi

# Legacy tc-* cron cleanup marker compatibility
MARKER_LEGACY="# onchain-invoice-auto-update:${ROLE}:${SCRIPT_DIR}"
if command -v crontab >/dev/null 2>&1; then
  existing="$(crontab -l 2>/dev/null || true)"
  filtered="$(printf '%s\n' "$existing" | grep -vF "$MARKER_LEGACY" || true)"
  [[ "$cron_enabled" -eq 1 ]] || printf '%s\n' "$filtered" | sed '/^$/d' | crontab - 2>/dev/null || true
fi
