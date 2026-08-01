#!/usr/bin/env bash
# Install HTTPS gateway (nginx + UI) operator files.
#
#   wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-gateway.sh | bash
#
# Creates (if missing): start script, .env, gateway/nginx.conf, gateway/conf.d/domains.conf
set -euo pipefail

RAW_BASE="${ONCHAIN_INVOICE_RAW:-https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install}"
DEST="${INSTALL_DIR:-.}"
mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

fetch_or_fail() {
  local url="$1"
  local out="$2"
  mkdir -p "$(dirname "$out")"
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

write_if_missing "start-onchain-invoice-gateway.sh"
write_if_missing "lib-env.sh"
write_if_missing "update-onchain-invoice-gateway.sh"
write_if_missing "install-auto-update.sh"
write_if_missing ".env.gateway.example"
write_if_missing "gateway/nginx.conf"
write_if_missing "gateway/conf.d/domains.conf"

if [[ ! -f "$DEST/.env.example" ]]; then
  cp "$DEST/.env.gateway.example" "$DEST/.env.example"
  echo "created: $DEST/.env.example"
fi
if [[ ! -f "$DEST/.env" ]]; then
  cp "$DEST/.env.example" "$DEST/.env"
  echo "created: $DEST/.env  (edit TLS paths if needed)"
else
  echo "exists (unchanged): $DEST/.env"
fi

(
  cd "$DEST"
  ROLE=gateway ./install-auto-update.sh || true
)

cat <<EOF

Trustless Commerce HTTPS gateway install complete in:
  $DEST

Prereqs:
  1. DNS A records: @, www, testnet → this host
  2. Let's Encrypt cert (example):
       sudo certbot certonly --standalone \\
         -d trustless-commerce.com -d www.trustless-commerce.com -d testnet.trustless-commerce.com
  3. API containers on network trustless-commerce-edge named:
       testnet-api  and  mainnet-api
     (see install-api.sh + DOCKER_NETWORK / docker.name in YAML)

Next:
  1. Edit $DEST/.env
  2. cd $DEST && ./start-onchain-invoice-gateway.sh
  3. curl -fsS https://testnet.trustless-commerce.com/api/health
  4. Auto-update (default ON every 5m): ROLE=gateway ./install-auto-update.sh

EOF
