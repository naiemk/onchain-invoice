# Teachable connector

External **Buy with crypto** checkout with automatic course enrollment.

## Setup

```bash
cd platforms/sdk/node && npm install && npm run build
cd ../../creator && npm install

export TRUSTLESS_BASE_URL=https://pay.example.com
export EVM_WALLET=0xYourMerchant...
export APP_PUBLIC_URL=https://checkout.your-domain.com
export PLATFORM=teachable
# export TEACHABLE_API_KEY=...  # Teachable school API key

npm run teachable
```

## Sales page integration

Use the same `/checkout` endpoint as Kajabi:

```javascript
const res = await fetch('https://checkout.your-domain.com/checkout', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    email: buyerEmail,
    productId: 'course-slug-or-id',
    price: '99.00',
    title: 'Intro Course'
  })
});
window.location.href = (await res.json()).checkoutUrl;
```

Embed on Teachable lecture pages via **Custom JavaScript** (School Settings → Code Snippets).

## Fulfillment

On `paid` / `swept` callback:

1. Match buyer email from stored checkout session
2. Enroll user in Teachable course via [Teachable API](https://docs.teachable.com/)
3. Optionally fire Teachable `sale.created` webhook equivalent for analytics

Implement enrollment in [`shared/fulfillment-server.js`](../shared/fulfillment-server.js) when `TEACHABLE_API_KEY` is set.

## Idempotency

Checkout uses idempotency key `{platform}-{productId}-{email}-{price}` so refresh/retry does not double-charge.

Contract: [docs/platform-integration.md](../../../docs/platform-integration.md)
