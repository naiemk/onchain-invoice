<?php
/**
 * Plugin Name: Trustless Commerce for WooCommerce
 * Plugin URI: https://github.com/naiemk/onchain-invoice
 * Description: Accept USDC/USDT crypto payments via Trustless Commerce hosted checkout.
 * Version: 0.1.0
 * Requires at least: 6.0
 * Requires PHP: 8.1
 * Author: Trustless Commerce
 * License: MIT
 * Text Domain: trustless-commerce
 * WC requires at least: 8.0
 * WC tested up to: 9.0
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

define('TRUSTLESS_COMMERCE_VERSION', '0.1.0');
define('TRUSTLESS_COMMERCE_PLUGIN_FILE', __FILE__);
define('TRUSTLESS_COMMERCE_PLUGIN_DIR', plugin_dir_path(__FILE__));

require_once TRUSTLESS_COMMERCE_PLUGIN_DIR . 'includes/class-trustless-commerce-api.php';
require_once TRUSTLESS_COMMERCE_PLUGIN_DIR . 'includes/class-trustless-commerce-webhook.php';

add_action('plugins_loaded', 'trustless_commerce_init', 11);

function trustless_commerce_init(): void
{
    if (!class_exists('WooCommerce')) {
        add_action('admin_notices', static function (): void {
            echo '<div class="notice notice-error"><p>';
            esc_html_e('Trustless Commerce requires WooCommerce to be installed and active.', 'trustless-commerce');
            echo '</p></div>';
        });
        return;
    }

    require_once TRUSTLESS_COMMERCE_PLUGIN_DIR . 'includes/class-wc-gateway-trustless-commerce.php';

    add_filter('woocommerce_payment_gateways', static function (array $gateways): array {
        $gateways[] = 'WC_Gateway_Trustless_Commerce';
        return $gateways;
    });

    Trustless_Commerce_Webhook::register();
}

add_action('before_woocommerce_init', static function (): void {
    if (class_exists(\Automattic\WooCommerce\Utilities\FeaturesUtil::class)) {
        \Automattic\WooCommerce\Utilities\FeaturesUtil::declare_compatibility('custom_order_tables', TRUSTLESS_COMMERCE_PLUGIN_FILE, true);
    }
});
