import { AbiCoder, getAddress, keccak256, type BytesLike } from "ethers";

export interface CommerceInvoiceParams {
  priceUsd: string;
  toAddresses: string[];
  clientInvoiceId: string;
  callbackUrl?: string;
  title?: string;
  description?: string;
  allowPartial?: boolean;
  chains?: string[];
  tokens?: string[];
}

const TRON_BASE58_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const SOLANA_BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

function normalizeMerchantAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Merchant address is required");
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return getAddress(trimmed);
  }
  if (TRON_BASE58_RE.test(trimmed)) return trimmed;
  if (SOLANA_BASE58_RE.test(trimmed) && !(trimmed.startsWith("T") && trimmed.length === 34)) {
    return trimmed;
  }
  throw new Error(`Invalid merchant address: ${value}`);
}

/**
 * Deterministic invoice id. Merchant destinations are `string[]` so Tron `T…` works
 * (testnet-breaking vs older `address[]` encoding).
 */
export function getCommerceInvoiceId(params: CommerceInvoiceParams | BytesLike): string {
  if (typeof params === "string" || params instanceof Uint8Array) {
    return keccak256(params);
  }
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["string", "string[]", "string", "string", "string", "string", "bool"],
    [
      params.priceUsd,
      params.toAddresses.map(normalizeMerchantAddress),
      params.clientInvoiceId,
      params.callbackUrl ?? "",
      params.title ?? "",
      params.description ?? "",
      params.allowPartial ?? false,
    ]
  );
  return keccak256(encoded);
}
