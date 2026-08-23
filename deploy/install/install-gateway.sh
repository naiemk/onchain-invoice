#!/usr/bin/env bash
# Install HTTPS gateway — thin wrapper over vibed-infra packager.
set -euo pipefail
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [[ -f "$_SCRIPT_DIR/packager.sh" ]]; then
  # shellcheck source=packager.sh
  source "$_SCRIPT_DIR/packager.sh"
  _infra_run_install gateway
fi
REF="${ONCHAIN_INVOICE_REF:-main}"
PACKAGER_RAW="${PACKAGER_RAW:-https://raw.githubusercontent.com/naiemk/vibed-infra/main}"
PACKAGECONFIG_URL="${PACKAGECONFIG_URL:-https://raw.githubusercontent.com/naiemk/onchain-invoice/${REF}/deploy/packageconfig.yaml}"
export PACKAGER_RAW PACKAGECONFIG_URL INFRA_PROFILE=gateway INSTALL_DIR="${INSTALL_DIR:-.}"
if command -v curl >/dev/null 2>&1; then
  exec bash <(curl -fsSL "${PACKAGER_RAW}/install.sh") --profile gateway
else
  exec bash <(wget -qO- "${PACKAGER_RAW}/install.sh") --profile gateway
fi
