<?php

declare(strict_types=1);

/**
 * Thin wrapper around the platform SDK (vendored for WordPress).
 */
final class Trustless_Commerce_Api
{
    private TrustlessCommerce\Platform\TrustlessCommerceClient $client;

    public function __construct(string $baseUrl)
    {
        require_once dirname(__DIR__, 3) . '/sdk/php/src/TrustlessCommerceException.php';
        require_once dirname(__DIR__, 3) . '/sdk/php/src/TrustlessCommerceClient.php';
        $this->client = new TrustlessCommerce\Platform\TrustlessCommerceClient($baseUrl);
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function createInvoice(array $input, ?string $idempotencyKey = null): array
    {
        return $this->client->createInvoice($input, $idempotencyKey);
    }

    /**
     * @return array<string, mixed>
     */
    public function getInvoice(string $invoiceId): array
    {
        return $this->client->getInvoice($invoiceId);
    }

    public function checkoutUrl(array $createResponse): string
    {
        return $this->client->checkoutUrl($createResponse);
    }

    /**
     * @param mixed $raw
     * @return array<string, mixed>
     */
    public function parseCallbackPayload(mixed $raw): array
    {
        return $this->client->parseCallbackPayload($raw);
    }

    public static function isPaidLikeStatus(string $status): bool
    {
        return TrustlessCommerce\Platform\TrustlessCommerceClient::isPaidLikeStatus($status);
    }
}
