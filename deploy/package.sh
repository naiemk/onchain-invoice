#!/usr/bin/env bash
# Package tctest + tcmain dist/ for vibed-infra wget install, then apply TC overlays.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$ROOT/.." && pwd)"
PACKAGER="$(node -e "console.log(require('path').dirname(require.resolve('vibed-infra/package.json')))" 2>/dev/null || true)"
if [[ -z "$PACKAGER" || ! -d "$PACKAGER" ]]; then
  echo "vibed-infra not found — run npm install from repo root" >&2
  exit 1
fi

GITHUB_RAW="${GITHUB_RAW:-https://raw.githubusercontent.com/naiemk/onchain-invoice/main}"
OVERLAYS="$ROOT/overlays"

package_one() {
  local product="$1"
  local product_dir="$ROOT/$product"
  local out="$product_dir/dist"
  local raw_base="${GITHUB_RAW}/deploy/${product}/dist"

  echo "==> packaging $product → $out"
  bash "$PACKAGER/package.sh" \
    --product "$product_dir" \
    --out "$out" \
    --raw-base "$raw_base" \
    --packager-raw "https://raw.githubusercontent.com/naiemk/vibed-infra/main"

  # TC lifecycle overlays (replace generic hello-vps style scripts)
  cp -f "$OVERLAYS/start-api.sh" "$out/start-api.sh"
  cp -f "$OVERLAYS/update-api.sh" "$out/update-api.sh"
  cp -f "$OVERLAYS/start-nodes.sh" "$out/start-nodes.sh"
  cp -f "$OVERLAYS/update-nodes.sh" "$out/update-nodes.sh"
  chmod +x "$out"/start-*.sh "$out"/update-*.sh

  cp -f "$OVERLAYS/docker-compose.workers.${product}.yml" "$out/docker-compose.workers.yml"
  cp -f "$OVERLAYS/onchain-invoice-bundler.yaml" "$out/onchain-invoice-bundler.yaml"
  cp -f "$OVERLAYS/onchain-invoice-wallet-deployer.yaml" "$out/onchain-invoice-wallet-deployer.yaml"
  cp -f "$OVERLAYS/register-onchain-invoice-node.sh" "$out/register-onchain-invoice-node.sh"
  cp -f "$OVERLAYS/register-onchain-invoice-bundler.sh" "$out/register-onchain-invoice-bundler.sh"
  chmod +x "$out"/register-*.sh

  cp -f "$OVERLAYS/env.api.${product}.example" "$out/.env.api.example"
  cp -f "$OVERLAYS/env.ui.${product}.example" "$out/.env.ui.example"
  cp -f "$OVERLAYS/env.nodes.${product}.example" "$out/.env.nodes.example"

  # Ensure nodes install fetches multi-worker extras
  python3 - "$out/packageconfig.yaml" <<'PY'
import sys
from pathlib import Path

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8")
extras = [
    "onchain-invoice-bundler.yaml",
    "onchain-invoice-wallet-deployer.yaml",
    "register-onchain-invoice-node.sh",
    "register-onchain-invoice-bundler.sh",
]
# Insert extras under profiles.nodes if missing
if "extras:" in text and "onchain-invoice-bundler.yaml" in text:
    sys.exit(0)
marker = "  nodes:\n"
idx = text.find(marker)
if idx < 0:
    raise SystemExit("profiles.nodes not found in packageconfig")
# Find templates block end inside nodes — insert extras after role/workers section start
# Prefer after "role: workers"
insert_at = text.find("role: workers", idx)
if insert_at < 0:
    raise SystemExit("role: workers not found")
line_end = text.find("\n", insert_at)
block = "\n    extras:\n" + "".join(f"      - {e}\n" for e in extras)
text = text[: line_end + 1] + block + text[line_end + 1 :]
path.write_text(text, encoding="utf-8")
print("patched packageconfig extras for nodes")
PY

  # Interim: vibed-infra dump_yaml emits bare `*` for list items (invalid YAML alias).
  # Quote until upstream quotes special scalars in nested lists.
  python3 - "$out/api-app.yaml" <<'PYCORS'
import sys
from pathlib import Path
p = Path(sys.argv[1])
if not p.is_file():
    sys.exit(0)
text = p.read_text(encoding="utf-8")
fixed = text.replace("\n    - *\n", '\n    - "*"\n').replace("\n  - *\n", '\n  - "*"\n')
# Also fix when * is alone on origins list with two-space indent variants
import re
fixed2 = re.sub(r"(?m)^(\s+- )\*$", r'\1"*"', text)
if fixed2 != text:
    p.write_text(fixed2, encoding="utf-8")
    print("    quoted bare * in api-app.yaml cors origins")
PYCORS

  echo "    done: $out"
}

package_one tctest
package_one tcmain
echo "OK — commit deploy/tctest/dist and deploy/tcmain/dist"
