/** How the payer may fund the on-chain invoice address. */

export type PaymentMode = "crypto" | "crypto_or_fiat" | "fiat";

export const PAYMENT_MODES: readonly PaymentMode[] = ["crypto", "crypto_or_fiat", "fiat"] as const;

export function parsePaymentMode(value: unknown): PaymentMode {
  if (value === "crypto" || value === "crypto_or_fiat" || value === "fiat") return value;
  if (value == null || value === "") return "crypto";
  throw Object.assign(new Error(`Invalid paymentMode: ${String(value)}`), { statusCode: 400 });
}

export function paymentModeAllowsFiat(mode: PaymentMode): boolean {
  return mode === "fiat" || mode === "crypto_or_fiat";
}

export function parseSlippageBps(value: unknown): number {
  if (value == null || value === "") return 100;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return 100;
  return Math.min(10_000, Math.round(n));
}
