#!/usr/bin/env bash
# Snapshot every product's host config (.env, YAML, compose) and running image digests into
# ~/tc-config-records/<UTC timestamp>/ (dir 700, files 600). COPIES only — never renames or moves
# service files (no *.bak). Prints names + sha256, never secret values.
# Usage: ./config-record.sh [services-root]   (default ~/services)
set -euo pipefail

ROOT="${1:-$HOME/services}"
OUT_BASE="${TC_CONFIG_RECORDS:-$HOME/tc-config-records}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$OUT_BASE/$STAMP"
umask 077
mkdir -p "$OUT"

for product in tcmain tctest; do
  for role in api ui nodes; do
    src="$ROOT/$product/$role"
    [[ -d "$src" ]] || continue
    dest="$OUT/$product/$role"
    mkdir -p "$dest"
    for f in .env api-app.yaml nodes-workers.yaml onchain-invoice-bundler.yaml onchain-invoice-wallet-deployer.yaml \
             docker-compose.backend.yml docker-compose.workers.yml .packageconfig.yaml; do
      if [[ -r "$src/$f" ]]; then
        cp -p "$src/$f" "$dest/${f#.}" 2>/dev/null || cp -p "$src/$f" "$dest/$f"
      elif [[ -e "$src/$f" ]]; then
        echo "WARN: cannot read $src/$f (owned by $(stat -c %U "$src/$f" 2>/dev/null || echo other))" >&2
      fi
    done
  done
done

if command -v docker >/dev/null 2>&1; then
  docker ps --format '{{.Names}} {{.Image}} {{.ID}}' 2>/dev/null | grep -E '^(tcmain|tctest)-' > "$OUT/containers.txt" || true
  for c in $(awk '{print $1}' "$OUT/containers.txt" 2>/dev/null); do
    printf '%s %s\n' "$c" "$(docker inspect -f '{{.Image}}' "$c")"
  done > "$OUT/image-digests.txt" || true
fi

chmod -R go-rwx "$OUT"
ln -sfn "$OUT" "$OUT_BASE/latest"
echo "Config record written: $OUT"
( cd "$OUT" && find . -type f ! -name '*.txt' -print0 | xargs -0 sha256sum | sed 's#  \./#  #' )
