#!/usr/bin/env bash
# Infra packager — single wget entrypoint.
#
#   wget -qO- $PACKAGER_RAW/install.sh | env INFRA_PROFILE=api PACKAGECONFIG_URL=... bash
#
# Product wrappers set PACKAGECONFIG_URL and INFRA_PROFILE.
set -euo pipefail

PACKAGER_RAW="${PACKAGER_RAW:-${INFRA_RAW:-https://raw.githubusercontent.com/naiemk/onchain-invoice/main/infra}}"
DEST="${INSTALL_DIR:-.}"
PROFILE="${INFRA_PROFILE:-}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile) PROFILE="$2"; shift 2 ;;
    --components)
      IFS=',' read -ra _comps <<<"$2"
      for c in "${_comps[@]}"; do
        case "$c" in
          app|backend|api) PROFILE=api; break ;;
          workers|nodes) PROFILE=nodes; break ;;
          gateway) PROFILE=gateway; break ;;
        esac
      done
      shift 2
      ;;
    --dest) DEST="$2"; shift 2 ;;
    -h|--help)
      echo "usage: install.sh [--profile api|nodes|gateway] [--dest DIR]"
      exit 0
      ;;
    *) shift ;;
  esac
done

mkdir -p "$DEST"
DEST="$(cd "$DEST" && pwd)"

# Bootstrap libs from packager (works when piped via wget|bash).
INFRA_LIB="$DEST/.infra-lib"
mkdir -p "$INFRA_LIB"
_fetch() {
  local url="$1" out="$2"
  if command -v curl >/dev/null 2>&1; then curl -fsSL "$url" -o "$out"; else wget -qO "$out" "$url"; fi
}
for lib in fetch.sh env.sh prompt.sh tls.sh load_config.py generate.py; do
  _fetch "${PACKAGER_RAW}/lib/${lib}" "${INFRA_LIB}/${lib}"
done
for lib in start.sh update.sh install-auto-update.sh; do
  _fetch "${PACKAGER_RAW}/${lib}" "${DEST}/${lib}"
  chmod +x "${DEST}/${lib}"
done

# shellcheck source=/dev/null
source "${INFRA_LIB}/fetch.sh"
# shellcheck source=/dev/null
source "${INFRA_LIB}/prompt.sh"
# shellcheck source=/dev/null
source "${INFRA_LIB}/tls.sh"

cd "$DEST"

if [[ -z "$PROFILE" ]]; then
  PROFILE="$(infra_pick_profile)"
fi

PACKAGECONFIG_URL="${PACKAGECONFIG_URL:-${PACKAGE_CONFIG_URL:-${PACKAGER_RAW%/infra}/deploy/packageconfig.yaml}}"
PC_LOCAL="$DEST/.packageconfig.yaml"
infra_fetch "$PACKAGECONFIG_URL" "$PC_LOCAL"

PRODUCT_RAW="${ONCHAIN_INVOICE_RAW:-$(
  python3 -c "
import sys
sys.path.insert(0, '${INFRA_LIB}')
from load_config import load_packageconfig
from pathlib import Path
print(load_packageconfig(Path('${PC_LOCAL}')).get('rawBase',''))
"
)}"
[[ -n "$PRODUCT_RAW" ]] || PRODUCT_RAW="https://raw.githubusercontent.com/naiemk/onchain-invoice/main/deploy/templates"

echo "== infra install profile=$PROFILE dest=$DEST =="

_py_profile() {
  python3 -c "
import sys, json
sys.path.insert(0, '${INFRA_LIB}')
from load_config import load_packageconfig, get_profile
from pathlib import Path
p = get_profile(load_packageconfig(Path('${PC_LOCAL}')), '${PROFILE}')
print(json.dumps(p))
"
}

PROF_JSON="$(_py_profile)"
ROLE="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('role','backend'))" "$PROF_JSON")"
START_SCRIPT="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('startScript','start.sh'))" "$PROF_JSON")"
UPDATE_SCRIPT="$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('updateScript','update.sh'))" "$PROF_JSON")"
ENV_EXAMPLE="$(python3 -c "import json,sys; t=json.loads(sys.argv[1]).get('templates') or {}; print(t.get('envExample','.env.example'))" "$PROF_JSON")"
CONFIG_FILE="$(python3 -c "import json,sys; t=json.loads(sys.argv[1]).get('templates') or {}; print(t.get('config',''))" "$PROF_JSON")"
COMPOSE_TPL="$(python3 -c "import json,sys; t=json.loads(sys.argv[1]).get('templates') or {}; print(t.get('compose',''))" "$PROF_JSON")"
COMPOSE_MAINNET="$(python3 -c "import json,sys; t=json.loads(sys.argv[1]).get('templates') or {}; print(t.get('composeMainnet',''))" "$PROF_JSON")"

cp -f "${INFRA_LIB}/env.sh" "$DEST/lib-env.sh"
mkdir -p "$DEST/lib"
cp -f "${INFRA_LIB}/load_config.py" "$DEST/lib/"
cp -f "${INFRA_LIB}/generate.py" "$DEST/lib/"

if [[ -n "$ENV_EXAMPLE" ]]; then
  infra_write_template "${PRODUCT_RAW}/${ENV_EXAMPLE}" "$DEST/${ENV_EXAMPLE}" 0
  cp -f "$DEST/${ENV_EXAMPLE}" "$DEST/.env.example"
