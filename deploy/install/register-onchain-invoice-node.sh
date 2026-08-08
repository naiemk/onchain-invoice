#!/usr/bin/env bash
# Register this sweeper wallet on the Trustless Commerce API.
#
#   ./register-onchain-invoice-node.sh
#   ./register-onchain-invoice-node.sh --address 0x… --label dtn-node --chains 11155111
#
# Reads .env in this directory (API_URL / SERVER_URL, ADMIN_API_KEY, SWEEPER_REGISTER_ADDRESS, …).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Load .env when unset or empty (blank shell exports must not block defaults).
if [[ -f .env ]]; then
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
    key="${line%%=*}"
    val="${line#*=}"
    key="${key%%[[:space:]]*}"
    key="${key##[[:space:]]*}"
    key="${key%$'\r'}"
    val="${val%$'\r'}"
    if [[ "$val" =~ ^\"(.*)\"$ ]]; then val="${BASH_REMATCH[1]}"; fi
    if [[ "$val" =~ ^\'(.*)\'$ ]]; then val="${BASH_REMATCH[1]}"; fi
    [[ -z "$key" || "$key" == *[!A-Za-z0-9_]* ]] && continue
    if [[ -z "${!key-}" ]]; then
      export "$key=$val"
    fi
  done < .env
fi

ADDRESS="${SWEEPER_REGISTER_ADDRESS:-}"
LABEL="${SWEEPER_LABEL:-node-1}"
CHAINS="${SWEEPER_CHAINS:-11155111,nile,devnet}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --address)
      ADDRESS="${2:-}"
      shift 2
      ;;
    --label)
      LABEL="${2:-}"
      shift 2
      ;;
    --chains)
      CHAINS="${2:-}"
      shift 2
      ;;
    -h|--help)
      cat <<'EOF'
Usage: ./register-onchain-invoice-node.sh [--address 0x…] [--label name] [--chains 11155111,…]

Environment (.env):
  API_URL or SERVER_URL   API base URL (https://testnet.trustless-commerce.com)
  ADMIN_API_KEY           Admin key configured on the API
  SWEEPER_REGISTER_ADDRESS  Wallet address to register
  SWEEPER_LABEL           Label (default node-1)
  SWEEPER_CHAINS          Comma-separated chain ids (default 11155111,nile,devnet)
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

API_BASE="${API_URL:-${SERVER_URL:-}}"
API_BASE="${API_BASE%/}"

if [[ -z "$API_BASE" ]]; then
  echo "Set API_URL or SERVER_URL in .env" >&2
  exit 1
fi
if [[ -z "${ADMIN_API_KEY:-}" ]]; then
  echo "Set ADMIN_API_KEY in .env" >&2
  exit 1
fi
if [[ -z "$ADDRESS" ]]; then
  echo "Set SWEEPER_REGISTER_ADDRESS or pass --address" >&2
  exit 1
fi

# Build JSON chains array from comma-separated list.
CHAINS_JSON="$(printf '%s' "$CHAINS" | python3 -c '
import json,sys
parts=[p.strip() for p in sys.stdin.read().split(",") if p.strip()]
print(json.dumps(parts))
')"

BODY="$(python3 -c '
import json,sys
print(json.dumps({
  "address": sys.argv[1],
  "label": sys.argv[2],
  "chains": json.loads(sys.argv[3]),
  "enabled": True,
}))
' "$ADDRESS" "$LABEL" "$CHAINS_JSON")"

URL="${API_BASE}/api/admin/sweepers"
echo "POST $URL"
echo "  address=$ADDRESS label=$LABEL chains=$CHAINS"

if command -v curl >/dev/null 2>&1; then
  HTTP_CODE="$(curl -sS -o /tmp/oi-register-body.json -w '%{http_code}' \
    -X POST "$URL" \
    -H "x-api-key: ${ADMIN_API_KEY}" \
    -H 'content-type: application/json' \
    -d "$BODY")"
  BODY_OUT="$(cat /tmp/oi-register-body.json)"
  rm -f /tmp/oi-register-body.json
else
  # wget cannot easily capture status; use python
  BODY_OUT="$(API_URL="$URL" ADMIN_API_KEY="$ADMIN_API_KEY" BODY="$BODY" python3 - <<'PY'
import json, os, urllib.request
req = urllib.request.Request(
    os.environ["API_URL"],
    data=os.environ["BODY"].encode(),
    headers={"x-api-key": os.environ["ADMIN_API_KEY"], "content-type": "application/json"},
    method="POST",
)
try:
    with urllib.request.urlopen(req) as res:
        print(res.status)
        print(res.read().decode())
except urllib.error.HTTPError as e:
    print(e.code)
    print(e.read().decode())
PY
)"
  HTTP_CODE="$(printf '%s\n' "$BODY_OUT" | head -1)"
  BODY_OUT="$(printf '%s\n' "$BODY_OUT" | tail -n +2)"
fi

echo "$BODY_OUT"
if [[ "$HTTP_CODE" != "200" && "$HTTP_CODE" != "201" ]]; then
  echo "Register failed (HTTP $HTTP_CODE)" >&2
  exit 1
fi
echo "Sweeper registered OK"
