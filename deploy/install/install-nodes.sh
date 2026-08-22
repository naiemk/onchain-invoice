#!/usr/bin/env bash
# Install Trustless Commerce sweeper nodes — thin wrapper over infra packager.
#
#   wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
set -euo pipefail
REF="${ONCHAIN_INVOICE_REF:-main}"
PACKAGER_RAW="${PACKAGER_RAW:-https://raw.githubusercontent.com/naiemk/onchain-invoice/${REF}/infra}"
PACKAGECONFIG_URL="${PACKAGECONFIG_URL:-https://raw.githubusercontent.com/naiemk/onchain-invoice/${REF}/deploy/packageconfig.yaml}"
export PACKAGER_RAW PACKAGECONFIG_URL INFRA_PROFILE=nodes INSTALL_DIR="${INSTALL_DIR:-.}"
if command -v curl >/dev/null 2>&1; then
  exec bash <(curl -fsSL "${PACKAGER_RAW}/install.sh") --profile nodes
else
  exec bash <(wget -qO- "${PACKAGER_RAW}/install.sh") --profile nodes
fi
