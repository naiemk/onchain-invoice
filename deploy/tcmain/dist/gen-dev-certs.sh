#!/usr/bin/env bash
# Self-signed certs for lab / CI. Not for production.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${1:-$SCRIPT_DIR/certs}"
HOST="${APP_HOST:-hello.example.com}"
mkdir -p "$DEST"
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout "$DEST/privkey.pem" \
  -out "$DEST/fullchain.pem" \
  -subj "/CN=${HOST}" \
  -addext "subjectAltName=DNS:${HOST},DNS:www.${HOST},DNS:localhost"
chmod 644 "$DEST/fullchain.pem"
chmod 600 "$DEST/privkey.pem"
echo "Wrote $DEST/fullchain.pem and $DEST/privkey.pem"
echo "Set TLS_FULLCHAIN / TLS_PRIVKEY in gateway .env to these paths."
