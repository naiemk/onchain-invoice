#!/usr/bin/env bash
# Install Trustless Commerce API operator files into the current directory.
#
#   wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-api.sh | bash
#
# Creates (if missing):
#   onchain-invoice-api.yaml
#   start-onchain-invoice-api.sh
#   .env.example
#   .env  (from .env.example, only if .env is missing)
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

write_template() {
  local name="$1"
  local path="$DEST/$name"
  echo "refreshing $name ..."
  fetch_or_fail "$RAW_BASE/$name" "$path"
  echo "updated: $path"
}

append_missing_env_keys() {
  local example="$1"
  local envfile="$2"
  shift 2
  [[ -f "$example" && -f "$envfile" ]] || return 0
  local key line added=0
  for key in "$@"; do
    if grep -qE "^[[:space:]]*${key}=" "$envfile"; then
      continue
    fi
    line="$(grep -E "^[[:space:]]*${key}=" "$example" | head -1 || true)"
    [[ -n "$line" ]] || continue
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

write_if_missing "onchain-invoice-api.yaml"
write_if_missing "start-onchain-invoice-api.sh"
write_if_missing "lib-env.sh"
write_if_missing "update-onchain-invoice-api.sh"
write_if_missing "install-auto-update.sh"
write_template ".env.api.example"

cp "$DEST/.env.api.example" "$DEST/.env.example"
echo "updated: $DEST/.env.example"

if [[ ! -f "$DEST/.env" ]]; then
  cp "$DEST/.env.example" "$DEST/.env"
  echo "created: $DEST/.env  (edit secrets before starting)"
else
  echo "exists: $DEST/.env (secrets preserved)"
  append_missing_env_keys "$DEST/.env.api.example" "$DEST/.env" \
    AUTO_UPDATE AUTO_UPDATE_INTERVAL_MIN STOP_TIMEOUT
fi

(
  cd "$DEST"
  ROLE=api ./install-auto-update.sh || true
)

cat <<EOF

Trustless Commerce API install complete in:
  $DEST

Next:
  1. Edit $DEST/.env  (ADMIN_API_KEY, SWEEPER_API_KEY, BASE_URL, Sepolia addresses)
  2. Start:
       cd $DEST && ./start-onchain-invoice-api.sh
  3. Health:
       curl -s http://localhost:8080/api/health
  4. Auto-update (off by default): set AUTO_UPDATE=1 then ROLE=api ./install-auto-update.sh

EOF
