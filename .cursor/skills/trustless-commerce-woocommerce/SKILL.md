---
name: trustless-commerce-woocommerce
description: >-
  Integrate Trustless Commerce crypto payments into WooCommerce. Use when installing
  or configuring the WooCommerce payment gateway, wc-api/trustless_commerce webhooks,
  Pay with crypto checkout, WordPress plugin, or syncing WooCommerce orders on paid invoice.
---

# Trustless Commerce — WooCommerce integration

## When to use

- Install or configure the WooCommerce payment gateway plugin
- Enable **Pay with crypto** at checkout
- Debug order status sync after on-chain payment
- Customize the plugin or PHP SDK integration

## Merchant setup (no code)

1. Copy `platforms/woocommerce/trustless-commerce-for-woocommerce/` to `wp-content/plugins/`
2. Activate **Trustless Commerce for WooCommerce**
3. WooCommerce → Settings → Payments → **Trustless Commerce (Crypto)**
4. Set **API URL** (hosted Trustless Commerce base URL), **EVM wallet**, optional **Tron wallet**
5. Enable the gateway

Orders auto-update when the invoice reaches `paid` / `swept`.

## Checkout flow

```
Customer checks out → plugin POST /api/invoices (Idempotency-Key: wc-order-{id})
                   → redirect to hosted /pay
                   → buyer pays on-chain
                   → callback POST {shop}/wc-api/trustless_commerce
                   → WooCommerce order payment_complete
```

## API call (what the plugin does)

```http
POST {TRUSTLESS_BASE_URL}/api/invoices
Content-Type: application/json
Idempotency-Key: wc-order-1042

{
  "price": "49.00",
  "to": ["0xMerchant..."],
  "chains": ["11155111"],
  "tokens": ["USDC"],
  "chainId": "11155111",
  "token": "USDC",
  "selectedTo": "0xMerchant...",
  "clientInvoiceId": "1042",
  "title": "Order #1042",
  "callback": "https://shop.example/wc-api/trustless_commerce",
  "allowPartial": false
}
```

Redirect buyer to `{baseUrl}{payLink}` from the response.

## Webhook

Callback URL is registered automatically: `https://your-shop.example/wc-api/trustless_commerce`

Payload: `{ "type": "invoice.updated", "invoice": { ... } }`

Match `invoice.clientInvoiceId` to WooCommerce order id. Mark paid on `paid`, `paid_partial`, or `swept`.

## Code locations

- Plugin: `platforms/woocommerce/trustless-commerce-for-woocommerce/`
- PHP SDK: `platforms/sdk/php/`
- Contract: `docs/platform-integration.md`

## Requirements

WordPress 6.0+, WooCommerce 8.0+, PHP 8.1+, hosted Trustless Commerce API.
