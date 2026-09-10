/**
 * MetaMask on-ramp aggregator client (temporary pay-in hack).
 * Quotes/countries use SDK 2.1.14. Continue loads GET /providers/{code}/buy-widget
 * (SDK 2.1.10, still unauthenticated) so checkout is a signed provider URL with
 * walletAddress already set — no Portfolio connect step. MoonPay/Coinbase pages
 * refuse third-party iframes; Transak/Banxa/Ramp can be embedded on /buy.
 */

export const METAMASK_SDK_VERSION = "2.1.14";
/** Last SDK version whose buy-widget endpoint is still unauthenticated. */
export const METAMASK_WIDGET_SDK_VERSION = "2.1.10";
export const METAMASK_SDK_CONTEXT = "browser";
export const PAY_IN_CHAIN_ID = "8453";
export const PAY_IN_TOKEN = "USDC";
export const PAY_IN_TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const PAY_IN_NETWORK_LABEL = "Base";
export const PAY_IN_DEFAULT_AMOUNT = "100";
export const PAY_IN_CRYPTO_ID =
  `/currencies/crypto/${PAY_IN_CHAIN_ID}/${PAY_IN_TOKEN_ADDRESS.toLowerCase()}` as const;

export const DEFAULT_METAMASK_ORDERS_URL = "https://on-ramp.api.cx.metamask.io";
export const DEFAULT_METAMASK_REGIONS_URL = "https://on-ramp-cache.api.cx.metamask.io";
export const DEFAULT_METAMASK_GEO_URL = `${DEFAULT_METAMASK_ORDERS_URL}/geolocation`;
export const DEFAULT_METAMASK_BUY_ORIGIN = "https://portfolio.metamask.io";
export const DEFAULT_METAMASK_REDIRECT_URL = "https://portfolio.metamask.io";

export function isPayInSettlement(chainId: string, token: string): boolean {
  return String(chainId) === PAY_IN_CHAIN_ID && token.trim().toUpperCase() === PAY_IN_TOKEN;
}

/** Providers whose checkout pages refuse third-party iframes (new-tab checkout still works). */
const NON_EMBEDDABLE_PROVIDERS = new Set(["moonpay", "moonpay-b", "coinbase"]);

const CACHE_MS = 60_000;
const COUNTRIES_CACHE_MS = 10 * 60_000;

export interface MetamaskOnrampEndpoints {
  ordersUrl: string;
  regionsUrl: string;
  geoUrl: string;
  buyOrigin: string;
  redirectUrl?: string;
}

export interface PayInCountry {
  id: string;
  regionId: string;
  name: string;
  defaultFiat: string;
  fiats: string[];
  emoji?: string;
}

export interface PayInQuoteRow {
  id: string;
  provider: string;
  providerId: string;
  paymentMethod: string;
  paymentMethodId: string;
  paymentMethodName: string;
  fiatAmount: string;
  cryptoAmount: string;
  exchangeRate?: number;
  fees: { networkFee: number; providerFee: number; extraFee: number };
  /** True when the provider checkout can be iframed on our origin. */
  embeddable: boolean;
}

export interface PayInQuotesResult {
  region: string;
  regionId: string;
  fiat: string;
  amount: string;
  chainId: string;
  token: string;
  tokenAddress: string;
  quotes: PayInQuoteRow[];
}

type FetchLike = typeof fetch;

let fetchImpl: FetchLike = globalThis.fetch.bind(globalThis);

/** Test hook — restore after each suite. */
export function setMetamaskOnrampFetch(fn: FetchLike | undefined): void {
  fetchImpl = fn ?? globalThis.fetch.bind(globalThis);
}

const countriesCache = new Map<string, { expires: number; value: PayInCountry[] }>();
const lightCache = new Map<string, { expires: number; value: RegionLight }>();

export function clearMetamaskOnrampCaches(): void {
  countriesCache.clear();
  lightCache.clear();
}

export function defaultMetamaskEndpoints(): MetamaskOnrampEndpoints {
  return {
    ordersUrl: DEFAULT_METAMASK_ORDERS_URL,
    regionsUrl: DEFAULT_METAMASK_REGIONS_URL,
    geoUrl: DEFAULT_METAMASK_GEO_URL,
    buyOrigin: DEFAULT_METAMASK_BUY_ORIGIN,
    redirectUrl: DEFAULT_METAMASK_REDIRECT_URL,
  };
}

