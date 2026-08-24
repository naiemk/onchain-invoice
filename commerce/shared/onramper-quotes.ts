/**
 * Onramper Quotes API proxy helpers (server-side only).
 * @see https://docs.onramper.com/reference/get_quotes-fiat-crypto
 */

import { isOnramperSandboxOrigin, resolveOnramperAsset } from "./onramper.js";

export type QuoteDirection = "receive" | "pay";

export interface OnrampQuoteRow {
  provider: string;
  paymentMethod: string;
  fiatAmount: string;
  cryptoAmount: string;
  fees?: { networkFee?: number; transactionFee?: number };
  recommendations?: string[];
  quoteId?: string;
}

export interface OnrampQuoteResult {
  fiat: string;
  cryptoAmount: string;
  fiatAmount: string;
  paymentMethod: string;
  country: string;
  direction: QuoteDirection;
  quotes: OnrampQuoteRow[];
  recommended: OnrampQuoteRow;
  demo?: boolean;
}

export interface OnrampPaymentMethod {
  id: string;
  name: string;
  icon?: string;
}

const CACHE_MS = 30_000;
const quoteCache = new Map<string, { expires: number; value: OnrampQuoteResult }>();
const methodsCache = new Map<string, { expires: number; value: OnrampPaymentMethod[] }>();

/** Rough fiat/USD rates for demo quotes when Onramper keys are absent. */
const DEMO_FIAT_USD: Record<string, number> = {
  USD: 1,
  EUR: 0.92,
  GBP: 0.79,
  SEK: 10.5,
  NOK: 10.8,
  DKK: 6.9,
  CHF: 0.88,
  CAD: 1.36,
  AUD: 1.52,
  JPY: 150,
  PLN: 4.0,
  CZK: 23,
};

export function onramperApiHost(apiKey: string, widgetOrigin: string): string {
  if (apiKey.startsWith("pk_test") || isOnramperSandboxOrigin(widgetOrigin)) {
    return "https://api-stg.onramper.com";
  }
  return "https://api.onramper.com";
}

export function buildOnramperThemeParams(theme: "light" | "dark"): Record<string, string> {
  if (theme === "dark") {
    return {
      themeName: "dark",
      primaryColor: "5b9bff",
      secondaryColor: "171e2c",
      cardColor: "1c2536",
      primaryTextColor: "eef3fb",
      secondaryTextColor: "c2cddc",
      containerColor: "0c111b",
      borderRadius: "12",
    };
  }
  return {
    themeName: "light",
    primaryColor: "0a6cff",
    secondaryColor: "ffffff",
    cardColor: "f1f5f9",
    primaryTextColor: "0a2540",
    secondaryTextColor: "425466",
    containerColor: "f6f9fc",
    borderRadius: "12",
  };
}

function cacheKey(parts: Record<string, string | undefined>): string {
  return Object.keys(parts)
    .sort()
    .map((k) => `${k}=${parts[k] ?? ""}`)
    .join("&");
}

function formatAmount(n: number, decimals = 2): string {
  const factor = 10 ** decimals;
  return String(Math.round(n * factor) / factor);
}

function demoFiatRate(fiat: string): number {
  return DEMO_FIAT_USD[fiat.toUpperCase()] ?? 1;
}

