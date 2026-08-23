---
name: trustless-commerce-gumroad
description: >-
  Plan Trustless Commerce crypto checkout for Gumroad indie creators. Use when
  designing external Buy with crypto buttons, hosted pay links, or fulfillment
  after invoice payment for digital products.
---

# Trustless Commerce — Gumroad integration (roadmap)

## Status

**Coming soon** — lightweight hosted checkout links suit Gumroad's indie creator audience.

## Target model

```
Gumroad product overlay / custom button → POST /api/invoices → hosted /pay
                                       → callback → deliver download / access
```

## Example create

```http
POST /api/invoices
Idempotency-Key: gumroad-product-abc

{
  "price": "15.00",
  "to": ["0xMerchant..."],
  "chains": ["8453"],
  "tokens": ["USDC"],
  "chainId": "8453",
  "token": "USDC",
  "selectedTo": "0xMerchant...",
  "clientInvoiceId": "gumroad-product-abc",
  "title": "Digital pack",
  "callback": "https://your-app.example/webhooks/trustless-commerce"
}
```

Share `checkoutLink` or redirect to `payLink` after create.

## Docs

- `docs/platform-integration.md`
- `platforms/README.md`
