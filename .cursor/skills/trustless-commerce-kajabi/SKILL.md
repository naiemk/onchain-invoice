---
name: trustless-commerce-kajabi
description: >-
  Integrate Trustless Commerce crypto checkout with Kajabi courses and memberships.
  Use when adding Buy with crypto buttons, external checkout, or granting Kajabi
  offer access after invoice payment.
---

# Trustless Commerce — Kajabi integration

## When to use

- Add **Buy with crypto** to Kajabi sales pages
- External checkout for courses, memberships, coaching
- Auto-grant offer access after on-chain payment

## Model

Kajabi does not support custom payment gateways. Use **external checkout**:

```
Sales page button → POST /checkout on fulfillment server → hosted /pay
                 → paid callback → grant Kajabi offer / tag contact
```

## Fulfillment server

```bash
cd platforms/sdk/node && npm install && npm run build
cd platforms/creator && npm install

export TRUSTLESS_BASE_URL=https://pay.example.com
export EVM_WALLET=0xYourMerchant...
export APP_PUBLIC_URL=https://checkout.your-domain.com
export PLATFORM=kajabi

npm run kajabi
```

## Sales page button

```javascript
const res = await fetch('https://checkout.your-domain.com/checkout', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: buyerEmail,
    productId: 'course-pro',
    price: '199.00',
    title: 'Pro Course'
  })
});
window.location.href = (await res.json()).checkoutUrl;
```

## Invoice create (server-side)

```http
POST /api/invoices
Idempotency-Key: kajabi-course-pro-user@example.com-199.00

{
  "price": "199.00",
  "to": ["0xMerchant..."],
  "chains": ["8453"],
  "tokens": ["USDC"],
  "chainId": "8453",
  "token": "USDC",
  "selectedTo": "0xMerchant...",
  "clientInvoiceId": "kajabi-course-pro-user@example.com-199.00",
  "title": "Pro Course",
  "callback": "https://checkout.your-domain.com/webhooks/trustless-commerce"
}
```

## Fulfillment on callback

On `paid` / `swept`: grant Kajabi offer to `email`, tag contact `crypto-paid`.

Wire Kajabi REST API in `platforms/creator/shared/fulfillment-server.js` when `KAJABI_API_KEY` is set.

## Docs

- `platforms/creator/kajabi/README.md`
- `docs/platform-integration.md`
