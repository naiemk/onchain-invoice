#!/usr/bin/env bash
# Generic update — delegates to profile updateScript from .infra-profile.
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
if [[ -f .infra-profile ]]; then
  # shellcheck source=/dev/null
  source .infra-profile
fi
TARGET="${UPDATE_SCRIPT:-update.sh}"
if [[ -x "$SCRIPT_DIR/$TARGET" && "$TARGET" != "update.sh" ]]; then
  exec "$SCRIPT_DIR/$TARGET" "$@"
fi
echo "No profile update script — run product-specific update script listed in .infra-profile" >&2
exit 1
