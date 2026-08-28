# Platform integration contract

Stable contract for ecommerce platforms, creator tools, and custom storefronts integrating Trustless Commerce.

**Base primitive:** one `POST /api/invoices` call plus hosted `/pay` checkout. Platform adapters are thin wrappers around this contract.

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/api/invoices` | None (rate limited) | Create invoice + payment address |
| GET | `/api/invoices/:id` | None (rate limited) | Poll status + events |
| GET | `/api/invoices?to=…` | Optional wallet headers | Merchant invoice list |

See also [Create invoice](create.md) and [HTTP API](api.md).

## Create invoice

```http
POST /api/invoices
Content-Type: application/json
Idempotency-Key: order-1042
```

```json
{
  "price": "49.00",
  "to": ["0xMerchant...", "TMerchant..."],
  "chains": ["11155111", "3448148188"],
  "tokens": ["USDC", "USDT"],
  "clientInvoiceId": "order-1042",
  "chainId": "11155111",
  "token": "USDC",
  "selectedTo": "0xMerchant...",
  "title": "Pro template pack",
  "description": "Optional line-item summary",
  "callback": "https://shop.example/webhooks/trustless-commerce",
  "allowPartial": false
}
```

### Request fields (stable)

| Field | Required | Notes |
|-------|----------|-------|
| `price` | yes | USD decimal string, e.g. `"49.00"` |
| `to` | yes | Merchant payout address(es); EVM `0x…`, Tron `T…`, or Solana base58 |
| `chains` | yes | Allowed chain IDs (comma-separated in pay links) |
| `tokens` | yes | Allowed token symbols, e.g. `USDC`, `USDT` |
| `chainId` | yes* | Selected chain for this checkout (*defaults to first `chains` entry) |
| `token` | yes* | Selected token (*defaults to first `tokens` entry) |
| `selectedTo` | yes* | Payout address for selected chain (*defaults to first matching `to`) |
| `clientInvoiceId` | recommended | Your order / cart id — stored and returned on invoice |
| `callback` | recommended | HTTPS URL for payment webhooks |
| `title` | optional | Shown on hosted checkout |
| `description` | optional | Shown on hosted checkout |
| `allowPartial` | optional | Default `false`; when `true`, underpayment may reach `paid_partial` |

**Do not send** `invoiceSeed` — it is server-assigned.

### Idempotency

Send `Idempotency-Key` (your stable order id). Retries with the same key return **200** with the original invoice (`created: false`). Without a key, duplicate creates for the same deterministic invoice id return **409**.

### Response (stable)

HTTP **201** when newly created, **200** when idempotent replay.

```json
{
  "invoice": {
    "id": "inv_…",
    "clientInvoiceId": "order-1042",
    "priceUsd": "49.00",
    "toAddresses": ["0xMerchant..."],
    "selectedTo": "0xMerchant...",
    "chainId": "11155111",
    "token": "USDC",
    "invoiceAddress": "0xPayTo…",
    "callbackUrl": "https://shop.example/webhooks/trustless-commerce",
    "allowPartial": false,
    "status": "awaiting_payment",
    "amountPaid": "0",
    "amountSwept": "0",
    "createdAt": "2026-08-19T12:00:00.000Z",
    "updatedAt": "2026-08-19T12:00:00.000Z"
  },
  "created": true,
  "payLink": "/pay?id=inv_…",
  "checkoutLink": "/pay?price=49.00&to=0xMerchant…"
}
```

| Field | Use in integrations |
|-------|---------------------|
| `invoice.id` | Store on your order; poll `GET /api/invoices/:id` |
| `invoice.invoiceAddress` | Display / QR on custom checkout (hosted `/pay` preferred) |
| `payLink` | **Redirect buyer here** after create — resumes this invoice |
| `checkoutLink` | Pre-invoice pay-link template (buyer picks chain on `/pay`) |

Prefix relative paths with your Trustless Commerce base URL (e.g. `https://pay.example.com`).

## Hosted checkout

Treat **`/pay`** as the canonical buyer experience.

1. Platform creates invoice via API.
2. Redirect buyer to `{baseUrl}{payLink}` (or render a button to that URL).
3. Buyer completes payment on hosted checkout; sweeper settles on-chain.

