/**
 * Onramper widget helpers: asset mapping + Signature V2 URL signing.
 * @see https://docs.onramper.com/docs/widget-sign-a-url-v2
 */

import { createHash, createHmac, createPrivateKey, randomUUID, sign, timingSafeEqual } from "node:crypto";
import { buildOnramperThemeParams } from "./onramper-quotes.js";
export type {
  OnramperAssetIds,
  OnramperSessionAsset,
  OnramperWidgetMode,
} from "./onramper-assets.js";
export {
  DEFAULT_ONRAMPER_FIATS,
  EVM_KNOWN_STABLE_ADDRESSES,
  isOnramperSandboxOrigin,
  listOnramperEvmWalletAssets,
  ONRAMPER_SUPPORTED_PAIRS,
  onramperPairKey,
  onramperSupportedPair,
  resolveEvmStableTokenAddress,
  resolveOnramperAsset,
  resolveProductAssetFromOnramperCryptoId,
  walletStableTokensForChain,
} from "./onramper-assets.js";
import type { OnramperSessionAsset, OnramperWidgetMode } from "./onramper-assets.js";
import { resolveOnramperAsset } from "./onramper-assets.js";

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

/** True when the signing secret is an Ed25519 PEM (Signature V2), not a dashboard HMAC hex (V1). */
export function isOnramperPemSigningKey(key: string): boolean {
  return /BEGIN [A-Z ]*PRIVATE KEY/.test(key);
}

const V1_SIGN_PARAMS = ["networkWallets", "walletAddressTags", "wallets"] as const;

export interface SignWidgetUrlV1Options {
  baseUrl: string;
  hmacSecret: string;
  fields: Record<string, string>;
}

/**
 * Onramper dashboard "signing secret" is HMAC-SHA256 (V1).
 * Sign unencoded `wallets` / `networkWallets` / `walletAddressTags` only.
 * @see https://docs.onramper.com/docs/signing-widget-url
 */
export function signWidgetUrlV1(options: SignWidgetUrlV1Options): { url: string; expiresAt: string } {
  const { baseUrl, hmacSecret, fields } = options;
  if (!fields.apiKey) {
    throw new Error("apiKey is required in signed widget fields");
  }

  const signParts: string[] = [];
  for (const key of V1_SIGN_PARAMS) {
    const value = fields[key];
    if (value) signParts.push(`${key}=${value}`);
  }
  const signContent = signParts.join("&");
  const signature = createHmac("sha256", hmacSecret).update(signContent).digest("hex");

  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(fields)) {
    url.searchParams.set(key, value);
  }
  url.searchParams.set("signature", signature);

  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  return { url: url.toString(), expiresAt };
}

export function verifyOnramperWebhookSignature(secret: string, signature: string, body: string): boolean {
  if (!secret || !signature) return false;
  const expected = createHmac("sha256", secret).update(body).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  return a.length === b.length && timingSafeEqual(a, b);
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
  /** Ed25519 PEM (V2) or dashboard HMAC hex (V1). */
  signingKeyPem: string;
  widgetOrigin: string;
  invoiceId: string;
  invoiceAddress: string;
  chainId: string;
  token: string;
  priceUsd: string;
  fiat: string;
  /** Customer-facing fiat amount when locked on fiat invoices. */
  displayAmount?: string | null;
  /** Onramper payment method id from quote metadata. */
  defaultPaymentMethod?: string | null;
  /** Onramper ramp/provider id — locks onlyOnramps. */
  onlyOnramps?: string | null;
  /** UI theme for unsigned widget styling params. */
  theme?: "light" | "dark";
  /** When true, lock onlyFiats to the payer's choice (fiat-only invoices). */
  lockFiat: boolean;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
}

export interface BuildOnramperWidgetSessionInput {
  apiKey: string;
  signingKeyPem: string;
  widgetOrigin: string;
  mode: OnramperWidgetMode;
  partnerContext: string;
  /** Buy destination / sell source wallet address. */
  walletAddress: string;
  assets: OnramperSessionAsset[];
  fiat: string;
  /** Fiat default amount (buy). Required for non-USD when no displayAmount elsewhere. */
  defaultAmount?: string | null;
  lockFiat?: boolean;
  theme?: "light" | "dark";
  defaultPaymentMethod?: string | null;
  onlyOnramps?: string | null;
  successRedirectUrl?: string;
  failureRedirectUrl?: string;
  /** Sell: partner URL for Wallet Initiation cashout redirect. */
  offrampCashoutRedirectUrl?: string;
  /** Sell: max crypto the user can sell (human units). */
  maxAvailableCrypto?: string | number | null;
}

function pickDefaultAsset(assets: OnramperSessionAsset[]): OnramperSessionAsset {
  const usdc = assets.find((a) => a.token === "USDC");
  return usdc ?? assets[0]!;
}

function signWidgetFields(
  widgetOrigin: string,
  signingKeyPem: string,
  fields: Record<string, string>
): { widgetUrl: string; expiresAt: string } {
  const signed = isOnramperPemSigningKey(signingKeyPem)
    ? signWidgetUrlV2({
        baseUrl: widgetOrigin,
        privateKeyPem: signingKeyPem,
        fields,
        expiryMinutes: 15,
      })
    : signWidgetUrlV1({
        baseUrl: widgetOrigin,
        hmacSecret: signingKeyPem,
        fields,
      });
  return { widgetUrl: signed.url, expiresAt: signed.expiresAt };
}

