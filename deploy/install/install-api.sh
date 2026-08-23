#!/usr/bin/env bash
# Install Trustless Commerce API — thin wrapper over vibed-infra packager.
#
#   wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-api.sh | bash
set -euo pipefail
_SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
if [[ -f "$_SCRIPT_DIR/packager.sh" ]]; then
  # shellcheck source=packager.sh
  source "$_SCRIPT_DIR/packager.sh"
  _infra_run_install api
fi
REF="${ONCHAIN_INVOICE_REF:-main}"
PACKAGER_RAW="${PACKAGER_RAW:-https://raw.githubusercontent.com/naiemk/vibed-infra/main}"
PACKAGECONFIG_URL="${PACKAGECONFIG_URL:-https://raw.githubusercontent.com/naiemk/onchain-invoice/${REF}/deploy/packageconfig.yaml}"
export PACKAGER_RAW PACKAGECONFIG_URL INFRA_PROFILE=api INSTALL_DIR="${INSTALL_DIR:-.}"
if command -v curl >/dev/null 2>&1; then
  exec bash <(curl -fsSL "${PACKAGER_RAW}/install.sh") --profile api
else
  exec bash <(wget -qO- "${PACKAGER_RAW}/install.sh") --profile api
fi