Optional UI chrome on `/pay` links: `header=full` (default top-level), `minimal`, or `none` (iframe). Embedded `/pay` defaults to no chrome and may be iframed cross-origin. See [Create an invoice](create.md#checkout-chrome-header).

Platform adapters should **not** reimplement wallet UI unless required by the host platform.

## Status polling

```http
GET /api/invoices/:id
```

Response includes `invoice` fields plus `events[]` (audit trail).

### Invoice status lifecycle

| Status | Meaning | Platform action |
|--------|---------|-----------------|
| `awaiting_payment` | Invoice active, no payment yet | Keep order pending |
| `paid` | Full payment detected on-chain | Mark order paid / fulfill |
| `paid_partial` | Partial payment (`allowPartial: true`) | Partial fulfillment or hold |
| `swept` | Funds swept to merchant | Optional: mark settled (already paid) |

**Recommended:** mark platform orders **paid** on `paid`, `paid_partial` (if allowed), or `swept`.

Poll every 5–15 s while the buyer is on-site, or rely on callbacks (below).

## Callback / webhook contract

When an invoice first transitions into a paid-like status (`paid`, `paid_partial`, or `swept`), the API POSTs to `callback`:

```http
POST {callback}
Content-Type: application/json
```

```json
{
  "type": "invoice.updated",
  "invoice": { "...full invoice record..." }
}
```

### Handler requirements

1. Respond **2xx** quickly; do heavy work asynchronously.
2. Match `invoice.clientInvoiceId` or stored `invoice.id` to your order.
3. Idempotent: ignore duplicate notifications for the same status.
4. Verify `invoice.status` before fulfilling.

Callbacks are **best-effort** (no automatic retries today). Combine with polling for reliability.

### Suggested order mapping

| Trustless status | WooCommerce / Shopify / creator |
|------------------|----------------------------------|
| `awaiting_payment` | Pending payment |
| `paid` | Processing / paid |
| `paid_partial` | On hold or partial (merchant policy) |
| `swept` | Completed (optional distinction) |

## Authentication model

| Actor | Method |
|-------|--------|
| Invoice create / public read | Unauthenticated (IP rate limits) |
| Merchant list / force sweep | Wallet signature headers (`x-merchant-address`, `x-merchant-message`, `x-merchant-signature`) |
| Admin / sweeper registration | `x-api-key` |

Platform plugins store the **hosted API base URL** and merchant wallet addresses in settings. They do not need merchant wallet signing for create + callback flows.

## Client libraries

| Language | Path | Package |
|----------|------|---------|
| Node / TypeScript | [`platforms/sdk/node/`](../platforms/sdk/node/) | `@trustless-commerce/platform-sdk` |
| PHP (WooCommerce) | [`platforms/sdk/php/`](../platforms/sdk/php/) | `trustless-commerce/platform-sdk` |

## Platform adapters

| Platform | Path | Model |
|----------|------|-------|
| WooCommerce | [`platforms/woocommerce/`](../platforms/woocommerce/) | Native payment gateway + callback |
| Shopify | [`platforms/shopify/`](../platforms/shopify/) | Offsite checkout app + order sync |
| Kajabi / Teachable | [`platforms/creator/`](../platforms/creator/) | External checkout + enrollment webhook |

See [`platforms/README.md`](../platforms/README.md) for the full integration roadmap.

## AI agent skills

Each platform has a Cursor skill for fast integration:

| Platform | Skill path |
|----------|------------|
| WooCommerce | `.cursor/skills/trustless-commerce-woocommerce/SKILL.md` |
| Shopify | `.cursor/skills/trustless-commerce-shopify/SKILL.md` |
| Kajabi | `.cursor/skills/trustless-commerce-kajabi/SKILL.md` |
| Teachable | `.cursor/skills/trustless-commerce-teachable/SKILL.md` |
| BigCommerce | `.cursor/skills/trustless-commerce-bigcommerce/SKILL.md` |
| Lemon Squeezy | `.cursor/skills/trustless-commerce-lemonsqueezy/SKILL.md` |
| Gumroad | `.cursor/skills/trustless-commerce-gumroad/SKILL.md` |

Product UI: `/integrations` on the hosted site lists all platforms with docs and skill links.

## Versioning

This document describes the **v1** integration contract aligned with `POST /api/invoices`. Breaking changes will bump a documented version and preserve backward-compatible fields where possible.
