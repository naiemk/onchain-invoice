# Trustless Commerce for Shopify

Offsite crypto checkout app — hosted `/pay` plus Shopify order sync.

## Why offsite checkout first

Shopify payment apps require Partner review, strict PCI/compliance scope, and platform-specific checkout extensions. The fastest path to merchant value mirrors WooCommerce:

1. Buyer selects **Pay with crypto** at checkout
2. App creates a Trustless invoice and redirects to hosted `/pay`
3. Callback marks the Shopify order paid via Admin API

Native payment insertion can follow once the shared contract is battle-tested.

## Architecture

```
Shopify Checkout
      │
      ▼ (redirect)
Shopify App  ──POST /api/invoices──►  Trustless Commerce API
      │                                      │
      └── redirect buyer ─────────────►  Hosted /pay
                                               │
      ◄── POST /webhooks/trustless-commerce ───┘
      │
      ▼
orderMarkAsPaid (GraphQL Admin API)
```

## App scaffold

See [`app/`](app/) — minimal Node server:

| Route | Purpose |
|-------|---------|
| `GET /apps/trustless-commerce/checkout` | Create invoice + redirect |
| `POST /webhooks/trustless-commerce` | Payment callback |
| `GET /health` | Liveness |

## Setup

```bash
cd platforms/sdk/node && npm install && npm run build
cd ../shopify/app && npm install

export TRUSTLESS_BASE_URL=https://pay.example.com
export EVM_WALLET=0xYourMerchant...
export APP_PUBLIC_URL=https://your-app.example
export SHOPIFY_SHOP=your-store.myshopify.com
export SHOPIFY_ACCESS_TOKEN=shpat_...

npm start
```

## Checkout redirect URL

Point your Shopify checkout extension or thank-you redirect to:

```
https://your-app.example/apps/trustless-commerce/checkout?shopify_order_id={order_id}&amount={total}&title={title}
```

## Merchant admin (future)

Production app adds:

- OAuth install flow (Shopify Partners)
- Encrypted session storage per shop
- Admin UI for API URL, wallets, chains/tokens
- Optional order polling fallback

## Compliance notes

- Crypto offsite checkout avoids card PCI scope
- Disclose crypto payment terms in checkout UI
- Shopify App Store review requires privacy policy + support contact

Contract: [docs/platform-integration.md](../../docs/platform-integration.md)
