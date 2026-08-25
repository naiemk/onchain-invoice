import { t } from "./t.js";

export function localizeOnrampQuoteError(body: {
  code?: string;
  error?: string;
  fiat?: string;
  minAmount?: number;
  maxAmount?: number;
}): string | null {
  const fiat = (body.fiat ?? "").toUpperCase() || "USD";
  switch (body.code) {
    case "onramp_limit_mismatch": {
      if (body.minAmount != null && body.maxAmount != null) {
        return t("errors.onrampLimitMismatch", {
          fiat,
          min: String(body.minAmount),
          max: String(body.maxAmount),
        });
      }
      if (body.minAmount != null) {
        return t("errors.onrampLimitMin", { fiat, min: String(body.minAmount) });
      }
      if (body.maxAmount != null) {
        return t("errors.onrampLimitMax", { fiat, max: String(body.maxAmount) });
      }
      return t("errors.onrampQuoteUnavailable");
    }
    case "onramp_no_payment_method":
      return t("errors.onrampNoPaymentMethod", { fiat });
    case "onramp_provider_unavailable":
      return t("errors.onrampProviderUnavailable");
    case "onramp_quote_unavailable":
      return t("errors.onrampQuoteUnavailable");
    default:
      return null;
  }
}

export function localizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "";
  if (!message) return t("common.loadFailed");

  if (message === "Address is required") return t("errors.addressRequired");
  if (message === "Tron address must be a valid base58check T… address") return t("errors.tronAddress");
  if (message.startsWith("Invalid Solana address")) return t("errors.solanaAddress");
  if (message === "EVM address must be a 0x-prefixed 40-hex-character address") return t("errors.evmFormat");
  if (message === "Invalid EVM address checksum") return t("errors.evmChecksum");
  const checksum = message.match(/^EVM address must be EIP-55 checksummed \(expected (.+)\)$/);
  if (checksum) return t("errors.evmChecksumExpected", { address: checksum[1] ?? "" });
  if (message.startsWith("Invalid Tron address checksum")) return t("errors.tronAddress");
  if (message === "Amount (USD) is required.") return t("errors.missingPrice");
  if (message === "Select at least one network.") return t("errors.missingNetwork");
  if (message === "Select at least one token.") return t("errors.missingToken");
  if (message === "USDT is required when Tron is selected.") return t("errors.usdtRequiredForTron");
  const token = message.match(/^No compatible token selected for (.+)\.$/);
  if (token) return t("errors.noCompatibleToken", { chainId: token[1] ?? "" });
  if (message === "EVM merchant wallet is required.") return t("errors.evmWalletRequired");
  if (message === "Tron merchant wallet is required.") return t("errors.tronWalletRequired");
  if (message === "Solana merchant wallet is required.") return t("errors.solanaWalletRequired");
  if (message === "Invalid pay link") return t("errors.invalidPayLink");
  if (message.startsWith("Missing pay-link parameter:")) return t("errors.invalidPayLink");
  if (message.startsWith("Missing required query param:")) return t("errors.invalidPayLink");
  if (message === "Invoice not found") return t("errors.invoiceNotFound");
  const notFoundStatus = message.match(/^Invoice not found \((\d+)\)$/);
  if (notFoundStatus) return t("errors.invoiceNotFoundStatus", { status: notFoundStatus[1] ?? "" });
  if (message === "Create failed") return t("errors.createFailed");
  if (message === "Invalid admin key") return t("admin.invalidKey");
  if (message === "Unlock failed") return t("admin.unlockFailed");
  if (message === "Stats request failed") return t("admin.statsFailed");
  if (message === "Failed to load invoices") return t("merchant.loadFailed");
  if (message === "Failed to load") return t("common.loadFailed");

  const limitBetween = message.match(
    /^Amount should be in between ([A-Z]{3}) ([\d.]+) and \1 ([\d.]+)$/i
  );
  if (limitBetween) {
    return t("errors.onrampLimitMismatch", {
      fiat: limitBetween[1]!.toUpperCase(),
      min: limitBetween[2]!,
      max: limitBetween[3]!,
    });
  }
  if (message.startsWith("No Onramper quotes available")) return t("errors.onrampQuoteUnavailable");
  if (message.startsWith("Onramper provider ")) return t("errors.onrampProviderUnavailable");

  return message;
}

export function statusLabel(status: string): string {
  switch (status) {
    case "created":
      return t("status.created");
    case "awaiting_payment":
      return t("status.awaiting_payment");
    case "paid":
      return t("status.paid");
    case "paid_partial":
      return t("status.paid_partial");
    case "swept":
      return t("status.swept");
    default:
      return status.replace(/_/g, " ");
  }
}
