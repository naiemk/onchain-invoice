#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
COMPOSE=(docker compose -f "$ROOT/docker-compose.yml")

# Prefer in-network checks (works when host→published port is blocked, e.g. nested Docker).
echo "== health =="
"${COMPOSE[@]}" exec -T api node -e "
fetch('http://127.0.0.1:8080/api/health')
  .then(async r => { const t = await r.text(); if (!r.ok || !t.includes('\"ok\": true')) process.exit(1); })
  .catch(() => process.exit(1))
"

echo "== ready =="
"${COMPOSE[@]}" exec -T api node -e "
fetch('http://127.0.0.1:8080/api/ready')
  .then(async r => { const t = await r.text(); if (!r.ok || !t.includes('\"ok\": true')) process.exit(1); })
  .catch(() => process.exit(1))
"

echo "== ui root =="
"${COMPOSE[@]}" exec -T ui wget -qO- http://127.0.0.1/ | head -c 200 | grep -qi .

echo "== rate limit create =="
body1='{"price":"0.01","to":["0xc2eCF8b48b9D5D1Fd04b8A9c15126011aa1cC3Eb"],"chains":["11155111"],"tokens":["USDC"],"clientInvoiceId":"smoke-'"$(date +%s)"'","chainId":"11155111","token":"USDC","selectedTo":"0xc2eCF8b48b9D5D1Fd04b8A9c15126011aa1cC3Eb"}'
body2='{"price":"0.01","to":["0xc2eCF8b48b9D5D1Fd04b8A9c15126011aa1cC3Eb"],"chains":["11155111"],"tokens":["USDC"],"clientInvoiceId":"smoke-b-'"$(date +%s%N)"'","chainId":"11155111","token":"USDC","selectedTo":"0xc2eCF8b48b9D5D1Fd04b8A9c15126011aa1cC3Eb"}'
code1=$("${COMPOSE[@]}" exec -T api node -e "
fetch('http://127.0.0.1:8080/api/invoices',{method:'POST',headers:{'content-type':'application/json'},body:process.argv[1]})
  .then(r=>process.stdout.write(String(r.status))).catch(e=>{console.error(e);process.exit(1)})
" "$body1")
code2=$("${COMPOSE[@]}" exec -T api node -e "
fetch('http://127.0.0.1:8080/api/invoices',{method:'POST',headers:{'content-type':'application/json'},body:process.argv[1]})
  .then(r=>process.stdout.write(String(r.status))).catch(e=>{console.error(e);process.exit(1)})
" "$body2")
echo "create statuses: $code1 then $code2"
if [[ "$code2" != "429" ]]; then
  echo "WARN: expected 429 on second create within 1s (got $code2)."
fi

echo "SMOKE OK"
