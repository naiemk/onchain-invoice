# Invoice types

Trustless Commerce invoices use `paymentMode` (not a separate `invoiceType` field):

| Mode | UI label | Meaning |
|------|----------|---------|
| `crypto` | Crypto | On-chain payment only (default) |
| `crypto_or_fiat` | Combined | Payer may pay with crypto **or** card/bank (Onramper) |
| `fiat` | Fiat | Card/bank only; settlement still lands on-chain as USDC/USDT |

Fiat modes require Onramper enabled on the instance (`ONRAMPER_ENABLED` + keys, or demo mode).

## Per-type fields

### Crypto (`paymentMode: "crypto"`)

| Field | Required | Notes |
|-------|----------|-------|
| `price` | yes | Settlement amount in USD (USDC/USDT face value) |
| `to` | yes | Merchant address(es) matching selected chains |
| `chains` / `tokens` | yes | At least one compatible pair |
| `allowPartial` | no | Default `false` |
| `clientInvoiceId`, `title`, `description`, `callback`, `lang` | no | Metadata |

### Combined (`paymentMode: "crypto_or_fiat"`)

Same as crypto, plus optional quote hints used when the payer chooses card/bank:

| Field | Required | Notes |
|-------|----------|-------|
| `displayFiat` | no | Preferred customer currency (e.g. `EUR`) |
| `quoteCountry` | no | ISO-3166 alpha-2 (default `us`) |
| `quotePaymentMethod` | no | Onramper method id; omit for Auto |
| `quoteProvider` | no | Onramper ramp id; omit for Auto |
| `quoteSlippageBps` | no | Max settlement drift at pay time (default `100` = 1%) |

### Fiat (`paymentMode: "fiat"`)

| Field | Required | Notes |
|-------|----------|-------|
| `displayFiat` | yes | Customer pays in this currency |
| `displayAmount` | yes* | Customer fiat amount (`direction=pay` quote) |
| `price` | derived | Settlement crypto from quote (server fills if omitted) |
| `quoteCountry` | no | Default `us` |
| `quotePaymentMethod` / `quoteProvider` | no | Auto if omitted |
| `quoteSlippageBps` | no | Default `100` |
| `allowPartial` | n/a | Not meaningful for fiat-only |

\*Or provide `price` and let the server quote `direction=receive`.

Fiat invoices lock to Onramper-supported settlement rails (mainnet: Ethereum/Base/Tron; testnet: Sepolia/Nile).

## Fiat field cascade (create UI + agents)

When building a quote for fiat / combined invoices, treat fields as a dependency graph. `pairs` = selected `chainId:token` set.

| Changed field | Effect |
|---------------|--------|
| currency (`displayFiat`) | Refetch payment methods, then providers. Reset method/provider to remembered-if-still-offered, else Auto. |
| country | Same as currency. |
| networks / tokens (`pairs`) | Same as currency. |
| payment method | Refetch providers only. |
| provider | **No refetch** — pick the matching row from the last `quotes[]` and update settlement preview. |
| amount | Refetch providers (debounce ~400ms). Keep provider preference if still quoted. |
| max drift (`quoteSlippageBps`) | Invalidates nothing. Stored on the invoice; enforced at pay time (`POST /api/invoices/:id/onramp-session`). |

**Auto** means omit the field and take the API's `recommended` value. A remembered preference overrides Auto only when it still appears in the freshly fetched option list.

See also [Quote API](quote.md).

## Request / response examples

### Crypto

```http
POST /api/invoices
Content-Type: application/json
Idempotency-Key: order-crypto-1
```

```json
{
  "price": "49.00",
  "to": ["0xMerchantEvm...", "TMerchantTron..."],
  "chains": ["11155111", "nile"],
  "tokens": ["USDC", "USDT"],
  "clientInvoiceId": "order-crypto-1",
  "chainId": "11155111",
  "token": "USDC",
  "selectedTo": "0xMerchantEvm...",
  "title": "Pro template pack",
  "callback": "https://shop.example/webhooks/trustless-commerce",
  "allowPartial": false,
  "paymentMode": "crypto"
}
```

```json
{
  "invoice": {
    "id": "inv_…",
    "clientInvoiceId": "order-crypto-1",
    "priceUsd": "49.00",
    "paymentMode": "crypto",
    "status": "awaiting_payment",
    "invoiceAddress": "0x…"
  },
  "created": true,
  "payLink": "/pay?id=inv_…",
  "checkoutLink": "/pay?price=49.00&to=0xMerchantEvm…"
}
```

### Combined (crypto or fiat)

```json
{
  "price": "49.00",
  "to": ["0xMerchantEvm..."],
  "chains": ["8453"],
  "tokens": ["USDC"],
  "clientInvoiceId": "order-both-1",
  "chainId": "8453",
  "token": "USDC",
  "selectedTo": "0xMerchantEvm...",
  "paymentMode": "crypto_or_fiat",
  "displayFiat": "EUR",
  "quoteCountry": "de",
  "quotePaymentMethod": "creditcard",
  "quoteSlippageBps": 100
}
```

The payer chooses crypto or card on `/pay`. Card checkout uses `POST /api/invoices/:id/onramp-session`.

### Fiat only

```json
{
  "to": ["0xMerchantEvm...", "TMerchantTron..."],
  "chains": ["1", "8453", "tron"],
  "tokens": ["USDC", "USDT"],
  "clientInvoiceId": "order-fiat-1",
  "paymentMode": "fiat",
  "displayFiat": "SEK",
  "displayAmount": "500.00",
  "quoteCountry": "se",
  "quotePaymentMethod": "swish",
  "quoteProvider": "revolut",
  "quoteSlippageBps": 100
}
```

The server quotes Onramper (`direction=pay`), sets `price` to the settlement crypto amount, and returns `awaiting_payment`. If settlement USDC drifts beyond `quoteSlippageBps` at pay time, the session returns **410** `quote_expired`.
