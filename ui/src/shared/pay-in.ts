import { apiUrl } from "./site.js";
import {
  isPayInEvmAddress,
  matchCountryFromGeo,
  type PayInCountry,
  type PayInQuoteRow,
  type PayInQuotesResult,
} from "../../../commerce/shared/metamask-onramp.js";

export { isPayInEvmAddress, matchCountryFromGeo };
export type { PayInCountry, PayInQuoteRow, PayInQuotesResult };

export interface PayInConfig {
  enabled: boolean;
  chainId: string;
  token: string;
  tokenAddress: string;
  networkLabel: string;
  defaultAmount: string;
  geoUrl: string;
  buyOrigin: string;
}

export interface PayInWidgetSession {
  widgetUrl: string;
  orderId?: string | null;
  provider: string;
  embeddable: boolean;
}

async function readApiError(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    /* ignore */
  }
  return res.statusText || `HTTP ${res.status}`;
}

export async function fetchPayInConfig(): Promise<PayInConfig> {
  const res = await fetch(apiUrl("/api/public/pay-in/config"));
  if (!res.ok) throw new Error(await readApiError(res));
  return (await res.json()) as PayInConfig;
}

export async function fetchPayInCountries(): Promise<PayInCountry[]> {
  const res = await fetch(apiUrl("/api/public/pay-in/countries"));
  if (!res.ok) throw new Error(await readApiError(res));
  const body = (await res.json()) as { countries?: PayInCountry[] };
  return Array.isArray(body.countries) ? body.countries : [];
}

export async function fetchPayInQuotes(input: {
  region: string;
  fiat: string;
  amount: string;
  address: string;
}): Promise<PayInQuotesResult> {
  const params = new URLSearchParams({
    region: input.region,
    fiat: input.fiat,
    amount: input.amount,
    address: input.address,
  });
  const res = await fetch(apiUrl(`/api/public/pay-in/quotes?${params.toString()}`));
  if (!res.ok) throw new Error(await readApiError(res));
  return (await res.json()) as PayInQuotesResult;
}

export async function fetchPayInWidget(input: {
  region: string;
  fiat: string;
  amount: string;
  address: string;
  providerId: string;
  paymentMethodId?: string;
}): Promise<PayInWidgetSession> {
  const params = new URLSearchParams({
    region: input.region,
    fiat: input.fiat,
    amount: input.amount,
    address: input.address,
    providerId: input.providerId,
  });
  if (input.paymentMethodId) params.set("paymentMethodId", input.paymentMethodId);
  const res = await fetch(apiUrl(`/api/public/pay-in/widget?${params.toString()}`));
  if (!res.ok) throw new Error(await readApiError(res));
  return (await res.json()) as PayInWidgetSession;
}

/**
 * Country from the payer's IP. MetaMask `/geolocation` is not usable in the browser
 * (`cross-origin-resource-policy: same-origin`). Cloudflare trace sees the client IP;
 * the API fallback uses CDN country headers (`CF-IPCountry`, etc.).
 */
export async function fetchPayInGeo(): Promise<string> {
  const fromCf = await fetchCloudflareTraceCountry();
  if (fromCf) return fromCf;
  try {
    const res = await fetch(apiUrl("/api/public/pay-in/geo"));
    if (!res.ok) return "";
    const body = (await res.json()) as { country?: string };
    return typeof body.country === "string" ? body.country.trim() : "";
  } catch {
    return "";
  }
}

export function countryFromCloudflareTrace(text: string): string {
  const match = text.match(/(?:^|\n)loc=([A-Za-z]{2})(?:\n|$)/);
  const code = match?.[1]?.toUpperCase() ?? "";
  if (/^[A-Z]{2}$/.test(code) && code !== "XX" && code !== "T1") return code;
  return "";
}

async function fetchCloudflareTraceCountry(): Promise<string> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5_000);
  try {
    const res = await fetch("https://www.cloudflare.com/cdn-cgi/trace", {
      headers: { Accept: "text/plain" },
      signal: ctrl.signal,
    });
    if (!res.ok) return "";
    return countryFromCloudflareTrace(await res.text());
  } catch {
    return "";
  } finally {
    clearTimeout(timer);
  }
}

export const PAY_IN_IFRAME_ALLOW =
  "accelerometer; autoplay; camera; gyroscope; payment; microphone; clipboard-write; fullscreen";
