<?php

declare(strict_types=1);

/**
 * Handles Trustless Commerce payment callbacks at wc-api/trustless_commerce.
 */
final class Trustless_Commerce_Webhook
{
    public static function register(): void
    {
        add_action('woocommerce_api_trustless_commerce', [self::class, 'handle']);
    }

    public static function handle(): void
    {
        $raw = file_get_contents('php://input');
        $payload = json_decode($raw ?: '{}', true);

        $gateways = WC()->payment_gateways()->payment_gateways();
        $gateway = $gateways['trustless_commerce'] ?? null;
        if (!$gateway instanceof WC_Gateway_Trustless_Commerce) {
            status_header(503);
            exit;
        }

        $baseUrl = trim((string) $gateway->get_option('api_base_url'));
        if ($baseUrl === '') {
            status_header(503);
            exit;
        }

        try {
            $api = new Trustless_Commerce_Api($baseUrl);
            $event = $api->parseCallbackPayload($payload);
            $invoice = $event['invoice'];
            $status = (string) ($invoice['status'] ?? '');

            if (!Trustless_Commerce_Api::isPaidLikeStatus($status)) {
                wp_send_json(['ok' => true, 'ignored' => true], 200);
            }

            $orderId = (int) ($invoice['clientInvoiceId'] ?? 0);
            if ($orderId <= 0) {
                $stored = self::findOrderByInvoiceId((string) ($invoice['id'] ?? ''));
                $orderId = $stored ? $stored->get_id() : 0;
            }

            $order = wc_get_order($orderId);
            if (!$order instanceof WC_Order) {
                status_header(404);
                exit;
            }

            if ($order->is_paid()) {
                wp_send_json(['ok' => true, 'already_paid' => true], 200);
            }

            $order->payment_complete((string) ($invoice['id'] ?? ''));
            $order->add_order_note(
                sprintf(
                    /* translators: 1: invoice status, 2: amount paid */
                    __('Trustless Commerce payment confirmed (%1$s). Amount paid: %2$s', 'trustless-commerce'),
                    $status,
                    (string) ($invoice['amountPaid'] ?? '')
                )
            );
            $order->save();

            wp_send_json(['ok' => true], 200);
        } catch (Throwable $e) {
            status_header(400);
            echo wp_json_encode(['error' => $e->getMessage()]);
            exit;
        }
    }

    private static function findOrderByInvoiceId(string $invoiceId): ?WC_Order
    {
        if ($invoiceId === '') {
            return null;
        }
        $orders = wc_get_orders([
            'limit' => 1,
            'meta_key' => '_trustless_invoice_id',
            'meta_value' => $invoiceId,
            'return' => 'objects',
        ]);
        return $orders[0] ?? null;
    }
}
