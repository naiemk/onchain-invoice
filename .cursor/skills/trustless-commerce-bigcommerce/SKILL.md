---
name: trustless-commerce-bigcommerce
description: >-
  Plan Trustless Commerce crypto integration for BigCommerce. Use when designing
  a BigCommerce app, checkout SDK integration, or webhook-backed order sync with
  POST /api/invoices and hosted /pay checkout.
---

# Trustless Commerce — BigCommerce integration (roadmap)

## Status

**Coming soon** — use the shared integration contract and Node SDK to prototype.

## Target model

```
BigCommerce checkout → App creates invoice → redirect to hosted /pay
                    → callback → update order payment status via BigCommerce API
```

## Integration contract

Same as all platforms:

1. `POST /api/invoices` with `clientInvoiceId` = BigCommerce order id
2. Redirect buyer to `{baseUrl}{payLink}`
3. Poll `GET /api/invoices/:id` or handle `callback` webhook
4. Mark order paid on `paid` / `swept`

## Example create

```http
POST /api/invoices
Idempotency-Key: bigcommerce-1042

{
  "price": "89.00",
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

## Node SDK

```typescript
import { TrustlessCommerceClient } from "@trustless-commerce/platform-sdk";
const client = new TrustlessCommerceClient({ baseUrl: "https://pay.example.com" });
```

## Docs

- `docs/platform-integration.md`
- `platforms/sdk/node/`
