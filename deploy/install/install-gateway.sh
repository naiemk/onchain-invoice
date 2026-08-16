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

# Templates are safe to overwrite (no secrets). Keeps auto-update docs current on re-install.
write_template() {
  local name="$1"
  local path="$DEST/$name"
  echo "refreshing $name ..."
  fetch_or_fail "$RAW_BASE/$name" "$path"
  echo "updated: $path"
}

# Append KEY=… from example into .env when the key is absent (never overwrites).
append_missing_env_keys() {
  local example="$1"
  local envfile="$2"
  shift 2
  [[ -f "$example" && -f "$envfile" ]] || return 0
  local key line added=0
  local legacy_off=0
  if grep -qiE "^[[:space:]]*AUTO_UPDATE=(0|false|off)\b" "$envfile"; then
    legacy_off=1
  fi
  for key in "$@"; do
    if grep -qE "^[[:space:]]*${key}=" "$envfile"; then
      continue
    fi
    line="$(grep -E "^[[:space:]]*${key}=" "$example" | head -1 || true)"
    [[ -n "$line" ]] || continue
    # Preserve legacy AUTO_UPDATE=0 when introducing role-specific flags.
    if [[ "$legacy_off" -eq 1 && "$key" == *_AUTO_UPDATE ]]; then
      line="${key}=0"
    fi
    if [[ "$added" -eq 0 ]]; then
      {
        echo ""
        echo "# --- Auto-update (added by install; see .env.example) ---"
      } >>"$envfile"
    fi
    echo "$line" >>"$envfile"
    echo "appended to .env: $key"
    added=1
  done
}

write_if_missing "start-onchain-invoice-gateway.sh"
write_if_missing "lib-env.sh"
write_if_missing "update-onchain-invoice-gateway.sh"
write_if_missing "install-auto-update.sh"
write_if_missing "gateway/nginx.conf"
write_if_missing "gateway/conf.d/domains.conf"
write_template ".env.gateway.example"
write_template "start-onchain-invoice-gateway.sh"
write_template "update-onchain-invoice-gateway.sh"
write_template "lib-env.sh"
write_template "install-auto-update.sh"
for f in start-onchain-invoice-gateway.sh update-onchain-invoice-gateway.sh install-auto-update.sh; do
  if [[ -f "$DEST/$f" ]]; then
    chmod +x "$DEST/$f"
  fi
done

cp "$DEST/.env.gateway.example" "$DEST/.env.example"
echo "updated: $DEST/.env.example"

if [[ ! -f "$DEST/.env" ]]; then
  cp "$DEST/.env.example" "$DEST/.env"
  echo "created: $DEST/.env  (edit TLS paths if needed)"
else
  echo "exists: $DEST/.env (secrets preserved)"
  append_missing_env_keys "$DEST/.env.gateway.example" "$DEST/.env" \
    UI_TESTNET_AUTO_UPDATE UI_MAINNET_AUTO_UPDATE GATEWAY_AUTO_UPDATE \
    GATEWAY_AUTO_UPDATE_INTERVAL_MIN GATEWAY_STOP_TIMEOUT \
    UI_MEMORY_LIMIT GATEWAY_MEMORY_LIMIT
fi

(
  cd "$DEST"
  ./install-auto-update.sh || true
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
  4. Auto-update (UI/nginx flags in .env): ./install-auto-update.sh

EOF
