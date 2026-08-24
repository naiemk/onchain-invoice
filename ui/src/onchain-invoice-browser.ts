import { AbiCoder, getAddress, getBytes, hexlify, keccak256, randomBytes, type BytesLike } from "ethers";

export interface CommerceInvoiceParams {
  invoiceSeed: BytesLike;
  toAddresses: string[];
  clientInvoiceId?: string;
  priceUsd?: string;
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
  const trimmed = value
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00A0\s]/g, "")
    .replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0))
    .replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660));
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

export function randomInvoiceSeed(): string {
  return hexlify(randomBytes(32));
}

export function normalizeInvoiceSeed(seed: BytesLike): string {
  const hex = hexlify(seed);
  if (getBytes(hex).length !== 32) {
    throw new Error(`invoiceSeed must be 32 bytes, got ${getBytes(hex).length}`);
  }
  return hexlify(getBytes(hex));
}

/**
 * Invoice id = keccak256(abi.encode(bytes32 invoiceSeed, string[] toAddresses)).
 */
export function getCommerceInvoiceId(
  params: Pick<CommerceInvoiceParams, "invoiceSeed" | "toAddresses"> | BytesLike
): string {
  if (typeof params === "string" || params instanceof Uint8Array) {
    return keccak256(params);
  }
  const encoded = AbiCoder.defaultAbiCoder().encode(
    ["bytes32", "string[]"],
    [normalizeInvoiceSeed(params.invoiceSeed), params.toAddresses.map(normalizeMerchantAddress)]
  );
  return keccak256(encoded);
}
