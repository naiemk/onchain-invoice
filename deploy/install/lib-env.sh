# shellcheck shell=bash
# Repo checkout: source infra/lib/env.sh. VPS install dir: lib-env.sh is a full copy from infra install.
_REPO_INFRA="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)/infra/lib/env.sh"
if [[ -f "$_REPO_INFRA" ]]; then
  # shellcheck source=../../infra/lib/env.sh
  source "$_REPO_INFRA"
fi
# If not sourced from repo (VPS install), this file is replaced by infra install with full env.sh body.