export function buildDemoQuote(input: {
  fiat: string;
  direction: QuoteDirection;
  cryptoAmount?: string;
  fiatAmount?: string;
  country: string;
  paymentMethod: string;
  chainId: string;
  token: string;
}): OnrampQuoteResult {
  const fiat = input.fiat.toUpperCase();
  const paymentMethod = input.paymentMethod || "creditcard";
  const rate = demoFiatRate(fiat);
  const feeMarkup = 1.025;

  let cryptoAmount: number;
  let fiatAmount: number;

  if (input.direction === "receive") {
    cryptoAmount = Number(input.cryptoAmount);
    if (!Number.isFinite(cryptoAmount) || cryptoAmount <= 0) {
      throw Object.assign(new Error("cryptoAmount is required for receive quotes"), { statusCode: 400 });
    }
    fiatAmount = cryptoAmount * rate * feeMarkup;
  } else {
    fiatAmount = Number(input.fiatAmount);
    if (!Number.isFinite(fiatAmount) || fiatAmount <= 0) {
      throw Object.assign(new Error("fiatAmount is required for pay quotes"), { statusCode: 400 });
    }
    cryptoAmount = fiatAmount / (rate * feeMarkup);
  }

  const row: OnrampQuoteRow = {
    provider: "demo",
    paymentMethod,
    fiatAmount: formatAmount(fiatAmount),
    cryptoAmount: formatAmount(cryptoAmount, 6),
    fees: { networkFee: 0, transactionFee: 0 },
    recommendations: ["BestPrice", "Demo"],
    quoteId: "demo-quote",
  };

  return {
    fiat,
    cryptoAmount: row.cryptoAmount,
    fiatAmount: row.fiatAmount,
    paymentMethod,
    country: input.country.toLowerCase(),
    direction: input.direction,
    quotes: [row],
    recommended: row,
    demo: true,
  };
}

interface RawOnramperQuote {
  ramp?: string;
  paymentMethod?: string;
  rate?: number;
  networkFee?: number;
  transactionFee?: number;
  payout?: number;
  inAmount?: number;
  outAmount?: number;
  fiatAmount?: number;
  cryptoAmount?: number;
  errors?: unknown[];
  recommendations?: string[];
  quoteId?: string;
}

function rowFromRaw(
  raw: RawOnramperQuote,
  direction: QuoteDirection,
  inputAmount: number
): OnrampQuoteRow | null {
  if (raw.errors && raw.errors.length > 0) return null;
  const provider = raw.ramp ?? "unknown";
  const paymentMethod = raw.paymentMethod ?? "creditcard";

  let fiatAmount = raw.fiatAmount ?? raw.inAmount;
  let cryptoAmount = raw.cryptoAmount ?? raw.payout ?? raw.outAmount;

  if (direction === "receive") {
    cryptoAmount = cryptoAmount ?? inputAmount;
    if (fiatAmount == null && raw.rate && cryptoAmount != null) {
      fiatAmount = cryptoAmount * raw.rate;
    }
  } else {
    fiatAmount = fiatAmount ?? inputAmount;
    if (cryptoAmount == null && raw.rate && fiatAmount != null) {
      cryptoAmount = fiatAmount / raw.rate;
    }
  }

  if (fiatAmount == null || cryptoAmount == null) return null;

  return {
    provider,
    paymentMethod,
    fiatAmount: formatAmount(Number(fiatAmount)),
    cryptoAmount: formatAmount(Number(cryptoAmount), 6),
    fees: { networkFee: raw.networkFee, transactionFee: raw.transactionFee },
    recommendations: raw.recommendations,
    quoteId: raw.quoteId,
  };
}

function pickRecommended(rows: OnrampQuoteRow[], preferredProvider?: string): OnrampQuoteRow {
  if (preferredProvider) {
    const match = rows.find((r) => r.provider.toLowerCase() === preferredProvider.toLowerCase());
    if (match) return match;
  }
  const bestPrice = rows.find((r) => r.recommendations?.includes("BestPrice"));
  return bestPrice ?? rows[0]!;
}

function parseQuoteResponse(
  data: unknown,
  direction: QuoteDirection,
  inputAmount: number,
  fiat: string,
  country: string,
  paymentMethod: string,
  preferredProvider?: string
): OnrampQuoteResult {
  const list = Array.isArray(data) ? data : [];
  const rows: OnrampQuoteRow[] = [];
  for (const item of list) {
    const row = rowFromRaw(item as RawOnramperQuote, direction, inputAmount);
    if (row) rows.push(row);
  }
  if (rows.length === 0) {
    throw Object.assign(new Error("No Onramper quotes available for this pair"), { statusCode: 502 });
  }
  if (preferredProvider) {
    const match = rows.find((r) => r.provider.toLowerCase() === preferredProvider.toLowerCase());
    if (!match) {
      throw Object.assign(
        new Error(`Onramper provider "${preferredProvider}" is not available for this quote`),
        { statusCode: 502 }
      );
    }
  }
  const recommended = pickRecommended(rows, preferredProvider);
  return {
    fiat,
    cryptoAmount: recommended.cryptoAmount,
    fiatAmount: recommended.fiatAmount,
    paymentMethod: paymentMethod || recommended.paymentMethod,
    country,
    direction,
    quotes: rows,
    recommended,
  };
}

