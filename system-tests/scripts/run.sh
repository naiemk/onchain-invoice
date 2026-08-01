#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

cleanup() {
  bash "$ROOT/scripts/down.sh" || true
}
trap cleanup EXIT

bash "$ROOT/scripts/up.sh"

failed=0
for test in "$ROOT"/tests/*.sh; do
  name="$(basename "$test")"
  echo ""
  echo "======== $name ========"
  if bash "$test"; then
    echo "PASS $name"
  else
    echo "FAIL $name" >&2
    failed=1
  fi
done

if [[ "$failed" -ne 0 ]]; then
  echo "" >&2
  echo "System tests FAILED" >&2
  docker compose logs --tail=100 >&2 || true
  exit 1
fi

echo ""
echo "Compose system tests OK — tearing down before wget install e2e"
bash "$ROOT/scripts/down.sh" || true
# Avoid double-down noise on EXIT after a clean handoff.
trap - EXIT
# Let Docker settle before installer containers claim host port 8080.
sleep 2

echo ""
bash "$ROOT/scripts/run-install-e2e.sh"

echo ""
echo "SYSTEM TESTS OK"
