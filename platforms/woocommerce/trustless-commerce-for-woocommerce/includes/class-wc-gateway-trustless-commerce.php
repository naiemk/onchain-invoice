<?php

declare(strict_types=1);

/**
 * WooCommerce payment gateway — hosted checkout + callback order sync.
 */
final class WC_Gateway_Trustless_Commerce extends WC_Payment_Gateway
{
    public function __construct()
    {
        $this->id = 'trustless_commerce';
        $this->method_title = __('Trustless Commerce (Crypto)', 'trustless-commerce');
        $this->method_description = __(
            'Accept USDC/USDT via Trustless Commerce hosted checkout. Orders update automatically when payment is detected.',
            'trustless-commerce'
        );
        $this->has_fields = false;
        $this->supports = ['products'];

        $this->init_form_fields();
        $this->init_settings();

        $this->title = $this->get_option('title', __('Pay with crypto', 'trustless-commerce'));
        $this->description = $this->get_option('description', __('Pay with USDC or USDT on supported chains.', 'trustless-commerce'));
        $this->enabled = $this->get_option('enabled', 'no');

        add_action('woocommerce_update_options_payment_gateways_' . $this->id, [$this, 'process_admin_options']);
        add_action('woocommerce_thankyou_' . $this->id, [$this, 'thankyou_page']);
    }

    public function init_form_fields(): void
    {
        $this->form_fields = [
            'enabled' => [
                'title' => __('Enable/Disable', 'trustless-commerce'),
                'type' => 'checkbox',
                'label' => __('Enable Trustless Commerce', 'trustless-commerce'),
                'default' => 'no',
            ],
            'title' => [
                'title' => __('Title', 'trustless-commerce'),
                'type' => 'text',
                'default' => __('Pay with crypto', 'trustless-commerce'),
            ],
            'description' => [
                'title' => __('Description', 'trustless-commerce'),
                'type' => 'textarea',
                'default' => __('Pay with USDC or USDT on supported chains.', 'trustless-commerce'),
            ],
            'api_base_url' => [
                'title' => __('Trustless Commerce API URL', 'trustless-commerce'),
                'type' => 'text',
                'description' => __('Base URL of your hosted Trustless Commerce deployment.', 'trustless-commerce'),
                'default' => '',
                'desc_tip' => true,
            ],
            'evm_wallet' => [
                'title' => __('EVM payout wallet', 'trustless-commerce'),
                'type' => 'text',
                'description' => __('0x… address for EVM chains (Sepolia, Base, etc.).', 'trustless-commerce'),
                'default' => '',
            ],
            'tron_wallet' => [
                'title' => __('Tron payout wallet', 'trustless-commerce'),
                'type' => 'text',
                'description' => __('T… address for TRON Nile / mainnet.', 'trustless-commerce'),
                'default' => '',
            ],
            'default_chain_id' => [
                'title' => __('Default chain ID', 'trustless-commerce'),
                'type' => 'text',
                'default' => '11155111',
                'description' => __('11155111 = Sepolia, 3448148188 = TRON Nile.', 'trustless-commerce'),
            ],
            'default_token' => [
                'title' => __('Default token', 'trustless-commerce'),
                'type' => 'text',
                'default' => 'USDC',
            ],
            'chains' => [
                'title' => __('Allowed chains (comma-separated)', 'trustless-commerce'),
                'type' => 'text',
                'default' => '11155111,3448148188',
            ],
            'tokens' => [
                'title' => __('Allowed tokens (comma-separated)', 'trustless-commerce'),
                'type' => 'text',
                'default' => 'USDC,USDT',
            ],
        ];
    }

    public function process_payment($order_id): array
    {
        $order = wc_get_order($order_id);
        if (!$order instanceof WC_Order) {
            wc_add_notice(__('Order not found.', 'trustless-commerce'), 'error');
            return ['result' => 'fail'];
        }

        $baseUrl = trim((string) $this->get_option('api_base_url'));
        if ($baseUrl === '') {
            wc_add_notice(__('Trustless Commerce is not configured.', 'trustless-commerce'), 'error');
            return ['result' => 'fail'];
        }

        $to = array_values(array_filter([
            trim((string) $this->get_option('evm_wallet')),
            trim((string) $this->get_option('tron_wallet')),
        ]));
        if ($to === []) {
            wc_add_notice(__('Configure at least one payout wallet.', 'trustless-commerce'), 'error');
            return ['result' => 'fail'];
        }

        $chainId = trim((string) $this->get_option('default_chain_id', '11155111'));
        $token = strtoupper(trim((string) $this->get_option('default_token', 'USDC')));
        $chains = $this->splitList((string) $this->get_option('chains', '11155111'));
        $tokens = array_map('strtoupper', $this->splitList((string) $this->get_option('tokens', 'USDC,USDT')));
        $selectedTo = $this->pickPayoutAddress($to, $chainId);

        $callback = WC()->api_request_url('trustless_commerce');

        try {
            $api = new Trustless_Commerce_Api($baseUrl);
            $result = $api->createInvoice([
                'price' => wc_format_decimal($order->get_total(), 2),
                'to' => $to,
                'chains' => $chains,
                'tokens' => $tokens,
                'chainId' => $chainId,
                'token' => $token,
                'selectedTo' => $selectedTo,
                'clientInvoiceId' => (string) $order->get_id(),
                'title' => sprintf(__('Order #%s', 'trustless-commerce'), $order->get_order_number()),
                'callback' => $callback,
                'allowPartial' => false,
            ], 'wc-order-' . $order->get_id());

            $invoice = $result['invoice'] ?? [];
            $order->update_meta_data('_trustless_invoice_id', $invoice['id'] ?? '');
            $order->update_meta_data('_trustless_invoice_address', $invoice['invoiceAddress'] ?? '');
            $order->update_status('pending', __('Awaiting crypto payment via Trustless Commerce.', 'trustless-commerce'));
            $order->save();

            return [
                'result' => 'success',
                'redirect' => $api->checkoutUrl($result),
            ];
        } catch (Throwable $e) {
            wc_add_notice($e->getMessage(), 'error');
            return ['result' => 'fail'];
        }
    }

    public function thankyou_page($order_id): void
    {
        $order = wc_get_order($order_id);
        if (!$order instanceof WC_Order || $order->get_payment_method() !== $this->id) {
            return;
        }
        if ($order->is_paid()) {
            echo '<p>' . esc_html__('Payment received. Thank you!', 'trustless-commerce') . '</p>';
            return;
        }
        echo '<p>' . esc_html__('Your crypto payment is being confirmed. This page will update when payment is detected.', 'trustless-commerce') . '</p>';
    }

    /** @return list<string> */
    private function splitList(string $value): array
    {
        return array_values(array_filter(array_map('trim', explode(',', $value))));
    }

    /** @param list<string> $to */
    private function pickPayoutAddress(array $to, string $chainId): string
    {
        $isTron = in_array($chainId, ['3448148188', '728126428'], true);
        foreach ($to as $address) {
            if ($isTron && str_starts_with($address, 'T')) {
                return $address;
            }
            if (!$isTron && str_starts_with($address, '0x')) {
                return $address;
            }
        }
        return $to[0];
    }
}
