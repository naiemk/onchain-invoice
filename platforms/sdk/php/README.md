# trustless-commerce/platform-sdk (PHP)

PHP client for WooCommerce and WordPress integrations.

## Install

```bash
cd platforms/sdk/php
composer install
```

In WordPress, vendor the `src/` directory or add as a Composer dependency.

## Usage

```php
<?php
use TrustlessCommerce\Platform\TrustlessCommerceClient;

$client = new TrustlessCommerceClient('https://pay.example.com');

$result = $client->createInvoice([
    'price' => '49.00',
    'to' => ['0xMerchantWallet...'],
    'chains' => ['11155111'],
    'tokens' => ['USDC'],
    'chainId' => '11155111',
    'token' => 'USDC',
    'selectedTo' => '0xMerchantWallet...',
    'clientInvoiceId' => 'order-1042',
    'title' => 'Order #1042',
    'callback' => home_url('/wc-api/trustless_commerce'),
], 'order-1042');

$checkoutUrl = $client->checkoutUrl($result);
wp_redirect($checkoutUrl);
exit;

// Webhook
$payload = $client->parseCallbackPayload(json_decode(file_get_contents('php://input'), true));
if (TrustlessCommerceClient::isPaidLikeStatus($payload['invoice']['status'])) {
    // wc_get_order(...)->payment_complete();
}
```

Contract: [docs/platform-integration.md](../../../docs/platform-integration.md).
