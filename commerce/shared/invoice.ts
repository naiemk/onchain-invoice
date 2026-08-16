import { getAddress } from "ethers";
import {
  getCommerceInvoiceId,
  looksLikeTronAddress,
  normalizeMerchantAddress,
  type CommerceInvoiceParams,
} from "onchain-invoice";
import type { PayLinkFields } from "./types.js";

const DEFAULT_CHAIN = "11155111";
const DEFAULT_TOKEN = "USDC";

export function decodePayLink(input: string | URLSearchParams | Record<string, unknown>): PayLinkFields {
  const params =
    typeof input === "string"
      ? new URLSearchParams(input.startsWith("?") ? input.slice(1) : input)
      : input instanceof URLSearchParams
        ? input
        : objectToSearchParams(input);

  const to = splitList(params.get("to")).map((value) => {
    try {
      return normalizeMerchantAddress(value);
    } catch {
      try {
        return getAddress(value);
      } catch {
        return value;
      }
    }
  });

  const seed = optionalParam(params, "invoice_seed");
  return {
    price: requiredParam(params, "price"),
    to,
    chains: splitList(params.get("chains") ?? DEFAULT_CHAIN),
    tokens: splitList(params.get("tokens") ?? DEFAULT_TOKEN).map((t) => t.toUpperCase()),
    // Seed is never part of a shareable pay link; tolerate legacy links only for decode.
    ...(seed ? { invoiceSeed: seed } : {}),
    clientInvoiceId: optionalParam(params, "client_invoice_id"),
    callback: optionalParam(params, "callback"),
    title: optionalParam(params, "title"),
    description: optionalParam(params, "description"),
    allowPartial: parseBoolean(params.get("allow_partial")),
  };
}

/** Shareable checkout query string — never includes invoice_seed or invoice id. */
export function encodePayLink(fields: PayLinkFields): string {
  const params = new URLSearchParams();
  params.set("price", fields.price);
  params.set("to", fields.to.join(","));
  params.set("chains", fields.chains.join(","));
  params.set("tokens", fields.tokens.join(","));
  if (fields.clientInvoiceId) params.set("client_invoice_id", fields.clientInvoiceId);
  if (fields.callback) params.set("callback", fields.callback);
  if (fields.title) params.set("title", fields.title);
  if (fields.description) params.set("description", fields.description);
  params.set("allow_partial", fields.allowPartial ? "1" : "0");
  return params.toString();
}

/** Resume link for an already-created invoice. */
export function encodeInvoiceResumeLink(invoiceId: string): string {
  const params = new URLSearchParams();
  params.set("id", invoiceId);
  return params.toString();
}

export function payPath(fields: PayLinkFields): string {
  return `/pay?${encodePayLink(fields)}`;
}

export function commerceParamsFromPayLink(fields: PayLinkFields): CommerceInvoiceParams {
  if (!fields.invoiceSeed) {
    throw new Error("invoiceSeed is required to derive the commerce invoice id");
  }
  return {
    invoiceSeed: fields.invoiceSeed,
    toAddresses: fields.to,
    clientInvoiceId: fields.clientInvoiceId,
    priceUsd: fields.price,
    callbackUrl: fields.callback,
    title: fields.title,
    description: fields.description,
    allowPartial: fields.allowPartial,
    chains: fields.chains,
    tokens: fields.tokens,
  };
}

export function invoiceIdFromPayLink(fields: PayLinkFields): string {
  return getCommerceInvoiceId(commerceParamsFromPayLink(fields));
}

export function normalizePayLinkFields(input: Partial<PayLinkFields> & Record<string, unknown>): PayLinkFields {
  return decodePayLink({
    price: input.price,
    to: Array.isArray(input.to) ? input.to.join(",") : input.to,
    chains: Array.isArray(input.chains) ? input.chains.join(",") : input.chains,
    tokens: Array.isArray(input.tokens) ? input.tokens.join(",") : input.tokens,
    client_invoice_id: input.clientInvoiceId ?? input.client_invoice_id,
    callback: input.callback,
    title: input.title,
    description: input.description,
    allow_partial: input.allowPartial ?? input.allow_partial,
  });
}

export { looksLikeTronAddress };

function objectToSearchParams(input: Record<string, unknown>): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null) continue;
    params.set(key, Array.isArray(value) ? value.join(",") : String(value));
  }
  return params;
}

function splitList(value: string | null): string[] {
  return (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function requiredParam(params: URLSearchParams, name: string): string {
  const value = params.get(name)?.trim();
  if (!value) {
    throw new Error(`Missing pay-link parameter: ${name}`);
  }
  return value;
}

function optionalParam(params: URLSearchParams, name: string): string | undefined {
  const value = params.get(name)?.trim();
  return value || undefined;
}

function parseBoolean(value: string | null): boolean {
  if (!value) return false;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}
