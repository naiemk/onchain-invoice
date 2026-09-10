# Invoice types

Trustless Commerce invoices use `paymentMode` (not a separate `invoiceType` field):

| Mode | UI label | Meaning |
|------|----------|---------|
| `crypto` | Crypto | On-chain payment only (default) |
| `crypto_or_fiat` | Combined | Payer may pay with crypto **or** card/bank |
| `fiat` | Fiat | Card/bank only; settlement still lands on-chain as USDC |

Fiat modes require MetaMask pay-in enabled (`METAMASK_ONRAMP_ENABLED`, default on). They **lock to Base (`8453`) USDC**. Crypto-only invoices stay multi-chain.

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

Same as crypto, but the API forces `chains: ["8453"]` and `tokens: ["USDC"]`. Optional display hints for card checkout:

| Field | Required | Notes |
|-------|----------|-------|
| `displayFiat` | no | Preferred customer currency (e.g. `EUR`) |
| `displayAmount` | no | Hint only; settlement is `price` |
| `quoteCountry` | no | ISO-3166 alpha-2 / MetaMask region hint |

### Fiat (`paymentMode: "fiat"`)

| Field | Required | Notes |
|-------|----------|-------|
| `price` | yes | Settlement USDC on Base (merchant-set; not quoted at create) |
| `to` | yes | EVM merchant address |
| `displayFiat` | no | Customer currency hint |
| `displayAmount` | no | Customer fiat hint |
| `quoteCountry` | no | Region hint for `/buy` |
| `allowPartial` | n/a | Not meaningful for fiat-only |

Fiat invoices always settle as USDC on Base.

## Card checkout (pay time)

The payer funds `invoiceAddress` via `/buy` or the card panel on `/pay`, using `GET /api/public/pay-in/*`. See [Pay-in API](quote.md). Invoice polling covers success; do not call a session endpoint.

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
  "quoteCountry": "de"
}
```

The payer chooses crypto or card on `/pay`. Card funding uses `/buy?address={invoiceAddress}` and `GET /api/public/pay-in/widget`.

### Fiat only

```json
{
  "price": "49.00",
  "to": ["0xMerchantEvm..."],
  "chains": ["8453"],
  "tokens": ["USDC"],
  "clientInvoiceId": "order-fiat-1",
  "chainId": "8453",
  "token": "USDC",
  "selectedTo": "0xMerchantEvm...",
  "paymentMode": "fiat",
  "displayFiat": "SEK",
  "displayAmount": "500.00",
  "quoteCountry": "se"
}
```

`price` is required (USDC on Base). Optional display fields are payer hints, not a locked quote.
