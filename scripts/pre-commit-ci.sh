#!/usr/bin/env bash
# Lightweight CI parity (see .github/workflows/ci.yml). Skips Docker/GHCR/system-tests.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "pre-commit-ci: npm test (tsc + Hardhat/Mocha under test/)"
npm test

echo "pre-commit-ci: npm run ui:build"
npm run ui:build

echo "pre-commit-ci: OK"