/** Generalized buy/sell widget session (invoice buy or wallet deposit/withdraw). */
export function buildOnramperWidgetSession(input: BuildOnramperWidgetSessionInput): {
  widgetUrl: string;
  expiresAt: string;
} {
  if (!input.assets.length) {
    throw Object.assign(new Error("At least one Onramper asset is required"), { statusCode: 400 });
  }

  const fiat = input.fiat.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(fiat)) {
    throw Object.assign(new Error("fiat must be a 3-letter currency code"), { statusCode: 400 });
  }

  const defaultAsset = pickDefaultAsset(input.assets);
  const cryptoIds = [...new Set(input.assets.map((a) => a.cryptoId))];
  const networkIds = [...new Set(input.assets.map((a) => a.networkId))];
  const wallets = input.assets.map((a) => `${a.cryptoId}:${input.walletAddress}`).join(",");
  const networkWallets = [...new Set(input.assets.map((a) => a.networkId))]
    .map((networkId) => `${networkId}:${input.walletAddress}`)
    .join(",");

  const themeParams = buildOnramperThemeParams(input.theme ?? "light");

  if (input.mode === "sell") {
    const fields: Record<string, string> = {
      apiKey: input.apiKey,
      mode: "sell",
      partnerContext: input.partnerContext,
      wallets,
      networkWallets,
      sell_onlyCryptos: cryptoIds.join(","),
      sell_onlyCryptoNetworks: networkIds.join(","),
      sell_defaultCrypto: defaultAsset.cryptoId,
      sell_defaultFiat: fiat,
      sell_isAmountEditable: "true",
      isAddressEditable: "false",
      hideTopBar: "true",
      redirectAtCheckout: "false",
      ...themeParams,
    };
    if (input.lockFiat) {
      fields.sell_onlyFiats = fiat;
    }
    if (input.offrampCashoutRedirectUrl) {
      fields.offrampCashoutRedirectUrl = input.offrampCashoutRedirectUrl;
    }
    if (input.maxAvailableCrypto != null && String(input.maxAvailableCrypto).trim() !== "") {
      fields.sell_maxAvailableCrypto = String(input.maxAvailableCrypto);
    }
    if (input.successRedirectUrl) fields.successRedirectUrl = input.successRedirectUrl;
    if (input.failureRedirectUrl) fields.failureRedirectUrl = input.failureRedirectUrl;
    return signWidgetFields(input.widgetOrigin, input.signingKeyPem, fields);
  }

  // Buy mode
  let defaultAmount: string;
  if (input.defaultAmount) {
    defaultAmount = normalizeFiatAmount(input.defaultAmount);
  } else {
    throw Object.assign(new Error("defaultAmount is required for buy widget sessions"), {
      statusCode: 400,
    });
  }

  const fields: Record<string, string> = {
    apiKey: input.apiKey,
    mode: "buy",
    partnerContext: input.partnerContext,
    wallets,
    networkWallets,
    onlyCryptos: cryptoIds.join(","),
    onlyCryptoNetworks: networkIds.join(","),
    defaultCrypto: defaultAsset.cryptoId,
    isAddressEditable: "false",
    defaultFiat: fiat,
    defaultAmount,
    isAmountEditable: "true",
    hideTopBar: "true",
    redirectAtCheckout: "false",
    ...themeParams,
  };

  if (input.defaultPaymentMethod) {
    fields.defaultPaymentMethod = input.defaultPaymentMethod.trim().toLowerCase();
  }
  if (input.onlyOnramps) {
    fields.onlyOnramps = input.onlyOnramps.trim().toLowerCase();
  }
  if (input.lockFiat) {
    fields.onlyFiats = fiat;
  }
  if (input.successRedirectUrl) {
    fields.successRedirectUrl = input.successRedirectUrl;
  }
  if (input.failureRedirectUrl) {
    fields.failureRedirectUrl = input.failureRedirectUrl;
  }

  return signWidgetFields(input.widgetOrigin, input.signingKeyPem, fields);
}

/** Invoice onramp: thin wrapper around {@link buildOnramperWidgetSession}. */
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
  let defaultAmount: string;
  if (input.displayAmount) {
    defaultAmount = normalizeFiatAmount(input.displayAmount);
  } else if (fiat === "USD") {
    defaultAmount = normalizeUsdAmount(input.priceUsd);
  } else {
    throw Object.assign(
      new Error("displayAmount is required when locking a non-USD fiat amount on the widget"),
      { statusCode: 400 }
    );
  }

  return buildOnramperWidgetSession({
    apiKey: input.apiKey,
    signingKeyPem: input.signingKeyPem,
    widgetOrigin: input.widgetOrigin,
    mode: "buy",
    partnerContext: input.invoiceId,
    walletAddress: input.invoiceAddress,
    assets: [{ chainId: input.chainId, token: input.token, ...asset }],
    fiat: input.fiat,
    defaultAmount,
    lockFiat: input.lockFiat,
    theme: input.theme,
    defaultPaymentMethod: input.defaultPaymentMethod,
    onlyOnramps: input.onlyOnramps,
    successRedirectUrl: input.successRedirectUrl,
    failureRedirectUrl: input.failureRedirectUrl,
  });
}

function sha256Hex(data: string): string {
  return createHash("sha256").update(data).digest("hex");
}

function normalizeUsdAmount(priceUsd: string): string {
  const n = Number(priceUsd);
  if (!Number.isFinite(n) || n <= 0) {
    throw Object.assign(new Error("Invalid invoice price for onramp"), { statusCode: 400 });
  }
  return String(Math.round(n * 100) / 100);
}

function normalizeFiatAmount(amount: string): string {
  const n = Number(amount);
  if (!Number.isFinite(n) || n <= 0) {
    throw Object.assign(new Error("Invalid display fiat amount for onramp"), { statusCode: 400 });
  }
  return String(Math.round(n * 100) / 100);
}
