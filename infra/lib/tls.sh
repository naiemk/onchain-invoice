# shellcheck shell=bash
# TLS / certbot helpers.

infra_tls_check() {
  local fullchain="$1"
  local privkey="$2"
  [[ -f "$fullchain" && -f "$privkey" ]]
}

infra_tls_suggest_certbot() {
  local domains=("$@")
  local joined=""
  local d
  for d in "${domains[@]}"; do
    joined+=" -d $d"
  done
  cat <<EOF

TLS certificates not found. Issue with certbot (port 80 must be free):

  sudo certbot certonly --standalone${joined}

Or after gateway HTTP is up (webroot):

  sudo certbot certonly --webroot -w /var/www/certbot${joined}

Then set TLS_FULLCHAIN and TLS_PRIVKEY in .env and run ./start.sh

EOF
}

infra_tls_offer_interactive() {
  local fullchain="$1"
  local privkey="$2"
  shift 2
  local domains=("$@")
  if infra_tls_check "$fullchain" "$privkey"; then
    return 0
  fi
  infra_tls_suggest_certbot "${domains[@]}"
  if [[ ! -t 0 ]]; then
    return 0
  fi
  read -r -p "Run certbot --standalone now? [y/N] " ans
  case "$ans" in
    y|Y|yes|YES)
      if ! command -v certbot >/dev/null 2>&1; then
        echo "certbot not found — install certbot first" >&2
        return 1
      fi
      local args=()
      local d
      for d in "${domains[@]}"; do
        args+=(-d "$d")
      done
      sudo certbot certonly --standalone "${args[@]}"
      ;;
  esac
}