/** Absolute relative drift of settlement crypto amounts, in basis points. */
export function settlementDriftBps(lockedSettlement: string, liveSettlement: string): number {
  const locked = Number(lockedSettlement);
  const live = Number(liveSettlement);
  if (!Number.isFinite(locked) || locked <= 0 || !Number.isFinite(live) || live <= 0) {
    return Number.POSITIVE_INFINITY;
  }
  return Math.round((Math.abs(live - locked) / locked) * 10_000);
}

export function isSettlementWithinSlippage(
  lockedSettlement: string,
  liveSettlement: string,
  slippageBps: number
): boolean {
  const maxBps = Number.isFinite(slippageBps) ? Math.max(0, Math.round(slippageBps)) : 0;
  return settlementDriftBps(lockedSettlement, liveSettlement) <= maxBps;
}

export const DEFAULT_QUOTE_SLIPPAGE_BPS = 100; // 1%

export function parseSlippageBps(value: unknown, fallback = DEFAULT_QUOTE_SLIPPAGE_BPS): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(5_000, Math.max(0, Math.round(n)));
}

export async function fetchOnrampQuote(options: {
  apiKey: string;
  demo: boolean;
  widgetOrigin: string;
  fiat: string;
  chainId: string;
  token: string;
  country: string;
  paymentMethod?: string;
  /** Prefer this Onramper ramp id when selecting the recommended quote. */
  provider?: string;
  direction: QuoteDirection;
  cryptoAmount?: string;
  fiatAmount?: string;
  /** Skip in-memory cache (used for pay-time requotes). */
  skipCache?: boolean;
  fetchImpl?: typeof fetch;
}): Promise<OnrampQuoteResult> {
  const fiat = options.fiat.trim().toUpperCase();
  const country = options.country.trim().toLowerCase();
  const paymentMethod = (options.paymentMethod ?? "creditcard").trim().toLowerCase();
  const provider = options.provider?.trim().toLowerCase() || undefined;
  const direction = options.direction;
  const asset = resolveOnramperAsset(options.chainId, options.token);
  if (!asset) {
    throw Object.assign(
      new Error(`Onramper does not support ${options.token} on chain ${options.chainId}`),
      { statusCode: 400 }
    );
  }

  const amount =
    direction === "receive"
      ? String(options.cryptoAmount ?? "").trim()
      : String(options.fiatAmount ?? "").trim();
  if (!amount || !Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw Object.assign(
      new Error(direction === "receive" ? "cryptoAmount is required" : "fiatAmount is required"),
      { statusCode: 400 }
    );
  }

  const key = cacheKey({
    fiat,
    crypto: asset.cryptoId,
    country,
    paymentMethod,
    provider,
    direction,
    amount,
    chainId: options.chainId,
    token: options.token,
  });
  if (!options.skipCache) {
    const cached = quoteCache.get(key);
    if (cached && cached.expires > Date.now()) return cached.value;
  }

  if (options.demo || !options.apiKey) {
    const demo = buildDemoQuote({
      fiat,
      direction,
      cryptoAmount: direction === "receive" ? amount : undefined,
      fiatAmount: direction === "pay" ? amount : undefined,
      country,
      paymentMethod,
      chainId: options.chainId,
      token: options.token,
    });
    const withProvider = provider
      ? {
          ...demo,
          recommended: { ...demo.recommended, provider },
          quotes: demo.quotes.map((q) => ({ ...q, provider })),
        }
      : demo;
    quoteCache.set(key, { expires: Date.now() + CACHE_MS, value: withProvider });
    return withProvider;
  }

  const host = onramperApiHost(options.apiKey, options.widgetOrigin);
  const params = new URLSearchParams({
    platform: "web",
    country,
    paymentMethod,
    amount,
    input: direction === "receive" ? "destination" : "source",
    type: "buy",
  });

  const fetchFn = options.fetchImpl ?? fetch;
  const url = `${host}/quotes/${encodeURIComponent(fiat.toLowerCase())}/${encodeURIComponent(asset.cryptoId)}?${params}`;
  const res = await fetchFn(url, {
    headers: { Authorization: options.apiKey },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(new Error(`Onramper quote failed (${res.status}): ${text.slice(0, 200)}`), {
      statusCode: res.status >= 500 ? 502 : 400,
    });
  }
  const data = (await res.json()) as unknown;
  const result = parseQuoteResponse(
    data,
    direction,
    Number(amount),
    fiat,
    country,
    paymentMethod,
    provider
  );
  quoteCache.set(key, { expires: Date.now() + CACHE_MS, value: result });
  return result;
}

export async function fetchOnrampPaymentMethods(options: {
  apiKey: string;
  demo: boolean;
  widgetOrigin: string;
  fiat: string;
  chainId: string;
  token: string;
  country: string;
  fetchImpl?: typeof fetch;
}): Promise<OnrampPaymentMethod[]> {
  const fiat = options.fiat.trim().toUpperCase();
  const country = options.country.trim().toLowerCase();
  const asset = resolveOnramperAsset(options.chainId, options.token);
  if (!asset) {
    throw Object.assign(
      new Error(`Onramper does not support ${options.token} on chain ${options.chainId}`),
      { statusCode: 400 }
    );
  }

  const key = cacheKey({
    methods: "1",
    fiat,
    crypto: asset.cryptoId,
    country,
    chainId: options.chainId,
    token: options.token,
  });
  const cached = methodsCache.get(key);
  if (cached && cached.expires > Date.now()) return cached.value;

  const demoMethods: OnrampPaymentMethod[] = [
    { id: "creditcard", name: "Credit Card" },
    { id: "debitcard", name: "Debit Card" },
    { id: "banktransfer", name: "Bank Transfer" },
  ];

  if (options.demo || !options.apiKey) {
    methodsCache.set(key, { expires: Date.now() + CACHE_MS, value: demoMethods });
    return demoMethods;
  }

  const host = onramperApiHost(options.apiKey, options.widgetOrigin);
  const params = new URLSearchParams({
    source: fiat.toLowerCase(),
    destination: asset.cryptoId,
    country,
    type: "buy",
    platform: "web",
  });
  const fetchFn = options.fetchImpl ?? fetch;
  const url = `${host}/supported/payment-types/${encodeURIComponent(fiat.toLowerCase())}/${encodeURIComponent(asset.cryptoId)}?${params}`;
  const res = await fetchFn(url, {
    headers: { Authorization: options.apiKey },
  });
  if (!res.ok) {
    methodsCache.set(key, { expires: Date.now() + CACHE_MS, value: demoMethods });
    return demoMethods;
  }
  const data = (await res.json()) as unknown;
  const methods: OnrampPaymentMethod[] = [];
  if (Array.isArray(data)) {
    for (const item of data) {
      const row = item as { paymentTypeId?: string; id?: string; name?: string; icon?: string };
      const id = row.paymentTypeId ?? row.id;
      if (id) methods.push({ id, name: row.name ?? id, icon: row.icon });
    }
  }
  const value = methods.length > 0 ? methods : demoMethods;
  methodsCache.set(key, { expires: Date.now() + CACHE_MS, value });
  return value;
}

/** Round settlement crypto down slightly so fee variance cannot strand the invoice. */
export function settlementAmountFromQuote(cryptoAmount: string): string {
  const n = Number(cryptoAmount);
  if (!Number.isFinite(n) || n <= 0) {
    throw Object.assign(new Error("Invalid crypto amount from quote"), { statusCode: 400 });
  }
  const trimmed = Math.floor(n * 1_000_000) / 1_000_000;
  const withBuffer = Math.floor(trimmed * 999_000) / 1_000_000;
  return formatAmount(withBuffer, 6);
}

export function clearOnrampQuoteCaches(): void {
  quoteCache.clear();
  methodsCache.clear();
}
