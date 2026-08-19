#!/usr/bin/env bash
# Shared helpers for system-tests (sourced by tests/*.sh).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/docker-compose.yml" --project-directory "$ROOT")

if [[ -f "$ROOT/.env" ]]; then
  # shellcheck disable=SC1091
  set -a && source "$ROOT/.env" && set +a
fi

ADMIN_API_KEY="${ADMIN_API_KEY:-system-test-admin}"
MERCHANT="0xc2eCF8b48b9D5D1Fd04b8A9c15126011aa1cC3Eb"
SWEEPER_ADDR="0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

api_json() {
  local method="$1"
  local path="$2"
  local body="${3:-}"
  local extra_headers="${4-}"
  # Pipe a single-line JSON envelope through stdin so shell quoting / docker exec
  # env-var limits never mangle the API key, Idempotency-Key, or request body.
  # Envelope format: {"method":"...","path":"...","body":"...","headers":{...}}
  local envelope
  envelope="$(python3 -c '
import json, sys
method = sys.argv[1]
path   = sys.argv[2]
body   = sys.argv[3]
try:
    extra = json.loads(sys.argv[4]) if len(sys.argv) > 4 and sys.argv[4] else {}
except Exception:
    extra = {}
print(json.dumps({"method": method, "path": path, "body": body, "headers": extra}))
' "$method" "$path" "$body" "${extra_headers:-}")"
  # Retry only when docker exec / fetch returns empty (transport flake).
  local attempts=5
  local attempt out=""
  for ((attempt=1; attempt<=attempts; attempt++)); do
    out="$(printf '%s\n' "$envelope" | "${COMPOSE[@]}" exec -T api node -e '
let raw = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => { raw += c; });
process.stdin.on("end", () => {
  const { method, path, body, headers: extra } = JSON.parse(raw);
  const headers = Object.assign(
    {},
    body ? { "content-type": "application/json" } : {},
    extra || {}
  );
  fetch("http://127.0.0.1:8080" + path, {
    method,
    headers,
    body: body || undefined,
  }).then(async (res) => {
    process.stdout.write(JSON.stringify({ status: res.status, body: await res.text() }));
    process.exit(0);
  }).catch((e) => { console.error(String(e)); process.exit(1); });
});
' 2>/dev/null || true)"
    if [[ -n "$out" ]]; then
      printf '%s' "$out"
      return 0
    fi
    sleep 1
  done
  echo "api_json failed after retries: $method $path" >&2
  return 1
}

https_get() {
  local path="$1"
  "${COMPOSE[@]}" exec -T -e T_PATH="$path" api node -e '
fetch("http://ui" + process.env.T_PATH).then(async (res) => {
  const text = await res.text();
  if (!res.ok) { console.error(text); process.exit(1); }
  process.stdout.write(text);
}).then(() => process.exit(0)).catch((e) => { console.error(String(e)); process.exit(1); });
'
}

https_headers() {
  local path="$1"
  "${COMPOSE[@]}" exec -T nginx wget -S -O /dev/null "http://127.0.0.1${path}" 2>&1 || true
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  [[ "$haystack" == *"$needle"* ]] || {
    echo "expected to find: $needle" >&2
    echo "in: $haystack" >&2
    return 1
  }
}

assert_status() {
  local wrapped="$1"
  local code="$2"
  if [[ -z "$wrapped" ]]; then
    echo "assert_status: empty response" >&2
    return 1
  fi
  python3 -c 'import json,sys; d=json.loads(sys.argv[1]); assert d["status"]==int(sys.argv[2]), d' "$wrapped" "$code"
}

assert_body_ok() {
  local wrapped="$1"
  python3 -c 'import json,sys; d=json.loads(sys.argv[1]); b=json.loads(d["body"]); assert b.get("ok") is True, b' "$wrapped"
}

assert_body_field() {
  local wrapped="$1"
  local expr="$2"
  python3 -c 'import json,sys; d=json.loads(sys.argv[1]); b=json.loads(d["body"]); assert eval(sys.argv[2], {"b": b}), (b, sys.argv[2])' "$wrapped" "$expr"
}

assert_contains_ci() {
  local haystack="$1"
  local needle="$2"
  local h n
  h="$(printf '%s' "$haystack" | tr '[:upper:]' '[:lower:]')"
  n="$(printf '%s' "$needle" | tr '[:upper:]' '[:lower:]')"
  [[ "$h" == *"$n"* ]] || {
    echo "expected to find (ci): $needle" >&2
    echo "in: $haystack" >&2
    return 1
  }
}
