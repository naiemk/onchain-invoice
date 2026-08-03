import { getAddress } from "ethers";
import { PublicKey } from "@solana/web3.js";
import { utils as tronUtils } from "tronweb";

export type ChainKind = "evm" | "tron" | "solana";

/** Nile full-node chain id used in EOA key derivation (`BigInt`-safe). */
export const TRON_NILE_NUMERIC_CHAIN_ID = "3448148188";
/** Shasta full-node chain id (reserved). */
export const TRON_SHASTA_NUMERIC_CHAIN_ID = "2494104990";

const TRON_BASE58_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
/** Solana base58 pubkeys are typically 32–44 chars; exclude Tron `T…` and EVM `0x`. */
const SOLANA_BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function chainKind(chainId: string | null | undefined): ChainKind {
  const id = String(chainId ?? "");
  if (
    id === "nile" ||
    id === "shasta" ||
    id === "tron" ||
    id === TRON_NILE_NUMERIC_CHAIN_ID ||
    id === TRON_SHASTA_NUMERIC_CHAIN_ID
  ) {
    return "tron";
  }
  if (id === "devnet" || id === "mainnet-beta" || id === "solana" || id === "solana-devnet") {
    return "solana";
  }
  return "evm";
}

/** Map product chain ids (`nile`) to numeric ids for `deriveTronInvoice*`. */
export function tronNumericChainId(chainId: string | bigint): string | bigint {
  const id = String(chainId);
  if (id === "nile") return TRON_NILE_NUMERIC_CHAIN_ID;
  if (id === "shasta") return TRON_SHASTA_NUMERIC_CHAIN_ID;
  return chainId;
}

/** Lightweight shape check (no checksum) — safe for browser bundles. */
export function looksLikeTronAddress(value: string): boolean {
  return TRON_BASE58_RE.test(value.trim());
}

export function looksLikeSolanaAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!SOLANA_BASE58_RE.test(trimmed)) return false;
  if (trimmed.startsWith("T") && trimmed.length === 34) return false;
  try {
    new PublicKey(trimmed);
    return true;
  } catch {
    return false;
  }
}

export function isTronAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!looksLikeTronAddress(trimmed)) return false;
  try {
    return Boolean(tronUtils.address.isAddress(trimmed));
  } catch {
    return false;
  }
}

export function isSolanaAddress(value: string): boolean {
  return looksLikeSolanaAddress(value);
}

export function isEvmAddress(value: string): boolean {
  try {
    getAddress(value.trim());
    return true;
  } catch {
    return false;
  }
}

export function normalizeMerchantAddress(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Merchant address is required");
  if (trimmed.startsWith("0x") || trimmed.startsWith("0X")) {
    return getAddress(trimmed);
  }
  if (looksLikeTronAddress(trimmed)) {
    if (!isTronAddress(trimmed)) {
      throw new Error(`Invalid Tron merchant address: ${value}`);
    }
    return trimmed;
  }
  if (looksLikeSolanaAddress(trimmed)) {
    return new PublicKey(trimmed).toBase58();
  }
  throw new Error(`Invalid merchant address: ${value}`);
}

export function normalizeMerchantAddresses(values: string[]): string[] {
  return values.map((value) => normalizeMerchantAddress(value));
}

export function addressesEqual(a: string, b: string): boolean {
  try {
    if (a.startsWith("0x") || b.startsWith("0x")) {
      return getAddress(a) === getAddress(b);
    }
  } catch {
    /* fall through */
  }
  try {
    if (looksLikeSolanaAddress(a) && looksLikeSolanaAddress(b)) {
      return new PublicKey(a).equals(new PublicKey(b));
    }
  } catch {
    /* fall through */
  }
  return a.trim() === b.trim();
}

export function tokenAllowedOnChain(chainId: string, token: string): boolean {
  const symbol = token.trim().toUpperCase();
  const kind = chainKind(chainId);
  if (kind === "tron") {
    return symbol === "USDT";
  }
  if (kind === "solana") {
    return symbol === "USDC" || symbol === "USDT";
  }
  // EVM commerce launch: USDC only
  return symbol === "USDC";
}

export function defaultTokenForChain(chainId: string): string {
  const kind = chainKind(chainId);
  if (kind === "tron") return "USDT";
  return "USDC";
}
