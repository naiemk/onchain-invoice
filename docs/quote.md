# Quote API (Onramper)

Public endpoints that price card/bank funding into on-chain USDC/USDT settlement. Used by the create-invoice wizard and by agents that build fiat / combined invoices.

Requires Onramper enabled on the instance. When keys are absent, responses may include `"demo": true` with synthetic quotes.

## `GET /api/public/onramp`

Instance capability probe.

```json
{
  "enabled": true,
  "sandbox": false,
  "demo": false,
  "fiats": ["SEK", "EUR", "USD", "GBP"],
  "supportedPairs": [
    { "chainId": "1", "token": "USDC" },
    { "chainId": "8453", "token": "USDC" },
    { "chainId": "tron", "token": "USDT" }
  ]
}
```

## `GET /api/public/onramp-methods`

Payment methods available for a fiat + country + pair set.

| Query | Notes |
|-------|-------|
| `fiat` | Required (e.g. `SEK`) |
| `country` | ISO-3166 alpha-2 (default `us`) |
| `pairs` | `1:USDC,8453:USDC,tron:USDT` |
| `chains` + `tokens` | Alias for `pairs` (cartesian product of supported pairs) |
| `expand=1` | Include method metadata |

## `GET /api/public/onramp-quote`

### Query parameters

| Param | Aliases | Notes |
|-------|---------|-------|
| `fiat` | — | Required |
| `direction` | — | `receive` (fixed crypto → fiat cost) or `pay` (fixed fiat → crypto settlement). Default `receive`. |
| `cryptoAmount` | `crypto_amount` | Required for `receive` |
| `fiatAmount` | `fiat_amount` | Required for `pay` |
| `country` | — | Default `us` |
| `paymentMethod` | `payment_method` | Omit for Auto / recommended |
| `provider` | — | Preferred Onramper ramp id |
| `chainId` + `token` | `chain_id` | Single-pair mode |
| `pairs` | `pair` | Multi-pair (comma-separated `chainId:token`) |
| `chains` + `tokens` | — | Same shape as `POST /api/invoices`; expanded to supported pairs |
| `slippageBps` | `slippage_bps` | Optional; response includes `minSettlement` / `maxSettlement` |

### Response

```json
{
  "fiat": "SEK",
  "fiatAmount": "500.00",
  "cryptoAmount": "45.12",
  "paymentMethod": "swish",
  "country": "se",
  "direction": "pay",
  "chainId": "8453",
  "token": "USDC",
  "provider": "revolut",
  "slippageBps": 100,
  "minSettlement": "44.6688",
  "maxSettlement": "45.5712",
  "quotes": [
    {
      "provider": "revolut",
      "paymentMethod": "swish",
      "fiatAmount": "500.00",
      "cryptoAmount": "45.12"
    }
  ],
  "recommended": {
    "provider": "revolut",
    "paymentMethod": "swish",
    "fiatAmount": "500.00",
    "cryptoAmount": "45.12"
  }
}
```

`chainId` / `token` / `country` / `paymentMethod` / `provider` are always echoed so the quote maps 1:1 onto create.

### Quote → create mapping

| Quote field | Invoice create field |
|-------------|----------------------|
| `fiat` | `displayFiat` |
| `fiatAmount` | `displayAmount` |
| `cryptoAmount` | `price` |
| `country` | `quoteCountry` |
| `paymentMethod` | `quotePaymentMethod` |
| `recommended.provider` (or chosen provider) | `quoteProvider` |
| `slippageBps` | `quoteSlippageBps` |
| `chainId` / `token` | `chainId` / `token` (and include in `chains` / `tokens`) |

### Cascade rules

See [Invoice types — Fiat field cascade](invoice-types.md#fiat-field-cascade-create-ui--agents).

### Errors

Structured Onramper errors return JSON with `code` such as:

- `onramp_limit_mismatch` — amount outside `minAmount` / `maxAmount`
- `onramp_no_payment_method`
- `onramp_quote_unavailable`
- `onramp_provider_unavailable`

### Rate limits

Quote and methods use the dedicated **`quote`** bucket (default 2/s sustained, burst 20 per IP). Exceeding returns **429** with `Retry-After`, `RateLimit-Remaining`, and `RateLimit-Reset`. See [HTTP API — Rate limiting](api.md#rate-limiting).

## Pay-time session

After create, card checkout:

```http
POST /api/invoices/{id}/onramp-session
Content-Type: application/json

{ "fiat": "SEK" }
```

Requotes with `skipCache: true` and enforces `quoteSlippageBps`. Drift beyond the limit → **410** `quote_expired`.
