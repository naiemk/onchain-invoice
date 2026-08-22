<?php

declare(strict_types=1);

namespace TrustlessCommerce\Platform;

final class TrustlessCommerceException extends \RuntimeException
{
    /** @param mixed $body */
    public function __construct(
        string $message,
        private readonly int $statusCode = 0,
        private readonly mixed $body = null,
    ) {
        parent::__construct($message, $statusCode);
    }

    public function getStatusCode(): int
    {
        return $this->statusCode;
    }

    public function getBody(): mixed
    {
        return $this->body;
    }
}
