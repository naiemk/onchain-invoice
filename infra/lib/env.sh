# shellcheck shell=bash
# Environment helpers for infra packager.

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

env_flag_on() {
  local name="$1"
  local val="${!name-}"
  case "$val" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

role_auto_update_on() {
  local primary="$1"
  if [[ -n "${!primary+x}" ]]; then
    env_flag_on "$primary"
    return
  fi
  env_flag_on AUTO_UPDATE
}

any_auto_update_on() {
  local flag
  for flag in "$@"; do
    if role_auto_update_on "$flag"; then
      return 0
    fi
  done
  return 1
}

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
    if [[ "$legacy_off" -eq 1 && "$key" == *_AUTO_UPDATE ]]; then
      line="${key}=0"
    fi
    if [[ "$added" -eq 0 ]]; then
      {
        echo ""
        echo "# --- Auto-update (added by infra install; see .env.example) ---"
      } >>"$envfile"
    fi
    echo "$line" >>"$envfile"
    echo "appended to .env: $key"
    added=1
  done
}

log_update() {
  local dir="${1:-.}"
  local msg="$2"
  mkdir -p "$dir/logs"
  local line
  line="$(date -u +"%Y-%m-%dT%H:%M:%SZ") $msg"
  echo "$line" | tee -a "$dir/logs/auto-update.log"
}

resolve_update_lock_file() {
  if [[ -n "${UPDATE_LOCK_FILE:-}" ]]; then
    echo "$UPDATE_LOCK_FILE"
    return 0
  fi
  if [[ -d /var/lock && -w /var/lock ]]; then
    echo /var/lock/infra-auto-update.lock
    return 0
  fi
  echo /tmp/infra-auto-update.lock
}

with_update_lock() {
  local log_dir="$1"
  local role_label="$2"
  local fn="$3"
  local lock
  lock="$(resolve_update_lock_file)"
  exec 9>"$lock" || {
    log_update "$log_dir" "${role_label}: cannot open lock $lock — proceeding without flock"
    "$fn"
    return $?
  }
  if ! flock -n 9; then
    log_update "$log_dir" "${role_label}: another auto-update holds $lock — skip"
    exec 9>&-
    return 0
  fi
  "$fn"
  local rc=$?
  flock -u 9 2>/dev/null || true
  exec 9>&-
  return "$rc"
}

local_image_id() {
  local image="$1"
  docker image inspect -f '{{.Id}}' "$image" 2>/dev/null || true
}

remote_image_digest() {
  local image="$1"
  local digest="" out
  if out="$(docker buildx imagetools inspect "$image" --format '{{.Manifest.Digest}}' 2>/dev/null)"; then
    digest="$(printf '%s\n' "$out" | tr -d '[:space:]')"
  fi
  if [[ "$digest" != sha256:* ]]; then
    if out="$(docker buildx imagetools inspect "$image" -f '{{.Manifest.Digest}}' 2>/dev/null)"; then
      digest="$(printf '%s\n' "$out" | tr -d '[:space:]')"
    fi
  fi
  if [[ "$digest" != sha256:* ]]; then
    if out="$(docker buildx imagetools inspect "$image" 2>/dev/null)"; then
      digest="$(printf '%s\n' "$out" | awk '/^Digest:/{print $2; exit}')"
    fi
  fi
  if [[ "$digest" == sha256:* ]]; then
    echo "$digest"
  fi
}

local_repo_digest() {
  local image="$1"
  docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$image" 2>/dev/null \
    | sed -n 's/.*@//p' \
    | head -1
}

pull_image_if_needed() {
  local image="$1"
  local remote locald
  if ! docker image inspect "$image" >/dev/null 2>&1; then
    docker pull "$image" >/dev/null
    echo "pulled (missing locally)"
    return 0
  fi
  remote="$(remote_image_digest "$image")"
  if [[ -z "$remote" ]]; then
    docker pull "$image" >/dev/null
    echo "pulled (digest probe unavailable)"
    return 0
  fi
  locald="$(local_repo_digest "$image")"
  if [[ -n "$locald" && "$locald" == "$remote" ]]; then
    echo "skipped (already $remote)"
    return 0
  fi
  docker pull "$image" >/dev/null
  echo "pulled ($remote)"
}

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
    docker stop -t "$timeout" "$name" >/dev/null 2>&1 || true
  fi
}

memory_args() {
  local limit="${1:-}"
  if [[ -n "$limit" ]]; then
    echo --memory="$limit"
  fi
}

chown_data_dir() {
  local dir="$1"
  local uid="${2:-1000}"
  mkdir -p "$dir"
  if [[ "$(id -u)" -eq 0 ]]; then
    chown -R "${uid}:${uid}" "$dir" || true
  elif command -v sudo >/dev/null 2>&1; then
    sudo chown -R "${uid}:${uid}" "$dir" 2>/dev/null || \
      echo "warning: could not chown $dir to ${uid} — fix if container cannot write" >&2
  else
    echo "warning: ensure $dir is writable by uid ${uid}" >&2
  fi
  chmod 755 "$dir" 2>/dev/null || true
}