export function isPayInEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function normalizePayInRegion(raw: string): string {
  const trimmed = raw.trim().toLowerCase().replace(/^\/*regions\//, "");
  if (!trimmed) return "";
  return `/regions/${trimmed}`;
}

export function regionCodeFromId(regionId: string): string {
  return regionId.replace(/^\/regions\//, "");
}

export function fiatIdFromCode(fiat: string): string {
  return `/currencies/fiat/${fiat.trim().toLowerCase()}`;
}

export function fiatCodeFromId(fiatId: string): string {
  const m = fiatId.match(/\/currencies\/fiat\/([a-z0-9]+)$/i);
  return (m?.[1] ?? fiatId).toUpperCase();
}

export function providerCodeFromId(providerId: string): string {
  return providerId.replace(/^\/providers\//, "");
}

export function paymentCodeFromId(paymentId: string): string {
  return paymentId.replace(/^\/payments\//, "");
}

export function isPayInWidgetEmbeddable(providerId: string): boolean {
  return !NON_EMBEDDABLE_PROVIDERS.has(providerCodeFromId(providerId));
}

export function metamaskRequestHeaders(sdkVersion = METAMASK_SDK_VERSION): Record<string, string> {
  return {
    Accept: "application/json",
    "x-csi-context": METAMASK_SDK_CONTEXT,
    locale: "en-US",
    "on-ramp-sdk-version": sdkVersion,
  };
}

function withSdkQuery(url: URL, sdkVersion = METAMASK_SDK_VERSION): URL {
  url.searchParams.set("sdk", sdkVersion);
  url.searchParams.set("context", METAMASK_SDK_CONTEXT);
  return url;
}

async function metamaskGetJson(
  url: URL,
  timeoutMs = 20_000,
  sdkVersion = METAMASK_SDK_VERSION
): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(withSdkQuery(url, sdkVersion).toString(), {
      headers: metamaskRequestHeaders(sdkVersion),
      signal: ctrl.signal,
    });
    const text = await res.text();
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      const message =
        body && typeof body === "object" && "message" in body
          ? String((body as { message: unknown }).message)
          : `MetaMask onramp HTTP ${res.status}`;
      throw Object.assign(new Error(message), { statusCode: res.status >= 500 ? 502 : 400 });
    }
    return body;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw Object.assign(new Error("MetaMask onramp timed out"), { statusCode: 504 });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

interface RegionCountryRaw {
  id: string;
  name: string;
  emoji?: string;
  currencies?: string[];
  unsupported?: boolean;
  support?: { buy?: boolean; sell?: boolean };
  states?: Array<{
    id: string;
    name: string;
    emoji?: string;
    unsupported?: boolean;
    support?: { buy?: boolean };
  }>;
}

/** Replaced national currencies MetaMask still lists ahead of EUR. */
const OBSOLETE_FIAT_CODES = new Set([
  "LTL",
  "LVL",
  "EEK",
  "SKK",
  "SIT",
  "CYP",
  "MTL",
  "HRK",
  "DEM",
  "FRF",
  "ITL",
  "ESP",
  "NLG",
  "BEF",
  "ATS",
  "FIM",
  "IEP",
  "GRD",
  "PTE",
  "LUF",
]);

function fiatsFromCurrencies(currencies: string[] | undefined): string[] {
  const codes: string[] = [];
  const seen = new Set<string>();
  for (const c of currencies ?? []) {
    const code = fiatCodeFromId(c);
    if (!/^[A-Z]{3}$/.test(code) || seen.has(code)) continue;
    seen.add(code);
    codes.push(code);
  }
  const live = codes.filter((c) => !OBSOLETE_FIAT_CODES.has(c));
  if (live.length > 0) return live;
  return codes.length > 0 ? codes : ["USD"];
}

function countryBuyOk(row: { unsupported?: boolean; support?: { buy?: boolean } }): boolean {
  if (row.unsupported) return false;
  return Boolean(row.support?.buy);
}

export function mapCountries(raw: RegionCountryRaw[]): PayInCountry[] {
  const out: PayInCountry[] = [];
  for (const country of raw) {
    const fiats = fiatsFromCurrencies(country.currencies);
    const fiat = fiats[0] ?? "USD";
    const states = country.states?.filter(countryBuyOk) ?? [];
    if (states.length > 0) {
      for (const state of states) {
        out.push({
          id: regionCodeFromId(state.id),
          regionId: state.id,
          name: `${country.name} — ${state.name}`,
          defaultFiat: fiat,
          fiats,
          emoji: state.emoji ?? country.emoji,
        });
      }
      continue;
    }
    if (!countryBuyOk(country)) continue;
    if (!country.currencies?.length) continue;
    out.push({
      id: regionCodeFromId(country.id),
      regionId: country.id,
      name: country.name,
      defaultFiat: fiat,
      fiats,
      emoji: country.emoji,
    });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

const GEO_COUNTRY_HEADERS = [
  "cf-ipcountry",
  "x-vercel-ip-country",
  "cloudfront-viewer-country",
  "x-appengine-country",
] as const;

/** Country code from CDN/edge headers (user IP, not the API host). */
export function countryFromGeoHeaders(
  headers: Record<string, string | string[] | undefined>
): string {
  for (const key of GEO_COUNTRY_HEADERS) {
    const raw = headers[key];
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toUpperCase() ?? "";
    if (/^[A-Z]{2}$/.test(value) && value !== "XX" && value !== "T1") return value;
  }
  return "";
}

/** Match MetaMask geolocation text (`US-MI`, `LT`) to a country/state row. */
export function matchCountryFromGeo(geo: string, countries: PayInCountry[]): PayInCountry | undefined {
  const raw = geo.trim().toLowerCase().replace(/_/g, "-");
  if (!raw) return undefined;
  const exact = countries.find((c) => c.id === raw || c.regionId === `/regions/${raw}`);
  if (exact) return exact;
  const countryOnly = raw.split("-")[0] ?? "";
  if (!countryOnly) return undefined;
  return (
    countries.find((c) => c.id === countryOnly || c.regionId === `/regions/${countryOnly}`) ??
    countries.find((c) => c.id.startsWith(`${countryOnly}-`))
  );
}

export async function fetchPayInCountries(endpoints: MetamaskOnrampEndpoints): Promise<PayInCountry[]> {
  const key = endpoints.regionsUrl;
  const hit = countriesCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const url = new URL("/regions/countries", endpoints.regionsUrl.endsWith("/") ? endpoints.regionsUrl : `${endpoints.regionsUrl}/`);
  const body = await metamaskGetJson(url);
  if (!Array.isArray(body)) {
    throw Object.assign(new Error("Unexpected MetaMask countries payload"), { statusCode: 502 });
  }
  const value = mapCountries(body as RegionCountryRaw[]);
  countriesCache.set(key, { expires: Date.now() + COUNTRIES_CACHE_MS, value });
  return value;
}

interface RegionLightPayment {
  id: string;
  name?: string;
  paymentType?: string;
}

interface RegionLightFiat {
  id: string;
  symbol?: string;
}

interface RegionLight {
  payments: RegionLightPayment[];
  fiatCurrencies: RegionLightFiat[];
  limits?: { minAmount?: number; maxAmount?: number };
}

async function fetchRegionLight(
  endpoints: MetamaskOnrampEndpoints,
  regionId: string
): Promise<RegionLight> {
  const key = `${endpoints.regionsUrl}|${regionId}`;
  const hit = lightCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  const url = new URL(
    `${regionId.replace(/^\//, "")}/light`,
    endpoints.regionsUrl.endsWith("/") ? endpoints.regionsUrl : `${endpoints.regionsUrl}/`
  );
  url.searchParams.set("action", "buy");
  url.searchParams.set("multiplePayments", "true");
  const body = (await metamaskGetJson(url, 25_000)) as {
    payments?: RegionLightPayment[];
    fiatCurrencies?: RegionLightFiat[];
    limits?: RegionLight["limits"];
  };
  const value: RegionLight = {
    payments: Array.isArray(body.payments) ? body.payments : [],
    fiatCurrencies: Array.isArray(body.fiatCurrencies) ? body.fiatCurrencies : [],
    limits: body.limits,
  };
  lightCache.set(key, { expires: Date.now() + CACHE_MS, value });
  return value;
}

export function buildPortfolioBuyUrl(input: {
  buyOrigin: string;
  walletAddress: string;
  amount: string;
  fiat: string;
  regionId: string;
  paymentMethodId?: string;
  providerId?: string;
}): string {
  const origin = input.buyOrigin.replace(/\/$/, "");
  const url = new URL("/buy", `${origin}/`);
  url.searchParams.set("metamaskEntry", "tc_pay_in");
  url.searchParams.set("chainId", PAY_IN_CHAIN_ID);
  url.searchParams.set("address", PAY_IN_TOKEN_ADDRESS);
  url.searchParams.set("amount", input.amount);
  url.searchParams.set("walletAddress", input.walletAddress);
  url.searchParams.set("fiat", input.fiat.toLowerCase());
  url.searchParams.set("region", regionCodeFromId(input.regionId));
  if (input.paymentMethodId) url.searchParams.set("payment", paymentCodeFromId(input.paymentMethodId));
  if (input.providerId) url.searchParams.set("provider", providerCodeFromId(input.providerId));
  return url.toString();
}

export interface PayInWidgetResult {
  widgetUrl: string;
  orderId?: string;
  provider: string;
  embeddable: boolean;
}

export async function fetchPayInWidget(
  endpoints: MetamaskOnrampEndpoints,
  input: {
    region: string;
    fiat: string;
    amount: string;
    walletAddress: string;
    providerId: string;
    paymentMethodId?: string;
    redirectUrl?: string;
  }
): Promise<PayInWidgetResult> {
  const regionId = normalizePayInRegion(input.region);
  if (!regionId) throw Object.assign(new Error("region is required"), { statusCode: 400 });
  const fiat = input.fiat.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(fiat)) {
    throw Object.assign(new Error("fiat must be a 3-letter currency code"), { statusCode: 400 });
  }
  const amountNum = Number(input.amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw Object.assign(new Error("amount must be a positive number"), { statusCode: 400 });
  }
  if (!isPayInEvmAddress(input.walletAddress)) {
    throw Object.assign(new Error("walletAddress must be an EVM address"), { statusCode: 400 });
  }
  const providerId = input.providerId.startsWith("/")
    ? input.providerId
    : `/providers/${input.providerId.replace(/^providers\//, "")}`;
  if (!providerId.startsWith("/providers/") || providerId.length < 12) {
    throw Object.assign(new Error("providerId is required"), { statusCode: 400 });
  }
  const paymentMethodId = input.paymentMethodId?.trim() || "/payments/debit-credit-card";
  const redirectUrl = (input.redirectUrl || endpoints.redirectUrl || endpoints.buyOrigin || DEFAULT_METAMASK_REDIRECT_URL)
    .replace(/\/$/, "");
  const url = new URL(`${providerId}/buy-widget`, `${endpoints.ordersUrl.replace(/\/$/, "")}/`);
  url.searchParams.set("regionId", regionId);
  url.searchParams.set("paymentMethodId", paymentMethodId);
  url.searchParams.set("cryptoCurrencyId", PAY_IN_CRYPTO_ID);
  url.searchParams.set("fiatCurrencyId", fiatIdFromCode(fiat));
  url.searchParams.set("amount", String(amountNum));
  url.searchParams.set("walletAddress", input.walletAddress.trim());
  url.searchParams.set("redirectUrl", redirectUrl);
  const body = (await metamaskGetJson(url, 30_000, METAMASK_WIDGET_SDK_VERSION)) as {
    url?: string;
    orderId?: string;
  };
  const widgetUrl = typeof body?.url === "string" ? body.url.trim() : "";
  if (!widgetUrl || !/^https:\/\//i.test(widgetUrl)) {
    throw Object.assign(new Error("Provider checkout URL was not returned"), { statusCode: 502 });
  }
  return {
    widgetUrl,
    orderId: body.orderId,
    provider: providerCodeFromId(providerId),
    embeddable: isPayInWidgetEmbeddable(providerId),
  };
}

interface AggregatorQuoteSuccess {
  provider?: string;
  providerInfo?: { id?: string; name?: string };
  quote?: {
    amountIn?: number;
    amountOut?: number;
    exchangeRate?: number;
    networkFee?: number;
    providerFee?: number;
    extraFee?: number;
    paymentMethod?: string;
  };
}

function formatAmount(n: number, digits = 6): string {
  if (!Number.isFinite(n)) return "0";
  const s = n.toFixed(digits);
  return s.replace(/\.?0+$/, "") || "0";
}

export function mapAggregatorQuotes(
  payload: { success?: AggregatorQuoteSuccess[] },
  ctx: {
    buyOrigin: string;
    walletAddress: string;
    amount: string;
    fiat: string;
    regionId: string;
    paymentNames: Map<string, string>;
  }
): PayInQuoteRow[] {
  const rows: PayInQuoteRow[] = [];
  for (const item of payload.success ?? []) {
    const q = item.quote;
    if (!q) continue;
    const providerId = item.providerInfo?.id || item.provider || "";
    const paymentMethodId = q.paymentMethod || "/payments/debit-credit-card";
    const providerName = item.providerInfo?.name || providerCodeFromId(providerId) || "Provider";
    const paymentName =
      ctx.paymentNames.get(paymentMethodId) || paymentCodeFromId(paymentMethodId).replace(/-/g, " ");
    const fiatAmount = formatAmount(Number(q.amountIn ?? ctx.amount), 2);
    const cryptoAmount = formatAmount(Number(q.amountOut ?? 0), 6);
    rows.push({
      id: `${providerId}|${paymentMethodId}`,
      provider: providerName,
      providerId,
      paymentMethod: paymentCodeFromId(paymentMethodId),
      paymentMethodId,
      paymentMethodName: paymentName,
      fiatAmount,
      cryptoAmount,
      exchangeRate: q.exchangeRate,
      fees: {
        networkFee: Number(q.networkFee ?? 0),
        providerFee: Number(q.providerFee ?? 0),
        extraFee: Number(q.extraFee ?? 0),
      },
      embeddable: isPayInWidgetEmbeddable(providerId),
    });
  }
  rows.sort((a, b) => Number(b.cryptoAmount) - Number(a.cryptoAmount));
  return rows;
}

export async function fetchPayInQuotes(
  endpoints: MetamaskOnrampEndpoints,
  input: { region: string; fiat: string; amount: string; walletAddress: string }
): Promise<PayInQuotesResult> {
  const regionId = normalizePayInRegion(input.region);
  if (!regionId) {
    throw Object.assign(new Error("region is required"), { statusCode: 400 });
  }
  const fiat = input.fiat.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(fiat)) {
    throw Object.assign(new Error("fiat must be a 3-letter currency code"), { statusCode: 400 });
  }
  const amount = input.amount.trim();
  const amountNum = Number(amount);
  if (!Number.isFinite(amountNum) || amountNum <= 0) {
    throw Object.assign(new Error("amount must be a positive number"), { statusCode: 400 });
  }
  if (!isPayInEvmAddress(input.walletAddress)) {
    throw Object.assign(new Error("walletAddress must be an EVM address"), { statusCode: 400 });
  }
  const walletAddress = input.walletAddress.trim();

  const light = await fetchRegionLight(endpoints, regionId);
  const paymentNames = new Map(light.payments.map((p) => [p.id, p.name || paymentCodeFromId(p.id)]));
  const quoteUrl = new URL("/providers/all/quote", `${endpoints.ordersUrl.replace(/\/$/, "")}/`);
  quoteUrl.searchParams.set("regionId", regionId);
  quoteUrl.searchParams.set("cryptoCurrencyId", PAY_IN_CRYPTO_ID);
  quoteUrl.searchParams.set("fiatCurrencyId", fiatIdFromCode(fiat));
  quoteUrl.searchParams.set("amount", String(amountNum));
  quoteUrl.searchParams.set("walletAddress", walletAddress);
  const methods = light.payments.length > 0 ? light.payments : [{ id: "/payments/debit-credit-card", name: "Card" }];
  methods.forEach((p, i) => quoteUrl.searchParams.set(`paymentMethodId[${i}]`, p.id));

  const body = (await metamaskGetJson(quoteUrl, 30_000)) as { success?: AggregatorQuoteSuccess[] };
  const quotes = mapAggregatorQuotes(body, {
    buyOrigin: endpoints.buyOrigin,
    walletAddress,
    amount: String(amountNum),
    fiat,
    regionId,
    paymentNames,
  });
  if (quotes.length === 0) {
    throw Object.assign(new Error("No buy quotes available for this amount and region"), {
      statusCode: 404,
      code: "pay_in_quote_unavailable",
    });
  }
  return {
    region: regionCodeFromId(regionId),
    regionId,
    fiat,
    amount: String(amountNum),
    chainId: PAY_IN_CHAIN_ID,
    token: PAY_IN_TOKEN,
    tokenAddress: PAY_IN_TOKEN_ADDRESS,
    quotes,
  };
}

export function payInConfigPayload(endpoints: MetamaskOnrampEndpoints, enabled: boolean) {
  return {
    enabled,
    chainId: PAY_IN_CHAIN_ID,
    token: PAY_IN_TOKEN,
    tokenAddress: PAY_IN_TOKEN_ADDRESS,
    networkLabel: PAY_IN_NETWORK_LABEL,
    defaultAmount: PAY_IN_DEFAULT_AMOUNT,
    geoUrl: endpoints.geoUrl,
    buyOrigin: endpoints.buyOrigin,
  };
}
