---
name: trustless-commerce-shopify
description: >-
  Integrate Trustless Commerce crypto checkout with Shopify. Use when building or
  configuring the Shopify offsite checkout app, orderMarkAsPaid sync, checkout redirect,
  or POST /api/invoices for Shopify orders.
---

# Trustless Commerce — Shopify integration

## When to use

- Set up offsite **Pay with crypto** checkout for Shopify
- Configure the Shopify app scaffold in `platforms/shopify/`
- Sync paid status back to Shopify orders after on-chain payment

## Architecture

```
Shopify checkout → App creates invoice → redirect to hosted /pay
                → buyer pays → callback → orderMarkAsPaid (Admin API)
```

## App setup

```bash
cd platforms/sdk/node && npm install && npm run build
cd platforms/shopify/app && npm install

export TRUSTLESS_BASE_URL=https://pay.example.com
export EVM_WALLET=0xYourMerchant...
export APP_PUBLIC_URL=https://your-app.example
export SHOPIFY_SHOP=your-store.myshopify.com
export SHOPIFY_ACCESS_TOKEN=shpat_...

npm start
```

## Checkout redirect

Point checkout extension or thank-you redirect to:

```
GET {APP_PUBLIC_URL}/apps/trustless-commerce/checkout?shopify_order_id={id}&amount={total}&title={title}
```

The app calls `POST /api/invoices` with `Idempotency-Key: shopify-{order_id}` and redirects to hosted `/pay`.

## Create invoice

```http
POST /api/invoices
Idempotency-Key: shopify-1042

{
  "price": "128.00",
  "to": ["0xMerchant..."],
  "chains": ["8453"],
  "tokens": ["USDC"],
  "chainId": "8453",
  "token": "USDC",
  "selectedTo": "0xMerchant...",
  "clientInvoiceId": "1042",
  "title": "Order #1042",
  "callback": "https://your-app.example/webhooks/trustless-commerce"
}
```

## Callback → mark paid

`POST /webhooks/trustless-commerce` receives `{ type: "invoice.updated", invoice }`.

On `paid` / `swept`, call Shopify Admin GraphQL `orderMarkAsPaid` for `invoice.clientInvoiceId`.

## Code locations

- App: `platforms/shopify/app/`
- Node SDK: `platforms/sdk/node/`
- Contract: `docs/platform-integration.md`
