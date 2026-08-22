#!/usr/bin/env bash
# Trustless Commerce — product install wrapper (all components).
#   wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install.sh | bash
set -euo pipefail
REF="${ONCHAIN_INVOICE_REF:-main}"
PACKAGER_RAW="${PACKAGER_RAW:-https://raw.githubusercontent.com/naiemk/onchain-invoice/${REF}/infra}"
PACKAGECONFIG_URL="${PACKAGECONFIG_URL:-https://raw.githubusercontent.com/naiemk/onchain-invoice/${REF}/deploy/packageconfig.yaml}"
export PACKAGER_RAW PACKAGECONFIG_URL INSTALL_DIR="${INSTALL_DIR:-.}"
if command -v curl >/dev/null 2>&1; then
  exec bash <(curl -fsSL "${PACKAGER_RAW}/install.sh") "$@"
else
  exec bash <(wget -qO- "${PACKAGER_RAW}/install.sh") "$@"
fi
