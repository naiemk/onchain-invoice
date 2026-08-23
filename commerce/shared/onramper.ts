/**
 * Onramper widget helpers: asset mapping + Signature V2 URL signing.
 * @see https://docs.onramper.com/docs/widget-sign-a-url-v2
 */

import { createHash, createPrivateKey, randomUUID, sign } from "node:crypto";

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

/** Default fiat currencies exposed when Onramper is enabled. */
export const DEFAULT_ONRAMPER_FIATS = [
  "USD",
  "EUR",
  "GBP",
  "SEK",
  "NOK",
  "DKK",
  "CHF",
  "CAD",
  "AUD",
  "JPY",
  "PLN",
  "CZK",
] as const;

export interface OnramperAssetIds {
  /** Onramper crypto id (onlyCryptos / wallets prefix). */
  cryptoId: string;
  /** Onramper network id (onlyCryptoNetworks / networkWallets prefix). */
  networkId: string;
}

/** Product chain/token pairs that may use card/bank checkout (mainnet + testnet stand-ins). */
export const ONRAMPER_SUPPORTED_PAIRS = [
  { chainId: "8453", token: "USDC" },
  { chainId: "tron", token: "USDT" },
  { chainId: "56", token: "USDC" },
  { chainId: "56", token: "USDT" },
  { chainId: "11155111", token: "USDC" },
  { chainId: "nile", token: "USDT" },
] as const;

export function onramperPairKey(chainId: string, token: string): string {
  return `${String(chainId)}:${token.trim().toUpperCase()}`;
}

/** True when the widget origin host is Onramper sandbox (.dev). */
export function isOnramperSandboxOrigin(widgetOrigin: string): boolean {
  try {
    return new URL(widgetOrigin).hostname.endsWith(".dev");
  } catch {
    return false;
  }
}

/**
 * Map product chainId + token → Onramper asset ids for widget locking.
 * Testnet pairs (Sepolia, Nile) map to mainnet Onramper ids for sandbox UX only —
 * sandbox checkout does not fund testnet invoice addresses.
 */
export function resolveOnramperAsset(chainId: string, token: string): OnramperAssetIds | null {
  const symbol = token.trim().toUpperCase();
  const id = String(chainId).toLowerCase();

  if (id === "8453" && symbol === "USDC") {
    return { cryptoId: "usdc_base", networkId: "base" };
  }
  if ((id === "tron" || id === "0x2b6653dc") && symbol === "USDT") {
    return { cryptoId: "usdt_tron", networkId: "tron" };
  }
  if (id === "56" && symbol === "USDC") {
    return { cryptoId: "usdc_bsc", networkId: "bsc" };
  }
  if (id === "56" && symbol === "USDT") {
    return { cryptoId: "usdt_bsc", networkId: "bsc" };
  }
  if (id === "11155111" && symbol === "USDC") {
    return { cryptoId: "usdc_base", networkId: "base" };
  }
  if (id === "nile" && symbol === "USDT") {
    return { cryptoId: "usdt_tron", networkId: "tron" };
  }
  return null;
}

export function onramperSupportedPair(chainId: string, token: string): boolean {
  return resolveOnramperAsset(chainId, token) != null;
}

export interface SignWidgetUrlV2Options {
  baseUrl: string;
  privateKeyPem: string;
  fields: Record<string, string>;
  expiryMinutes?: number;
}

export function signWidgetUrlV2(options: SignWidgetUrlV2Options): { url: string; expiresAt: string } {
  const { baseUrl, privateKeyPem, fields, expiryMinutes = 15 } = options;
  if (!fields.apiKey) {
    throw new Error("apiKey is required in signed widget fields");
  }

  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const expiresAt = new Date(Date.now() + expiryMinutes * 60 * 1000).toISOString();

  const canonicalParams = new URLSearchParams(fields);
  canonicalParams.sort();
  const canonicalQuery = canonicalParams.toString();

  const contentToSign = [
    "ONRAMPER-SIG-V2",
    timestamp,
    nonce,
    "GET",
    "/",
    canonicalQuery,
    "",
    sha256Hex(""),
  ].join("\n");

  const privateKey = createPrivateKey(privateKeyPem);
  const signature = sign(null, Buffer.from(contentToSign), privateKey);

  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(fields)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("sigV2", `v2:${signature.toString("base64")}`);
  url.searchParams.set("sigV2Timestamp", timestamp);
  url.searchParams.set("sigV2Nonce", nonce);
  url.searchParams.set("sigV2Expiry", expiresAt);
  url.searchParams.set("sigV2Fields", Object.keys(fields).sort().join(","));

  return { url: url.toString(), expiresAt };
}

export interface BuildOnrampSessionInput {
  apiKey: string;
  signingKeyPem: string;
  widgetOrigin: string;
  invoiceId: string;
  invoiceAddress: string;
  chainId: string;
  token: string;
  priceUsd: string;
  fiat: string;
  /** When true, lock onlyFiats to the payer's choice (fiat-only invoices). */
  lockFiat: boolean;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
}

export function buildOnrampWidgetSession(input: BuildOnrampSessionInput): {
  widgetUrl: string;
  expiresAt: string;
} {
  const asset = resolveOnramperAsset(input.chainId, input.token);
  if (!asset) {
    throw Object.assign(
      new Error(`Onramper does not support ${input.token} on chain ${input.chainId}`),
      { statusCode: 400 }
    );
  }

  const fiat = input.fiat.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(fiat)) {
    throw Object.assign(new Error("fiat must be a 3-letter currency code"), { statusCode: 400 });
  }

  const fields: Record<string, string> = {
    apiKey: input.apiKey,
    mode: "buy",
    partnerContext: input.invoiceId,
    wallets: `${asset.cryptoId}:${input.invoiceAddress}`,
    networkWallets: `${asset.networkId}:${input.invoiceAddress}`,
    onlyCryptos: asset.cryptoId,
    onlyCryptoNetworks: asset.networkId,
    defaultCrypto: asset.cryptoId,
    isAddressEditable: "false",
    defaultFiat: fiat,
    defaultAmount: normalizeUsdAmount(input.priceUsd),
    hideTopBar: "true",
    redirectAtCheckout: "false",
  };

  if (input.lockFiat) {
    fields.onlyFiats = fiat;
  }
  if (input.successRedirectUrl) {
    fields.successRedirectUrl = input.successRedirectUrl;
  }
  if (input.failureRedirectUrl) {
    fields.failureRedirectUrl = input.failureRedirectUrl;
  }

  const signed = signWidgetUrlV2({
    baseUrl: input.widgetOrigin,
    privateKeyPem: input.signingKeyPem,
    fields,
    expiryMinutes: 15,
  });
  return { widgetUrl: signed.url, expiresAt: signed.expiresAt };
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function normalizeUsdAmount(priceUsd: string): string {
  const n = Number(priceUsd);
  if (!Number.isFinite(n) || n <= 0) {
    throw Object.assign(new Error("Invalid invoice price for onramp"), { statusCode: 400 });
  }
  // Widget defaultAmount is fiat amount; invoice price is USD today.
  return String(Math.round(n * 100) / 100);
}
