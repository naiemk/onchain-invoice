#!/usr/bin/env bash
# Point this clone at repo-managed hooks (.githooks/pre-commit mirrors CI).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

chmod +x .githooks/pre-commit scripts/pre-commit-ci.sh

git config core.hooksPath .githooks

echo "Installed git hooks: core.hooksPath=.githooks"
echo "Pre-commit runs: npm test && npm run ui:build (same as .github/workflows/ci.yml)"
echo "Bypass once: git commit --no-verify"
echo "Run manually: npm run precommit"
