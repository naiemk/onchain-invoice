#!/usr/bin/env bash
# Install Trustless Commerce sweeper-node operator files into the current directory.
#
#   wget -qO- https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/install/install-nodes.sh | bash
#
# Creates (if missing):
#   onchain-invoice-nodes.yaml
#   start-onchain-invoice-nodes.sh
#   register-onchain-invoice-node.sh
#   .env.example / .env
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

write_if_missing "onchain-invoice-nodes.yaml"
write_if_missing "start-onchain-invoice-nodes.sh"
write_if_missing "register-onchain-invoice-node.sh"
write_if_missing "lib-env.sh"
write_if_missing "update-onchain-invoice-nodes.sh"
write_if_missing "install-auto-update.sh"
write_template ".env.nodes.example"

cp "$DEST/.env.nodes.example" "$DEST/.env.example"
echo "updated: $DEST/.env.example"

if [[ ! -f "$DEST/.env" ]]; then
  cp "$DEST/.env.example" "$DEST/.env"
  echo "created: $DEST/.env  (edit secrets before starting)"
else
  echo "exists: $DEST/.env (secrets preserved)"
  append_missing_env_keys "$DEST/.env.nodes.example" "$DEST/.env" \
    ACTIVITY_LOG_PATH AUTO_UPDATE AUTO_UPDATE_INTERVAL_MIN STOP_TIMEOUT
fi

(
  cd "$DEST"
  ROLE=nodes ./install-auto-update.sh || true
)

cat <<EOF

Trustless Commerce sweeper node install complete in:
  $DEST

Next:
  1. Edit $DEST/.env  (API_URL, ADMIN_API_KEY, SWEEPER_WALLET_KEY, …)
  2. Ensure API is up, then register this wallet:
       cd $DEST && ./register-onchain-invoice-node.sh
  3. Start the worker:
       cd $DEST && ./start-onchain-invoice-nodes.sh
  4. Logs:
       docker logs -f onchain-invoice-node
       tail -f $DEST/logs/activity.jsonl
  5. Auto-update (testnet default ON): ROLE=nodes ./install-auto-update.sh

EOF
