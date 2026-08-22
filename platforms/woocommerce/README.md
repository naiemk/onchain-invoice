# Trustless Commerce for WooCommerce

Native WooCommerce payment gateway using hosted Trustless Commerce checkout.

## Merchant promise

1. Install plugin
2. Enter API URL + payout wallet(s)
3. Enable crypto at checkout
4. Orders auto-update when paid

## Install

1. Copy `trustless-commerce-for-woocommerce/` to `wp-content/plugins/trustless-commerce-for-woocommerce/`
2. Activate **Trustless Commerce for WooCommerce** in WordPress
3. WooCommerce → Settings → Payments → **Trustless Commerce (Crypto)**

## Settings

| Setting | Example |
|---------|---------|
| API URL | `https://pay.example.com` |
| EVM wallet | `0xYourMerchant…` |
| Tron wallet | `TYourMerchant…` (optional) |
| Default chain | `11155111` (Sepolia) |
| Default token | `USDC` |

## Flow

```
Checkout → POST /api/invoices (Idempotency-Key: wc-order-{id})
        → redirect to hosted /pay
        → buyer pays on-chain
        → callback POST wc-api/trustless_commerce
        → order marked payment_complete
```

## Webhook URL

The plugin registers:

```
https://your-shop.example/wc-api/trustless_commerce
```

This is sent automatically as the invoice `callback` — no manual webhook setup required.

## Requirements

- WordPress 6.0+, WooCommerce 8.0+, PHP 8.1+
- Hosted Trustless Commerce API (see repo `commerce/` + `deploy/`)

Contract: [docs/platform-integration.md](../../docs/platform-integration.md)
