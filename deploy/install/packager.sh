#!/usr/bin/env bash
# Shared packager resolution for deploy/install wrappers (repo checkout or wget).
set -euo pipefail

_infra_install_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_infra_repo_root="$(cd "$_infra_install_dir/../.." && pwd)"

_infra_resolve_packager() {
  if [[ -n "${PACKAGER_RAW:-}" ]]; then
    return 0
  fi
  if [[ -f "$_infra_repo_root/scripts/packager-root.mjs" ]]; then
    local root
    root="$(node "$_infra_repo_root/scripts/packager-root.mjs" 2>/dev/null)" || true
  if [[ -n "$root" && -x "$root/install.sh" ]]; then
    PACKAGER_RAW="$root"
    export ONCHAIN_INVOICE_RAW="${ONCHAIN_INVOICE_RAW:-${_infra_repo_root}/deploy/templates}"
    return 0
  fi
  fi
  PACKAGER_RAW="${PACKAGER_RAW:-https://raw.githubusercontent.com/naiemk/vibed-infra/main}"
}

_infra_run_install() {
  local profile="$1"
  _infra_resolve_packager
  export PACKAGER_RAW
  export PACKAGECONFIG_URL="${PACKAGECONFIG_URL:-${_infra_repo_root}/deploy/packageconfig.yaml}"
  export INFRA_PROFILE="$profile"
  export INSTALL_DIR="${INSTALL_DIR:-.}"
  if [[ "$PACKAGER_RAW" =~ ^/ ]]; then
    exec bash "$PACKAGER_RAW/install.sh" --profile "$profile"
  fi
  if command -v curl >/dev/null 2>&1; then
    exec bash <(curl -fsSL "${PACKAGER_RAW}/install.sh") --profile "$profile"
  else
    exec bash <(wget -qO- "${PACKAGER_RAW}/install.sh") --profile "$profile"
  fi
}
