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
  # SYSTEM_TEST_API_URL hits a server on the host (no compose). CI leaves it unset.
  local attempts=5
  local attempt out=""
  local fetch_js='
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
  const base = process.env.API_BASE || "http://127.0.0.1:8080";
  fetch(base + path, {
    method,
    headers,
    body: body || undefined,
  }).then(async (res) => {
    const setCookie = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    process.stdout.write(JSON.stringify({ status: res.status, body: await res.text(), setCookie }));
    process.exit(0);
  }).catch((e) => { console.error(String(e)); process.exit(1); });
});
'
  for ((attempt=1; attempt<=attempts; attempt++)); do
    if [[ -n "${SYSTEM_TEST_API_URL:-}" ]]; then
      out="$(printf '%s\n' "$envelope" | API_BASE="$SYSTEM_TEST_API_URL" node -e "$fetch_js" 2>/dev/null || true)"
    else
      out="$(printf '%s\n' "$envelope" | "${COMPOSE[@]}" exec -T -e API_BASE=http://127.0.0.1:8080 api node -e "$fetch_js" 2>/dev/null || true)"
    fi
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

# Name=value pairs from Set-Cookie, ready to send back as a Cookie header.
response_set_cookie() {
  python3 -c '
import json, sys
d = json.loads(sys.argv[1])
parts = []
for c in d.get("setCookie") or []:
    name = c.split(";", 1)[0].strip()
    if name:
        parts.append(name)
print("; ".join(parts))
' "$1"
}

# Email OTP + passkey register. Prints {"address","cookie","credentialId","identityId"}.
# The API must be started with IDENTITY_DEV_OTP=1 so the sign-in code is readable.
create_identity_wallet() {
  local label="$1"
  local email qx qy cred started otp code to verified cookie headers body registered
  email="sys-${label}-$(date +%s)-${RANDOM}@example.com"
  qx="0x$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  qy="0x$(python3 -c 'import secrets; print(secrets.token_hex(32))')"
  cred="e2e-${label}-$(date +%s)-${RANDOM}"

  started="$(api_json POST /api/identity/email/start "{\"email\":\"${email}\"}")"
  assert_status "$started" 200
  assert_body_field "$started" 'b.get("ok") is True and not b.get("exists")'

  otp="$(api_json GET /api/identity/email/dev-otp)"
  assert_status "$otp" 200
  code="$(python3 -c 'import json,sys; print(json.loads(json.loads(sys.argv[1])["body"]).get("code") or "")' "$otp")"
  to="$(python3 -c 'import json,sys; print(json.loads(json.loads(sys.argv[1])["body"]).get("to") or "")' "$otp")"
  if [[ "$to" != "$email" || ! "$code" =~ ^[0-9]{6}$ ]]; then
    echo "dev OTP for ${email} was not issued (set IDENTITY_DEV_OTP=1): ${otp}" >&2
    return 1
  fi

  verified="$(api_json POST /api/identity/email/verify "{\"email\":\"${email}\",\"code\":\"${code}\"}")"
  assert_status "$verified" 200
  cookie="$(response_set_cookie "$verified")"
  if [[ "$cookie" != *"tc_identity="* ]]; then
    echo "identity verify did not set tc_identity: ${verified}" >&2
    return 1
  fi

  headers="$(python3 -c 'import json,sys; print(json.dumps({"cookie": sys.argv[1]}))' "$cookie")"
  body="{\"qx\":\"${qx}\",\"qy\":\"${qy}\",\"credentialId\":\"${cred}\"}"
  registered="$(api_json POST /api/identity/passkey/register "$body" "$headers")"
  assert_status "$registered" 201
  assert_body_field "$registered" 'isinstance(b.get("wallets"), list) and b["wallets"] and b["wallets"][0].get("address")'

  python3 -c '
import json, sys
d = json.loads(sys.argv[1])
b = json.loads(d["body"])
print(json.dumps({
  "address": b["wallets"][0]["address"],
  "identityId": b.get("identityId"),
  "cookie": sys.argv[2],
  "credentialId": sys.argv[3],
}))
' "$registered" "$cookie" "$cred"
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
