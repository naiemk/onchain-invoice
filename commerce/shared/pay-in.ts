/**
 * Provider-neutral fiat pay-in (card/bank → USDC on Base) types and constants.
 * No on-ramp provider is wired in yet; fiat invoice modes stay off unless PAY_IN_ENABLED=1.
 */

export const PAY_IN_CHAIN_ID = "8453";
export const PAY_IN_TOKEN = "USDC";
export const PAY_IN_TOKEN_ADDRESS = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
export const PAY_IN_NETWORK_LABEL = "Base";
export const PAY_IN_DEFAULT_AMOUNT = "100";

export function isPayInSettlement(chainId: string, token: string): boolean {
  return String(chainId) === PAY_IN_CHAIN_ID && token.trim().toUpperCase() === PAY_IN_TOKEN;
}

export function isPayInEvmAddress(value: string): boolean {
  return /^0x[a-fA-F0-9]{40}$/.test(value.trim());
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

export function payInConfigPayload(enabled: boolean) {
  return {
    enabled,
    chainId: PAY_IN_CHAIN_ID,
    token: PAY_IN_TOKEN,
    tokenAddress: PAY_IN_TOKEN_ADDRESS,
    networkLabel: PAY_IN_NETWORK_LABEL,
    defaultAmount: PAY_IN_DEFAULT_AMOUNT,
  };
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

/** Match a geolocation string (`US-MI`, `LT`) to a country/state row. */
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
