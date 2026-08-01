# shellcheck shell=bash
# Sourced by start/update scripts. Loads .env when vars are unset or empty.
load_dotenv() {
  local env_file="${1:-.env}"
  [[ -f "$env_file" ]] || return 0
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "${line//[[:space:]]/}" || "$line" =~ ^[[:space:]]*# ]] && continue
    local key="${line%%=*}"
    local val="${line#*=}"
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
  done <"$env_file"
}

auto_update_enabled() {
  case "${AUTO_UPDATE:-0}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

log_update() {
  local dir="${1:-.}"
  local msg="$2"
  mkdir -p "$dir/logs"
  local line
  line="$(date -u +"%Y-%m-%dT%H:%M:%SZ") $msg"
  echo "$line" | tee -a "$dir/logs/auto-update.log"
}

# Return 0 if container image id differs from the named image's current id (update needed).
container_needs_image() {
  local name="$1"
  local image="$2"
  if ! docker inspect "$name" >/dev/null 2>&1; then
    return 0
  fi
  local running new
  running="$(docker inspect -f '{{.Image}}' "$name" 2>/dev/null || true)"
  new="$(docker image inspect -f '{{.Id}}' "$image" 2>/dev/null || true)"
  [[ -z "$running" || -z "$new" || "$running" != "$new" ]]
}

graceful_stop() {
  local name="$1"
  local timeout="${2:-180}"
  if docker inspect "$name" >/dev/null 2>&1; then
    # Prefer stop (SIGTERM + grace) so sweeper can drain; start scripts rm -f afterward.
    docker stop -t "$timeout" "$name" >/dev/null 2>&1 || true
  fi
}
