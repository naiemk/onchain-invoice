---
name: trustless-commerce-teachable
description: >-
  Integrate Trustless Commerce crypto checkout with Teachable courses. Use when adding
  Buy with crypto on lecture pages, external checkout, or enrolling students after
  invoice payment.
---

# Trustless Commerce — Teachable integration

## When to use

- Add **Buy with crypto** to Teachable course pages
- External checkout for course sellers
- Auto-enroll students after on-chain payment

## Model

```
Course page button → fulfillment server /checkout → hosted /pay
                  → paid callback → Teachable enrollment API
```

## Fulfillment server

```bash
cd platforms/sdk/node && npm install && npm run build
cd platforms/creator && npm install

export TRUSTLESS_BASE_URL=https://pay.example.com
export EVM_WALLET=0xYourMerchant...
export APP_PUBLIC_URL=https://checkout.your-domain.com
export PLATFORM=teachable
# export TEACHABLE_API_KEY=...

npm run teachable
```

## Embed on lecture page

Use Teachable **Custom JavaScript** (School Settings → Code Snippets):

```javascript
document.getElementById('pay-crypto')?.addEventListener('click', async () => {
  const res = await fetch('https://checkout.your-domain.com/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: buyerEmail,
      productId: 'intro-course',
      price: '99.00',
      title: 'Intro Course'
    })
  });
  window.location.href = (await res.json()).checkoutUrl;
});
```

## Invoice create

```http
POST /api/invoices
Idempotency-Key: teachable-intro-course-user@example.com-99.00

{
  "price": "99.00",
  "to": ["0xMerchant..."],
  "chains": ["8453"],
  "tokens": ["USDC"],
  "chainId": "8453",
  "token": "USDC",
  "selectedTo": "0xMerchant...",
  "clientInvoiceId": "teachable-intro-course-user@example.com-99.00",
  "title": "Intro Course",
  "callback": "https://checkout.your-domain.com/webhooks/trustless-commerce"
}
```

## Fulfillment

On `paid` / `swept`: enroll `email` in course via Teachable API.

## Docs

- `platforms/creator/teachable/README.md`
- `docs/platform-integration.md`
