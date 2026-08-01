#!/usr/bin/env bash
# Install Trustless Commerce API operator files into the current directory.
#
#   wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-api.sh | bash
#
# Creates (if missing):
#   onchain-invoice-api.yaml
#   start-onchain-invoice-api.sh
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

write_if_missing "onchain-invoice-api.yaml"
write_if_missing "start-onchain-invoice-api.sh"

cat <<EOF

Trustless Commerce API install complete in:
  $DEST

Next:
  1. Edit $DEST/onchain-invoice-api.yaml  (image, keys, sweeperAddress, …)
  2. Export secrets if you use \${ENV} placeholders, e.g.
       export ADMIN_API_KEY=... SWEEPER_API_KEY=... SWEEPER_ADDRESS=0x...
  3. Start:
       cd $DEST && ./start-onchain-invoice-api.sh

EOF
