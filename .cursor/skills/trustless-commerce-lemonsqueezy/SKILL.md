---
name: trustless-commerce-lemonsqueezy
description: >-
  Plan Trustless Commerce crypto checkout for Lemon Squeezy SaaS and digital downloads.
  Use when designing external checkout, pay links, or webhook fulfillment for
  Lemon Squeezy merchants.
---

# Trustless Commerce — Lemon Squeezy integration (roadmap)

## Status

**Coming soon** — hosted pay links and callback fulfillment fit Lemon Squeezy's SaaS/download ICP.

## Target model

```
Product page → Create invoice (POST /api/invoices) → hosted /pay
            → callback → license / download fulfillment webhook
```

## Example create

```http
POST /api/invoices
Idempotency-Key: ls-order-1042

{
  "price": "29.00",
  "to": ["0xMerchant..."],
  "chains": ["8453"],
  "tokens": ["USDC"],
  "chainId": "8453",
  "token": "USDC",
  "selectedTo": "0xMerchant...",
  "clientInvoiceId": "ls-order-1042",
  "title": "Pro license",
  "callback": "https://your-app.example/webhooks/trustless-commerce"
}
```

Redirect to `{baseUrl}{payLink}`. Fulfill on `paid` / `swept`.

## Docs

- `docs/platform-integration.md`
- `platforms/README.md`
