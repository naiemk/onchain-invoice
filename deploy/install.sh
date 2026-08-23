#!/usr/bin/env bash
# Trustless Commerce — product install wrapper (all components).
set -euo pipefail
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [[ -f "$_SCRIPT_DIR/install/packager.sh" ]]; then
  # shellcheck source=install/packager.sh
  source "$_SCRIPT_DIR/install/packager.sh"
  _infra_resolve_packager
  export PACKAGER_RAW
  export PACKAGECONFIG_URL="${PACKAGECONFIG_URL:-${_infra_repo_root}/deploy/packageconfig.yaml}"
  export INSTALL_DIR="${INSTALL_DIR:-.}"
  if [[ "$PACKAGER_RAW" =~ ^/ ]]; then
    exec bash "$PACKAGER_RAW/install.sh" "$@"
  fi
fi
REF="${ONCHAIN_INVOICE_REF:-main}"
PACKAGER_RAW="${PACKAGER_RAW:-https://raw.githubusercontent.com/naiemk/vibed-infra/main}"
PACKAGECONFIG_URL="${PACKAGECONFIG_URL:-https://raw.githubusercontent.com/naiemk/onchain-invoice/${REF}/deploy/packageconfig.yaml}"
export PACKAGER_RAW PACKAGECONFIG_URL INSTALL_DIR="${INSTALL_DIR:-.}"
if command -v curl >/dev/null 2>&1; then
  exec bash <(curl -fsSL "${PACKAGER_RAW}/install.sh") "$@"
else
  exec bash <(wget -qO- "${PACKAGER_RAW}/install.sh") "$@"
fi
