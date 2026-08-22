# Trustless Commerce — platform integrations

Thin adapters that wrap the hosted checkout + invoice API for ecommerce and creator platforms.

## Architecture

```
Merchant platform (WooCommerce, Shopify, Kajabi, …)
        │
        ▼
  Platform SDK (PHP / Node)  ──►  POST /api/invoices
        │                              │
        │                              ▼
        └── redirect buyer ──────►  Hosted /pay checkout
                                       │
                                       ▼
                                 On-chain payment + sweep
                                       │
        ◄── callback / poll ─────  GET /api/invoices/:id
        │
        ▼
  Update order / grant access
```

## Directory layout

| Path | Description |
|------|-------------|
| [`sdk/node/`](sdk/node/) | TypeScript SDK for Shopify apps and Node backends |
| [`sdk/php/`](sdk/php/) | PHP SDK for WooCommerce and WordPress |
| [`woocommerce/`](woocommerce/) | WooCommerce payment gateway plugin |
| [`shopify/`](shopify/) | Shopify offsite checkout app |
| [`creator/`](creator/) | Kajabi & Teachable external-checkout connectors |

## Contract

Stable API semantics: [docs/platform-integration.md](../docs/platform-integration.md).

## Quick start (any platform)

```http
POST https://your-trustless-host/api/invoices
Content-Type: application/json
Idempotency-Key: your-order-id

{
  "price": "29.00",
  "to": ["0xYourWallet"],
  "chains": ["11155111"],
  "tokens": ["USDC"],
  "chainId": "11155111",
  "token": "USDC",
  "selectedTo": "0xYourWallet",
  "clientInvoiceId": "your-order-id",
  "title": "Order #1042",
  "callback": "https://your-shop/webhooks/trustless-commerce"
}
```

Redirect the buyer to `{baseUrl}{payLink}` from the response. Mark your order paid when the callback fires or polling shows `paid` / `swept`.

## Implementation order

1. Integration contract (documented)
2. PHP + Node SDKs
3. WooCommerce plugin (first native integration)
4. Shopify app (offsite checkout)
5. Kajabi / Teachable connectors (external checkout + fulfillment)
