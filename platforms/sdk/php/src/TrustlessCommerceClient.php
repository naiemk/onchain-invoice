<?php

declare(strict_types=1);

namespace TrustlessCommerce\Platform;

/**
 * Lightweight HTTP client for Trustless Commerce platform integrations.
 *
 * @see ../../../docs/platform-integration.md
 */
final class TrustlessCommerceClient
{
    public function __construct(
        private readonly string $baseUrl,
        private readonly ?callable $httpHandler = null,
    ) {
        $this->baseUrl = rtrim($baseUrl, '/');
    }

    /**
     * @param array<string, mixed> $input
     * @return array<string, mixed>
     */
    public function createInvoice(array $input, ?string $idempotencyKey = null): array
    {
        $body = $input;
        if (!isset($body['chainId']) && !empty($input['chains'][0])) {
            $body['chainId'] = $input['chains'][0];
        }
        if (!isset($body['token']) && !empty($input['tokens'][0])) {
            $body['token'] = $input['tokens'][0];
        }
        if (!isset($body['selectedTo']) && !empty($input['to'][0])) {
            $body['selectedTo'] = $input['to'][0];
        }

        $headers = ['Content-Type: application/json', 'Accept: application/json'];
        if ($idempotencyKey !== null && $idempotencyKey !== '') {
            $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
        }

        return $this->request('POST', '/api/invoices', $body, $headers);
    }

    /**
     * @return array<string, mixed>
     */
    public function getInvoice(string $invoiceId): array
    {
        return $this->request('GET', '/api/invoices/' . rawurlencode($invoiceId));
    }

    public function checkoutUrl(array $createResponse): string
    {
        $payLink = $createResponse['payLink'] ?? '';
        if ($payLink === '') {
            throw new TrustlessCommerceException('Missing payLink in create response');
        }
        return self::absoluteUrl($this->baseUrl, $payLink);
    }

    /**
     * @param mixed $raw
     * @return array<string, mixed>
     */
    public function parseCallbackPayload(mixed $raw): array
    {
        if (!is_array($raw)) {
            throw new TrustlessCommerceException('Invalid callback payload');
        }
        if (($raw['type'] ?? '') !== 'invoice.updated' || !isset($raw['invoice']) || !is_array($raw['invoice'])) {
            throw new TrustlessCommerceException("Expected { type: 'invoice.updated', invoice: {...} }");
        }
        return $raw;
    }

    public static function isPaidLikeStatus(string $status): bool
    {
        return in_array($status, ['paid', 'paid_partial', 'swept'], true);
    }

    public static function absoluteUrl(string $baseUrl, string $path): string
    {
        if (preg_match('#^https?://#i', $path)) {
            return $path;
        }
        $base = rtrim($baseUrl, '/');
        $rel = str_starts_with($path, '/') ? $path : '/' . $path;
        return $base . $rel;
    }

    /**
     * @param array<string, mixed>|null $body
     * @param list<string> $extraHeaders
     * @return array<string, mixed>
     */
    private function request(string $method, string $path, ?array $body = null, array $extraHeaders = []): array
    {
        $url = self::absoluteUrl($this->baseUrl, $path);
        $payload = $body !== null ? json_encode($body, JSON_THROW_ON_ERROR) : null;

        if ($this->httpHandler !== null) {
            $response = ($this->httpHandler)($method, $url, $payload, $extraHeaders);
        } else {
            $response = self::defaultHttp($method, $url, $payload, $extraHeaders);
        }

        $status = (int) ($response['status'] ?? 0);
        $parsed = $response['body'] ?? [];

        if ($status < 200 || $status >= 300) {
            $message = is_array($parsed) && isset($parsed['error'])
                ? (string) $parsed['error']
                : 'HTTP ' . $status;
            throw new TrustlessCommerceException($message, $status, $parsed);
        }

        return is_array($parsed) ? $parsed : [];
    }

    /**
     * @param list<string> $headers
     * @return array{status: int, body: mixed}
     */
    private static function defaultHttp(string $method, string $url, ?string $payload, array $headers): array
    {
        $opts = [
            'http' => [
                'method' => $method,
                'header' => implode("\r\n", $headers),
                'ignore_errors' => true,
                'timeout' => 30,
            ],
        ];
        if ($payload !== null) {
            $opts['http']['content'] = $payload;
        }

        $context = stream_context_create($opts);
        $raw = @file_get_contents($url, false, $context);
        $status = 0;
        if (isset($http_response_header[0]) && preg_match('#HTTP/\S+\s+(\d+)#', $http_response_header[0], $m)) {
            $status = (int) $m[1];
        }

        $body = [];
        if ($raw !== false && $raw !== '') {
            $decoded = json_decode($raw, true);
            $body = is_array($decoded) ? $decoded : ['raw' => $raw];
        }

        return ['status' => $status, 'body' => $body];
    }
}
