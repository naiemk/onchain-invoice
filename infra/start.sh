#!/usr/bin/env bash
# Generic start — delegates to profile startScript from .infra-profile.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if [[ -f .infra-profile ]]; then
  # shellcheck source=/dev/null
  source .infra-profile
fi
TARGET="${START_SCRIPT:-start.sh}"
if [[ -x "$SCRIPT_DIR/$TARGET" && "$TARGET" != "start.sh" ]]; then
  exec "$SCRIPT_DIR/$TARGET" "$@"
fi
echo "No profile start script — run product-specific start script listed in .infra-profile" >&2
exit 1
