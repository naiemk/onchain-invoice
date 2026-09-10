---
name: trustless-commerce-invoice
description: >-
  Create Trustless Commerce crypto invoices and check payment status. Use when building
  or verifying USDC/USDT pay links, invoiceAddress, awaiting_payment,
  POST /api/invoices create invoice API, GET /api/invoices/:id polling, sweep status,
  Trustless Commerce checkout, Sepolia, Nile, fiat/crypto/combined paymentMode,
  GET /api/public/pay-in/quotes, /buy card funding, or crypto invoice integration for shops and agents.
---

# Trustless Commerce — create & check invoices

## When to use

- Create a payment link or embed button for a shop order
- Call the one-shot create invoice API (`crypto`, `crypto_or_fiat`, or `fiat`)
- Fund a Base USDC invoice with card/bank via `/buy` and `GET /api/public/pay-in/*`
- Check whether an invoice is `created`, `awaiting_payment`, `paid`, `paid_partial`, or `swept`

No merchant wallet connection is required for create or status check.

## Rate limits (read first)

| Bucket | Default | Routes |
|--------|---------|--------|
| `create` | ~1/s/IP | `POST /api/invoices` |
| `quote` | ~2/s, burst 20/IP | `/api/public/pay-in/` |
| `public` | ~20/s/IP | other public GETs |

**429** responses include `Retry-After`, `RateLimit-Remaining`, and `RateLimit-Reset`. Back off and retry — do not hammer create or quote.

## Canonical agent path (one step)

### Crypto — Sepolia USDC

```http
POST /api/invoices
Content-Type: application/json

{
  "price": "10.00",
  "to": ["0x…"],
  "chains": ["11155111"],
  "tokens": ["USDC"],
  "clientInvoiceId": "order-1",
  "chainId": "11155111",
  "token": "USDC",
  "selectedTo": "0x…",
  "title": "Order",
  "allowPartial": false,
  "paymentMode": "crypto"
}
```

### Crypto — Nile USDT

```http
POST /api/invoices
Content-Type: application/json

{
  "price": "10.00",
  "to": ["T…"],
  "chains": ["nile"],
  "tokens": ["USDT"],
  "clientInvoiceId": "order-1",
  "chainId": "nile",
  "token": "USDT",
  "selectedTo": "T…",
  "title": "Order",
  "allowPartial": false,
  "paymentMode": "crypto"
}
```

Multi-chain links may include both an EVM `0x…` and Tron `T…` in `to`, with `chains: ["11155111","nile"]` and `tokens: ["USDC","USDT"]`. Pick `chainId` / `token` / `selectedTo` consistent with one kind when creating.

**Do not** send `invoiceSeed` / `invoice_seed` — the API assigns a random seed and derives `invoice.id`. Client-supplied seeds are rejected (`400`).

Response includes `invoice` (with `invoiceAddress`, status `awaiting_payment`), resume `payLink` (`/pay?id=…`), and `checkoutLink` (shareable template without seed).

Duplicate invoice ids are rejected with `409`. Use `Idempotency-Key` for safe retries of the same create.

**Do not** use deprecated `POST /api/sessions` + `POST /api/invoices/activate`.

### Crypto — Solana Devnet

```http
POST /api/invoices
Content-Type: application/json

{
  "price": "10.00",
  "to": ["So111…"],
  "chains": ["devnet"],
  "tokens": ["USDC", "USDT"],
  "clientInvoiceId": "order-1",
  "chainId": "devnet",
  "token": "USDC",
  "selectedTo": "So111…",
  "title": "Order",
  "allowPartial": false,
  "paymentMode": "crypto"
}
```

### Combined (`crypto_or_fiat`)

```http
POST /api/invoices
Content-Type: application/json

{
  "price": "49.00",
  "to": ["0x…"],
  "chains": ["8453"],
  "tokens": ["USDC"],
  "clientInvoiceId": "order-both-1",
  "chainId": "8453",
  "token": "USDC",
  "selectedTo": "0x…",
  "paymentMode": "crypto_or_fiat",
  "displayFiat": "EUR",
  "quoteCountry": "de"
}
```

Payer chooses crypto or card on `/pay`. Card funding: `/buy?address={invoiceAddress}&amount=…&fiat=EUR&country=de&invoice={id}` (or the card panel on `/pay`). Quotes: `GET /api/public/pay-in/quotes`. Checkout URL: `GET /api/public/pay-in/widget`. Poll the invoice; do not create an onramp session.

### Fiat only

Fiat invoices **require `price`** (USDC on Base). The API locks `chains`/`tokens` to `8453` / `USDC`. Optional `displayFiat` / `displayAmount` / `quoteCountry` are payer hints.

```http
POST /api/invoices
Content-Type: application/json

{
  "price": "49.00",
  "to": ["0x…"],
  "chains": ["8453"],
  "tokens": ["USDC"],
  "clientInvoiceId": "order-fiat-1",
  "chainId": "8453",
  "token": "USDC",
  "selectedTo": "0x…",
  "paymentMode": "fiat",
  "displayFiat": "SEK",
  "displayAmount": "500.00",
  "quoteCountry": "se"
}
```

Full docs: https://naiemk.github.io/onchain-invoice/invoice-types/ and https://naiemk.github.io/onchain-invoice/quote/

## Pay link (browser)

```text
/pay?price=10&to=0x…&chains=11155111&tokens=USDC&title=Order&allow_partial=0
/pay?price=10&to=T…&chains=nile&tokens=USDT&title=Order&allow_partial=0
```

Optional chrome: `header=full` (default) | `minimal` | `none`. Use `none` inside an iframe (or omit `header` — embedded `/pay` defaults to no chrome). Gateways allow cross-origin framing of `/pay` only:

```html
<iframe src="https://your.host/pay?price=10&to=0x…&chains=11155111&tokens=USDC&header=none"
  style="width:100%;min-height:720px;border:0" allow="payment *"></iframe>
```

Shareable checkout links never include `invoice_seed`. The API creates the seed when the payer continues (or when you call `POST /api/invoices`). After create, resume with `/pay?id=<invoiceId>` (preserve `header` if present).

Deterministic `invoiceId` = `keccak256(abi.encode(bytes32 invoiceSeed, string[] toAddresses))`.
Uniqueness comes from a server-generated random `invoiceSeed`; `toAddresses` bind payout destinations.
`clientInvoiceId`, price, title, etc. are metadata only (not part of the hash).
`chains` / `tokens` are not part of the hash.

Helpers: `ui/src/shared/invoice.ts`. Manual UI: `/create` (3-step wizard). Docs: https://naiemk.github.io/onchain-invoice/

## Check status

```http
GET /api/invoices/{invoiceId}
```

Poll every few seconds until `paid`, `paid_partial`, or `swept`.
