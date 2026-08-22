# Kajabi connector

External **Buy with crypto** checkout for Kajabi offers, courses, and memberships.

## Setup

1. Deploy the shared fulfillment server with `PLATFORM=kajabi`
2. Add a custom code block or landing-page button linking to your checkout API
3. Configure Kajabi API credentials for automatic offer grants (optional)

```bash
cd platforms/sdk/node && npm install && npm run build
cd ../../creator && npm install

export TRUSTLESS_BASE_URL=https://pay.example.com
export EVM_WALLET=0xYourMerchant...
export APP_PUBLIC_URL=https://checkout.your-domain.com
export PLATFORM=kajabi
# export KAJABI_API_KEY=...  # when wiring Kajabi REST API

npm run kajabi
```

## Sales page button

Add a form or fetch call on your Kajabi landing page:

```html
<button id="pay-crypto">Buy with crypto</button>
<script>
document.getElementById('pay-crypto').onclick = async () => {
  const res = await fetch('https://checkout.your-domain.com/checkout', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      email: '{{ contact.email }}',  // Kajabi liquid variable
      productId: 'course-pro',
      price: '199.00',
      title: 'Pro Course'
    })
  });
  const { checkoutUrl } = await res.json();
  window.location.href = checkoutUrl;
};
</script>
```

## Fulfillment

On paid callback, the server calls your Kajabi integration hook to:

- Grant the offer / product to the buyer email
- Tag the contact as `crypto-paid`
- Trigger Kajabi automation (welcome email, community access)

Wire `KAJABI_API_KEY` in [`shared/fulfillment-server.js`](../shared/fulfillment-server.js) to your Kajabi REST endpoints.

## Webhook URL

```
https://checkout.your-domain.com/webhooks/trustless-commerce
```

Set automatically as invoice `callback` — no Kajabi-native webhook required.

Contract: [docs/platform-integration.md](../../../docs/platform-integration.md)
