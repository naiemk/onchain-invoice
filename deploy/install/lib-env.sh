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

# Return 0 if the named env var is a truthy flag (1/true/yes/on).
env_flag_on() {
  local name="$1"
  local val="${!name-}"
  case "$val" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

# Primary role flag (set including to 0), with legacy AUTO_UPDATE if unset.
role_auto_update_on() {
  local primary="$1"
  if [[ -n "${!primary+x}" ]]; then
    env_flag_on "$primary"
    return
  fi
  env_flag_on AUTO_UPDATE
}

log_update() {
  local dir="${1:-.}"
  local msg="$2"
  mkdir -p "$dir/logs"
  local line
  line="$(date -u +"%Y-%m-%dT%H:%M:%SZ") $msg"
  echo "$line" | tee -a "$dir/logs/auto-update.log"
}

# Host-wide lock so api/nodes/gateway crons cannot pile up docker pulls.
# Prefer /var/lock; fall back to /tmp when not writable (non-root operators).
resolve_update_lock_file() {
  if [[ -n "${UPDATE_LOCK_FILE:-}" ]]; then
    echo "$UPDATE_LOCK_FILE"
    return 0
  fi
  if [[ -d /var/lock && -w /var/lock ]]; then
    echo /var/lock/tc-auto-update.lock
    return 0
  fi
  echo /tmp/tc-auto-update.lock
}

# Run the given function name under a non-blocking flock.
# If the lock is busy, log and return 0 (skip) so cron does not stack.
# Usage: with_update_lock "$SCRIPT_DIR" "api" run_api_update
with_update_lock() {
  local log_dir="$1"
  local role_label="$2"
  local fn="$3"
  local lock
  lock="$(resolve_update_lock_file)"
  # Open FD 9 on the lock file for flock.
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
  # Hold lock for the duration of fn.
  "$fn"
  local rc=$?
  flock -u 9 2>/dev/null || true
  exec 9>&-
  return "$rc"
}

# Local image id (sha256:...) or empty if missing.
local_image_id() {
  local image="$1"
  docker image inspect -f '{{.Id}}' "$image" 2>/dev/null || true
}

# Best-effort remote manifest digest (sha256:...). Empty if inspect fails.
remote_image_digest() {
  local image="$1"
  local digest=""
  if docker buildx imagetools inspect "$image" -f '{{.Manifest.Digest}}' >/tmp/tc-digest.out 2>/dev/null; then
    digest="$(tr -d '[:space:]' </tmp/tc-digest.out)"
  elif docker buildx imagetools inspect "$image" -f '{{println .Manifest.Digest}}' >/tmp/tc-digest.out 2>/dev/null; then
    digest="$(tr -d '[:space:]' </tmp/tc-digest.out)"
  fi
  rm -f /tmp/tc-digest.out 2>/dev/null || true
  if [[ "$digest" == sha256:* ]]; then
    echo "$digest"
  fi
}

# Local RepoDigest for image (sha256:...) if present.
local_repo_digest() {
  local image="$1"
  docker image inspect -f '{{range .RepoDigests}}{{println .}}{{end}}' "$image" 2>/dev/null \
    | sed -n 's/.*@//p' \
    | head -1
}

# Pull only when remote digest differs from local RepoDigest (or image missing).
# Echoes a short status string for logging.
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
    # Cannot probe registry — fall back to docker pull (usually a no-op when current).
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

# Optional docker --memory flag helper (empty if unset).
memory_args() {
  local limit="${1:-}"
  if [[ -n "$limit" ]]; then
    echo --memory="$limit"
  fi
}
