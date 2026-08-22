# shellcheck shell=bash
# Fetch helpers for infra packager.

infra_fetch() {
  local url="$1"
  local out="$2"
  mkdir -p "$(dirname "$out")"
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$out"
  else
    wget -qO "$out" "$url"
  fi
}

infra_write_if_missing() {
  local url="$1"
  local path="$2"
  local executable="${3:-0}"
  if [[ -f "$path" ]]; then
    echo "exists (unchanged): $path"
    return 0
  fi
  echo "downloading $(basename "$path") ..."
  infra_fetch "$url" "$path"
  if [[ "$executable" == "1" ]]; then
    chmod +x "$path"
  fi
  echo "created: $path"
}

infra_write_template() {
  local url="$1"
  local path="$2"
  local executable="${3:-0}"
  echo "refreshing $(basename "$path") ..."
  infra_fetch "$url" "$path"
  if [[ "$executable" == "1" ]]; then
    chmod +x "$path"
  fi
  echo "updated: $path"
}
