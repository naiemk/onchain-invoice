#!/usr/bin/env bash
# Install Trustless Commerce sweeper-node operator files into the current directory.
#
#   wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
#
# Creates (if missing):
#   onchain-invoice-nodes.yaml
#   start-onchain-invoice-nodes.sh
set -euo pipefail

RAW_BASE="${ONCHAIN_INVOICE_RAW:-https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install}"
DEST="${INSTALL_DIR:-.}"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

fetch_or_fail() {
  local url="$1"
  local out="$2"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$out"
  else
    wget -qO "$out" "$url"
  fi
}

write_if_missing() {
  local name="$1"
  local path="$DEST/$name"
  if [[ -f "$path" ]]; then
    echo "exists (unchanged): $path"
    return 0
  fi
  echo "downloading $name ..."
  fetch_or_fail "$RAW_BASE/$name" "$path"
  if [[ "$name" == *.sh ]]; then
    chmod +x "$path"
  fi
  echo "created: $path"
}

write_if_missing "onchain-invoice-nodes.yaml"
write_if_missing "start-onchain-invoice-nodes.sh"

cat <<EOF

Trustless Commerce sweeper node install complete in:
  $DEST

Next:
  1. Edit $DEST/onchain-invoice-nodes.yaml  (image, serverUrl, wallet key, chains)
  2. Register the sweeper wallet on the API:
       curl -X POST \$API/api/admin/sweepers -H "x-api-key: \$ADMIN_API_KEY" \\
         -H 'content-type: application/json' \\
         -d '{"address":"0x…","label":"node-1","chains":["11155111"]}'
  3. Export secrets used in the YAML, e.g.
       export SWEEPER_WALLET_KEY=0x... EVM_RPC_URL=https://... SWEEPER_ADDRESS=0x...
  4. Start:
       cd $DEST && ./start-onchain-invoice-nodes.sh

EOF
