# Pay-in API (card / bank → Base USDC)

Public endpoints that quote and start card/bank checkout into **USDC on Base** (`8453`). Used by `/buy`, invoice card checkout on `/pay`, and wallet cash-in.

Requires MetaMask pay-in enabled on the instance (`METAMASK_ONRAMP_ENABLED`, default on). Checkout opens in a **new tab** at the provider (MoonPay, Banxa, Ramp, Coinbase). There is no create-time quote and no Onramper session.

Fiat and combined invoices settle as Base USDC. Crypto-only invoices stay multi-chain.

## `GET /api/public/pay-in/config`

Instance capability probe.

```json
{
  "enabled": true,
  "chainId": "8453",
  "token": "USDC",
  "tokenAddress": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
}
```

## `GET /api/public/pay-in/countries`

Regions MetaMask can quote (id, name, default fiat).

## `GET /api/public/pay-in/geo`

Payer country from CDN/edge IP headers (`CF-IPCountry`, `x-vercel-ip-country`, …). The UI prefers Cloudflare’s browser `cdn-cgi/trace` (client IP) and uses this as fallback. Query `country=` still overrides.

```json
{ "country": "LT" }
```

## `GET /api/public/pay-in/quotes`

| Query | Notes |
|-------|-------|
| `region` or `country` | MetaMask region id (`de`, `us-mi`) |
| `fiat` | e.g. `EUR` |
| `amount` | Fiat to spend |
| `address` or `walletAddress` | Destination EVM wallet (required) |

Response includes `quotes[]` with provider, payment method, USDC out, and fees. All listed providers can be opened in a new tab.

## `GET /api/public/pay-in/widget`

Returns `{ widgetUrl, embeddable, provider, orderId }` for the chosen quote. The UI opens `widgetUrl` in a new tab (popup-safe: blank tab on click, then navigate).

| Query | Notes |
|-------|-------|
| `region`, `fiat`, `amount`, `address` | Same as quotes |
| `providerId` | e.g. `/providers/moonpay` |
| `paymentMethodId` | e.g. `/payments/debit-credit-card` |

`GET /api/public/pay-in/buy-url` is an alias of this route.

## Card funding an invoice

1. Create a fiat or combined invoice with `price` (USDC), `chains: ["8453"]`, `tokens: ["USDC"]`. Optional `displayFiat` / `displayAmount` / `quoteCountry` are payer hints only.
2. Payer opens `/pay?id=…` (crypto QR still works for combined) or `/buy?address={invoiceAddress}&amount=…&fiat=EUR&country=de&invoice={id}`.
3. Continue fetches the widget URL and opens provider checkout in a new tab.
4. Poll `GET /api/invoices/{id}` until `paid` — funding is detected on `invoiceAddress`; there is no onramp-session webhook.

Direct buy (no invoice): `/buy?address=0x…&amount=100&fiat=SEK&country=se`.

### Rate limits

Pay-in routes use the dedicated **`quote`** bucket (default 2/s sustained, burst 20 per IP). Exceeding returns **429** with `Retry-After`, `RateLimit-Remaining`, and `RateLimit-Reset`. See [HTTP API — Rate limiting](api.md#rate-limiting).
