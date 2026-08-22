# @trustless-commerce/platform-sdk

Lightweight Node/TypeScript client for Trustless Commerce platform integrations (Shopify apps, custom backends).

## Install

From this monorepo:

```bash
cd platforms/sdk/node
npm install
npm run build
```

Or copy the package into your app and depend on it locally.

## Usage

```typescript
import { TrustlessCommerceClient, isPaidLikeStatus } from "@trustless-commerce/platform-sdk";

const client = new TrustlessCommerceClient({
  baseUrl: "https://pay.example.com",
});

// Create invoice at checkout
const result = await client.createInvoice(
  {
    price: "49.00",
    to: ["0xMerchantWallet..."],
    chains: ["11155111"],
    tokens: ["USDC"],
    chainId: "11155111",
    token: "USDC",
    selectedTo: "0xMerchantWallet...",
    clientInvoiceId: "order-1042",
    title: "Order #1042",
    callback: "https://shop.example/webhooks/trustless-commerce",
  },
  "order-1042" // Idempotency-Key
);

// Redirect buyer
const checkoutUrl = client.checkoutUrl(result);
// res.redirect(checkoutUrl);

// Webhook handler
app.post("/webhooks/trustless-commerce", (req, res) => {
  const payload = client.parseCallbackPayload(req.body);
  if (isPaidLikeStatus(payload.invoice.status)) {
    // markOrderPaid(payload.invoice.clientInvoiceId);
  }
  res.sendStatus(200);
});

// Poll fallback
const invoice = await client.getInvoice(result.invoice.id);
```

## API

| Method | Description |
|--------|-------------|
| `createInvoice(input, idempotencyKey?)` | `POST /api/invoices` |
| `getInvoice(id)` | `GET /api/invoices/:id` |
| `checkoutUrl(response)` | Absolute URL for `payLink` |
| `parseCallbackPayload(raw)` | Validate webhook body |

Helpers: `isPaidLikeStatus`, `absoluteUrl`, `TrustlessCommerceError`.

Contract: [docs/platform-integration.md](../../../docs/platform-integration.md).