fi
if [[ -n "$CONFIG_FILE" ]]; then
  infra_write_if_missing "${PRODUCT_RAW}/${CONFIG_FILE}" "$DEST/${CONFIG_FILE}" 0
  infra_write_template "${PRODUCT_RAW}/${CONFIG_FILE}" "$DEST/${CONFIG_FILE}" 0
fi
if [[ -n "$COMPOSE_TPL" ]]; then
  infra_write_if_missing "${PRODUCT_RAW}/${COMPOSE_TPL}" "$DEST/${COMPOSE_TPL}" 0
  infra_write_template "${PRODUCT_RAW}/${COMPOSE_TPL}" "$DEST/${COMPOSE_TPL}" 0
fi
if [[ -n "$COMPOSE_MAINNET" ]]; then
  infra_write_template "${PRODUCT_RAW}/${COMPOSE_MAINNET}" "$DEST/${COMPOSE_MAINNET}" 0
fi

# Generic infra compose templates (optional USE_COMPOSE=1)
case "$ROLE" in
  backend)
    infra_write_template "${PACKAGER_RAW}/templates/docker-compose.backend.yml" "$DEST/docker-compose.backend.yml" 0
    ;;
  workers)
    infra_write_template "${PACKAGER_RAW}/templates/docker-compose.workers.yml" "$DEST/docker-compose.workers.yml" 0
    ;;
  gateway)
    infra_write_template "${PACKAGER_RAW}/templates/docker-compose.gateway.yml" "$DEST/docker-compose.gateway.yml" 0
    ;;
esac

if [[ -n "$START_SCRIPT" && "$START_SCRIPT" != "start.sh" ]]; then
  infra_write_if_missing "${PRODUCT_RAW}/${START_SCRIPT}" "$DEST/${START_SCRIPT}" 1
  infra_write_template "${PRODUCT_RAW}/${START_SCRIPT}" "$DEST/${START_SCRIPT}" 1
fi
if [[ -n "$UPDATE_SCRIPT" && "$UPDATE_SCRIPT" != "update.sh" ]]; then
  infra_write_if_missing "${PRODUCT_RAW}/${UPDATE_SCRIPT}" "$DEST/${UPDATE_SCRIPT}" 1
  infra_write_template "${PRODUCT_RAW}/${UPDATE_SCRIPT}" "$DEST/${UPDATE_SCRIPT}" 1
fi

python3 -c "
import json, sys
extras = json.loads(sys.argv[1]).get('extras') or []
for e in extras:
    print(e)
" "$PROF_JSON" | while read -r extra; do
  [[ -n "$extra" ]] || continue
  infra_write_if_missing "${PRODUCT_RAW}/${extra}" "$DEST/${extra}" 1
  infra_write_template "${PRODUCT_RAW}/${extra}" "$DEST/${extra}" 1
done

if [[ "$ROLE" == "gateway" ]]; then
  mkdir -p "$DEST/gateway/conf.d"
  infra_write_if_missing "${PRODUCT_RAW}/gateway/nginx.conf" "$DEST/gateway/nginx.conf" 0
  infra_write_template "${PRODUCT_RAW}/gateway/nginx.conf" "$DEST/gateway/nginx.conf" 0
  if python3 "${INFRA_LIB}/generate.py" "$PC_LOCAL" --profile "$PROFILE" -o "$DEST/gateway/conf.d/domains.conf" 2>/dev/null; then
    echo "generated: gateway/conf.d/domains.conf"
  else
    infra_write_if_missing "${PRODUCT_RAW}/gateway/conf.d/domains.conf" "$DEST/gateway/conf.d/domains.conf" 0
    infra_write_template "${PRODUCT_RAW}/gateway/conf.d/domains.conf" "$DEST/gateway/conf.d/domains.conf" 0
  fi
fi

if [[ ! -f "$DEST/.env" ]]; then
  cp "$DEST/.env.example" "$DEST/.env"
  echo "created: $DEST/.env"
else
  echo "exists: $DEST/.env"
fi

cat >"$DEST/.infra-profile" <<EOF
PROFILE=${PROFILE}
ROLE=${ROLE}
START_SCRIPT=${START_SCRIPT}
UPDATE_SCRIPT=${UPDATE_SCRIPT}
EOF

chmod +x "$DEST/${START_SCRIPT}" 2>/dev/null || true
INFRA_PROFILE="$PROFILE" ./install-auto-update.sh || true

if [[ "$ROLE" == "gateway" ]]; then
  # shellcheck source=/dev/null
  source "$DEST/lib-env.sh"
  load_dotenv "$DEST/.env"
  TLS_FULLCHAIN="${TLS_FULLCHAIN:-/etc/letsencrypt/live/trustless-commerce.com/fullchain.pem}"
  TLS_PRIVKEY="${TLS_PRIVKEY:-/etc/letsencrypt/live/trustless-commerce.com/privkey.pem}"
  mapfile -t DOMAIN_ARR < <(python3 -c "
import sys, json
sys.path.insert(0, '${INFRA_LIB}')
from load_config import load_packageconfig, get_profile
from pathlib import Path
p = get_profile(load_packageconfig(Path('${PC_LOCAL}')), '${PROFILE}')
for s in p.get('sites') or []:
    print(s['host'])
    for a in s.get('aliases') or []:
        print(a)
")
  infra_tls_offer_interactive "$TLS_FULLCHAIN" "$TLS_PRIVKEY" "${DOMAIN_ARR[@]}"
fi

echo ""
echo "Install complete. Start: cd $DEST && ./${START_SCRIPT}"
