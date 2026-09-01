#!/usr/bin/env bash
# Lightweight CI parity (see .github/workflows/ci.yml). Skips Docker/GHCR/system-tests.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

# CI has no developer .env; Hardhat loads dotenv/config — skip it so isolated server tests match CI.
export DOTENV_CONFIG_PATH="${DOTENV_CONFIG_PATH:-/dev/null}"

echo "pre-commit-ci: npm test (tsc + Hardhat/Mocha under test/)"
npm test

echo "pre-commit-ci: npm run ui:build"
npm run ui:build

echo "pre-commit-ci: OK"
