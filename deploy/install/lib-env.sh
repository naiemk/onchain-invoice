# shellcheck shell=bash
# Repo checkout: source vibed-infra lib/env.sh from node_modules.
_REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if [[ -f "$_REPO_ROOT/scripts/packager-root.mjs" ]]; then
  _VIBED_ROOT="$(node "$_REPO_ROOT/scripts/packager-root.mjs" 2>/dev/null)" || true
  if [[ -n "$_VIBED_ROOT" && -f "$_VIBED_ROOT/lib/env.sh" ]]; then
    # shellcheck source=../../node_modules/vibed-infra/lib/env.sh
    source "$_VIBED_ROOT/lib/env.sh"
  fi
fi
# VPS install dir: lib-env.sh is a full copy from infra install.
