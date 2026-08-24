import { getAddress, sha256, getBytes } from "ethers";
import { localizedNetworkLabel, localizedNetworkShort } from "../i18n/networks.js";
import { t } from "../i18n/t.js";

export type ChainKind = "evm" | "tron" | "solana";

export interface NetworkOption {
  id: string;
  label: string;
  kind: ChainKind;
  short: string;
  testnet?: boolean;
  /** When false, keep the entry for explorers/labels but hide from create/home pickers. */
  enabled?: boolean;
}

export interface TokenOption {
  id: string;
  label: string;
}

export const NETWORKS: NetworkOption[] = [
  { id: "11155111", label: "Ethereum Sepolia", short: "Sepolia", kind: "evm", testnet: true },
  { id: "nile", label: "TRON Nile", short: "Nile", kind: "tron", testnet: true },
  // Kept for explorer/label helpers; re-enable when Solana settle ships in the UI.
  { id: "devnet", label: "Solana Devnet", short: "Sol Devnet", kind: "solana", testnet: true, enabled: false },
  // Mainnet rails: Tron + Base + BNB + Ethereum USDC.
  { id: "tron", label: "TRON", short: "TRON", kind: "tron" },
  { id: "8453", label: "Base", short: "Base", kind: "evm" },
  { id: "56", label: "BNB Smart Chain", short: "BNB", kind: "evm" },
  { id: "1", label: "Ethereum Mainnet", short: "Ethereum", kind: "evm" },
  { id: "42161", label: "Arbitrum One", short: "Arbitrum", kind: "evm", enabled: false },
  { id: "mainnet-beta", label: "Solana", short: "Solana", kind: "solana", enabled: false },
];

export const TOKENS: TokenOption[] = [
  { id: "USDC", label: "USDC" },
  { id: "USDT", label: "USDT" },
];

/** Stablecoins only until FX/conversion is implemented (USD price ≠ ETH amount). */
export const SUPPORTED_TOKENS = new Set(TOKENS.map((t) => t.id.toUpperCase()));

const TRON_BASE58_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const SOLANA_BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Strip bidi/ZW chars and map Persian/Arabic-Indic digits → Latin (mobile FA paste). */
export function sanitizeAddressInput(value: string): string {
  let out = value.normalize("NFKC");
  out = out.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\u00A0\s]/g, "");
  out = out.replace(/[\u06F0-\u06F9]/g, (ch) => String(ch.charCodeAt(0) - 0x06f0));
  out = out.replace(/[\u0660-\u0669]/g, (ch) => String(ch.charCodeAt(0) - 0x0660));
  return out;
}

function decodeBase58(input: string): Uint8Array {
  const bytes = [0];
  for (const char of input) {
    const value = BASE58_ALPHABET.indexOf(char);
    if (value < 0) throw new Error("Invalid base58 character");
    let carry = value;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i]! * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const char of input) {
    if (char !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

/** Valid EVM address (any casing); returns true if getAddress accepts it. */
export function isChecksummedEvmAddress(value: string): boolean {
  const trimmed = sanitizeAddressInput(value);
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return false;
  try {
    getAddress(trimmed);
    return true;
  } catch {
    return false;
  }
}

/** Tron base58check (version 0x41) — rejects lookalike strings with a bad checksum. */
export function isChecksummedTronAddress(value: string): boolean {
  const trimmed = sanitizeAddressInput(value);
  if (!TRON_BASE58_RE.test(trimmed)) return false;
  try {
    const decoded = decodeBase58(trimmed);
    if (decoded.length !== 25 || decoded[0] !== 0x41) return false;
    const payload = decoded.slice(0, 21);
    const checksum = decoded.slice(21);
    const hash = getBytes(sha256(sha256(payload)));
    return (
      checksum[0] === hash[0] &&
      checksum[1] === hash[1] &&
      checksum[2] === hash[2] &&
      checksum[3] === hash[3]
    );
  } catch {
    return false;
  }
}

export function looksLikeTronAddress(value: string): boolean {
  return TRON_BASE58_RE.test(sanitizeAddressInput(value));
}

export function looksLikeSolanaAddress(value: string): boolean {
  const trimmed = sanitizeAddressInput(value);
  if (!SOLANA_BASE58_RE.test(trimmed)) return false;
  if (trimmed.startsWith("T") && trimmed.length === 34) return false;
  try {
    const decoded = decodeBase58(trimmed);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

export function isValidAddress(value: string, kind: ChainKind): boolean {
  const trimmed = value.trim();
  if (!trimmed) return false;
  if (kind === "tron") return isChecksummedTronAddress(trimmed);
  if (kind === "solana") return looksLikeSolanaAddress(trimmed);
  return isChecksummedEvmAddress(trimmed);
}

export function normalizeAddress(value: string, kind: ChainKind): string {
  const trimmed = sanitizeAddressInput(value);
  if (!trimmed) throw new Error("Address is required");
  if (kind === "tron") {
    if (!isChecksummedTronAddress(trimmed)) {
      throw new Error("Tron address must be a valid base58check T… address");
    }
    return trimmed;
  }
  if (kind === "solana") {
    if (!looksLikeSolanaAddress(trimmed)) throw new Error(`Invalid Solana address: ${value}`);
    return trimmed;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) {
    throw new Error("EVM address must be a 0x-prefixed 40-hex-character address");
  }
  try {
    // Accept lowercase / mixed paste (common on mobile) and normalize to EIP-55.
    return getAddress(trimmed);
  } catch {
    throw new Error("Invalid EVM address checksum");
  }
}

export function filterSupportedTokens(tokens: string[]): string[] {
  const allowed = tokens
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => SUPPORTED_TOKENS.has(t.toUpperCase()))
    .map((t) => t.toUpperCase());
  return allowed.length > 0 ? [...new Set(allowed)] : ["USDC"];
}

export function networkById(chainId: string | null | undefined): NetworkOption | undefined {
  return NETWORKS.find((n) => n.id === String(chainId ?? ""));
}

export function networkKind(chainId: string | null | undefined): ChainKind {
  return networkById(chainId)?.kind ?? "evm";
}

export function tokenAllowedOnChain(chainId: string, token: string): boolean {
  const symbol = token.trim().toUpperCase();
  const id = String(chainId);
  const kind = networkKind(chainId);
  if (kind === "tron") return symbol === "USDT";
  // Devnet USDT mint is still a PLACEHOLDER in operator templates — offer USDC only in UI.
  if (kind === "solana") return symbol === "USDC";
  // Base: USDC only
  if (id === "8453") return symbol === "USDC";
  // Ethereum mainnet: USDC only (Onramper + settlement)
  if (id === "1") return symbol === "USDC";
  // BNB Smart Chain: USDC + USDT
  if (id === "56") return symbol === "USDC" || symbol === "USDT";
  // Other EVM (Sepolia): USDC and USDT when the sweeper lists a contract.
  return symbol === "USDC" || symbol === "USDT";
}

export function tokensForChains(chainIds: string[]): TokenOption[] {
  if (chainIds.length === 0) return [];
  return TOKENS.filter((token) => chainIds.some((id) => tokenAllowedOnChain(id, token.id)));
}

export function networkLabel(chainId: string): string {
  return localizedNetworkLabel(chainId);
}

export function networkShort(chainId: string): string {
  return localizedNetworkShort(chainId);
}

export function isTestnet(chainId: string | null | undefined): boolean {
  if (!chainId) return false;
  const known = NETWORKS.find((n) => n.id === chainId);
  if (known) return Boolean(known.testnet);
  return ["11155111", "84532", "421614", "11155420", "5", "80001", "nile", "shasta", "devnet"].includes(
    String(chainId)
  );
}

/** Solana explorer cluster query — derived from testnet flag, not hardcoded chain names in callers. */
export function solanaExplorerCluster(chainId: string | null | undefined): string {
  return isTestnet(chainId) ? "?cluster=devnet" : "";
}

export type DeploymentMode = "testnet" | "mainnet";

/** Which product surface this UI build is serving (hostname or VITE_DEPLOYMENT_MODE). */
export function deploymentMode(): DeploymentMode {
  const fromEnv = (import.meta.env.VITE_DEPLOYMENT_MODE as string | undefined)?.toLowerCase();
  if (fromEnv === "testnet" || fromEnv === "mainnet") return fromEnv;
  if (typeof location === "undefined") return "testnet";
  const host = location.hostname.toLowerCase();
  if (
    host.startsWith("testnet.") ||
    host === "localhost" ||
    host === "127.0.0.1" ||
    host.endsWith(".local")
  ) {
    return "testnet";
  }
  return "mainnet";
}

/** Networks allowed on the create form for this deployment. */
export function networksForDeployment(mode: DeploymentMode = deploymentMode()): NetworkOption[] {
  const wantTestnet = mode === "testnet";
  return NETWORKS.filter((n) => Boolean(n.testnet) === wantTestnet && n.enabled !== false);
}

export function testnetPillHtml(chainId: string | null | undefined): string {
  if (!isTestnet(chainId)) return "";
  return `<span class="testnet-pill" role="status">${escapeText(t("networks.testnetPill"))}</span>`;
}

/** Inline SVG chain mark (safe HTML fragment). */
export function chainLogoSvg(chainId: string | null | undefined, size = 20): string {
  const id = String(chainId ?? "");
  const s = String(size);
  if (id === "nile" || id === "shasta" || id === "tron") {
    return `<svg class="chain-logo" width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#FF060A"/><path d="M21.6 9.2 16 6.4l-5.6 2.8 1.7 5.4h7.8l1.7-5.4zm-9.2 6.8 3.6 9.6 5.6-5.4-1.6-4.2h-7.6zm8.4 0-1.6 4.2 5.6 5.4 3.6-9.6h-7.6z" fill="#fff"/></svg>`;
  }
  if (id === "devnet" || id === "mainnet-beta" || id === "solana") {
    const gid = `solGrad-${s}-${Math.random().toString(36).slice(2, 8)}`;
    return `<svg class="chain-logo" width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#000"/><path d="M9.5 20.2c.2-.2.4-.3.7-.3h12.1c.4 0 .6.5.3.8l-2.1 2.1c-.2.2-.4.3-.7.3H7.7c-.4 0-.6-.5-.3-.8l2.1-2.1zm0-10.9c.2-.2.4-.3.7-.3h12.1c.4 0 .6.5.3.8l-2.1 2.1c-.2.2-.4.3-.7.3H7.7c-.4 0-.6-.5-.3-.8l2.1-2.1zm13.1 5.1c-.2-.2-.4-.3-.7-.3H9.8c-.4 0-.6.5-.3.8l2.1 2.1c.2.2.4.3.7.3h12.1c.4 0 .6-.5.3-.8l-2.1-2.1z" fill="url(#${gid})"/><defs><linearGradient id="${gid}" x1="8" y1="8" x2="24" y2="24"><stop stop-color="#00FFA3"/><stop offset="1" stop-color="#DC1FFF"/></linearGradient></defs></svg>`;
  }
  if (id === "8453") {
    return `<svg class="chain-logo" width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#0052FF"/><path d="M16.1 6.4c-5.3 0-9.6 4.1-9.9 9.3h13.1c.4 0 .7.3.7.7s-.3.7-.7.7H6.2c.4 5.1 4.7 9.1 9.9 9.1 5.5 0 10-4.5 10-10s-4.5-9.8-10-9.8z" fill="#fff"/></svg>`;
  }
  if (id === "56") {
    return `<svg class="chain-logo" width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#F0B90B"/><path d="M16 7.2 12.4 10.8l3.6 3.6 3.6-3.6L16 7.2zm-7.2 7.2L5.2 18l3.6 3.6L12.4 18l-3.6-3.6zm14.4 0L19.6 18l3.6 3.6L26.8 18l-3.6-3.6zM16 17.6l-3.6 3.6L16 24.8l3.6-3.6L16 17.6z" fill="#fff"/></svg>`;
  }
  if (id === "42161") {
    return `<svg class="chain-logo" width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#213147"/><path d="M10.2 22.8 16 7.2l5.8 15.6h-3.1l-1.3-3.6h-2.8l-1.3 3.6h-3.1zm5.8-10.4-1.2 3.4h2.4l-1.2-3.4z" fill="#28A0F0"/><path d="m21.4 22.8 2.4-6.4H9.8l1.2 3.2h8.2l.8 2.1 1.4 1.1z" fill="#96BEDC"/></svg>`;
  }
  // Ethereum + Sepolia
  return `<svg class="chain-logo" width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#627EEA"/><path d="M16.1 5v8.1l6.9 3.1L16.1 5z" fill="#fff" fill-opacity=".6"/><path d="M16.1 5 9.2 16.2l6.9-3.1V5z" fill="#fff"/><path d="M16.1 21.7v5.3l6.9-9.6-6.9 4.3z" fill="#fff" fill-opacity=".6"/><path d="M16.1 27v-5.3l-6.9-4.3L16.1 27z" fill="#fff"/><path d="m16.1 20.5 6.9-4.3-6.9-3.1v7.4z" fill="#fff" fill-opacity=".2"/><path d="m9.2 16.2 6.9 4.3v-7.4l-6.9 3.1z" fill="#fff" fill-opacity=".6"/></svg>`;
}

export function chainChipHtml(
  chainId: string | null | undefined,
  opts: { size?: "sm" | "md" | "lg"; short?: boolean } = {}
): string {
  if (!chainId) return `<span class="chain-chip chain-chip-empty">—</span>`;
  const size = opts.size ?? "md";
  const logoPx = size === "lg" ? 36 : size === "sm" ? 16 : 20;
  const label = opts.short ? networkShort(chainId) : networkLabel(chainId);
  return `<span class="chain-chip chain-chip-${size}">${chainLogoSvg(chainId, logoPx)}<span class="chain-chip-label">${escapeText(label)}</span></span>`;
}

export function tokenChipHtml(token: string | null | undefined, opts: { size?: "sm" | "md" | "lg" } = {}): string {
  const size = opts.size ?? "md";
  const symbol = (token ?? "—").toUpperCase();
  const logoPx = size === "lg" ? 28 : size === "sm" ? 16 : 20;
  return `<span class="token-chip token-chip-${size}">${tokenLogoSvg(symbol, logoPx)}<span class="token-chip-label">${escapeText(symbol)}</span></span>`;
}

/** Inline SVG token mark (safe HTML fragment). */
export function tokenLogoSvg(token: string | null | undefined, size = 20): string {
  const symbol = String(token ?? "").toUpperCase();
  const s = String(size);
  if (symbol === "USDC") {
    return `<svg class="token-logo" width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#2775CA"/><path fill="#fff" d="M20.7 18.3c0-1.9-1.1-2.7-3.4-3l-2.5-.4c-.8-.1-1.3-.4-1.3-1.1s.6-1.1 1.7-1.1c1 0 1.7.3 2.1.9l1.8-1.1c-.7-1-1.9-1.6-3.5-1.7v-1.6h-1.6v1.6c-2 .3-3.3 1.5-3.3 3.2 0 1.9 1.1 2.7 3.4 3l2.5.4c.9.1 1.3.5 1.3 1.2s-.7 1.2-1.9 1.2c-1.2 0-2-.5-2.5-1.2l-1.9 1.1c.7 1.2 2.1 1.9 3.9 2.1v1.6h1.6v-1.6c2.1-.2 3.6-1.5 3.6-3.5z"/><path fill="#fff" fill-opacity=".85" d="M12.2 7.4 10.4 9.2A11 11 0 0 0 7.8 16a11 11 0 0 0 2.6 6.8l1.8 1.8A13.4 13.4 0 0 1 5.4 16a13.4 13.4 0 0 1 6.8-8.6zm7.6 0A13.4 13.4 0 0 1 26.6 16a13.4 13.4 0 0 1-6.8 11.4l1.8-1.8A11 11 0 0 0 24.2 16a11 11 0 0 0-2.6-6.8L19.8 7.4z"/></svg>`;
  }
  if (symbol === "USDT") {
    return `<svg class="token-logo" width="${s}" height="${s}" viewBox="0 0 32 32" aria-hidden="true"><circle cx="16" cy="16" r="16" fill="#26A17B"/><path fill="#fff" d="M17.4 14.9v-2.2h4.3V9.4H10.3v3.3h4.3v2.2c-3.5.2-6.1 1-6.1 1.9 0 1 2.9 1.8 6.5 1.9v5.5h2.4v-5.5c3.6-.1 6.4-.9 6.4-1.9 0-.9-2.6-1.7-6.4-1.9zm0 3.1v.1c-.1 0-.3 0-.4.1h-.1c-.3 0-.7 0-1.1-.1v-.1c-2.5-.1-4.4-.6-4.4-1.1 0-.5 1.9-1 4.4-1.1v.1c.3 0 .7.1 1.1.1h.1c.2 0 .3 0 .4-.1v-.1c2.5.1 4.3.6 4.3 1.1 0 .5-1.8 1-4.3 1.1z"/></svg>`;
  }
  const letter = escapeText((symbol || "?").slice(0, 1));
  return `<span class="token-chip-mark" aria-hidden="true">${letter}</span>`;
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char
  );
}

export function tokenDecimals(token: string | null | undefined, chainId?: string | null): number {
  const symbol = (token ?? "").toUpperCase();
  const id = String(chainId ?? "");
  // BNB Smart Chain pegged USDC/USDT use 18 decimals.
  if (id === "56" && (symbol === "USDC" || symbol === "USDT")) return 18;
  if (symbol === "ETH" || symbol === "NATIVE" || symbol === "") return 18;
  if (symbol === "USDC" || symbol === "USDT") return 6;
  return 18;
}

/** Format a raw on-chain amount (integer string) for display. */
export function formatTokenAmount(
  raw: string | null | undefined,
  token: string | null | undefined,
  chainId?: string | null
): string {
  if (!raw || raw === "0") return `0 ${token ?? ""}`.trim();
  const decimals = tokenDecimals(token, chainId);
  const negative = raw.startsWith("-");
  const digits = negative ? raw.slice(1) : raw;
  if (!/^\d+$/.test(digits)) return raw;
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, -decimals) || "0";
  const fraction = padded.slice(-decimals).replace(/0+$/, "");
  const value = fraction ? `${whole}.${fraction}` : whole;
  const symbol = token && token.toUpperCase() !== "NATIVE" ? ` ${token}` : token ? " ETH" : "";
  return `${negative ? "-" : ""}${value}${symbol}`;
}

export function explorerBase(chainId: string | null | undefined): string | null {
  switch (String(chainId ?? "")) {
    case "1":
      return "https://etherscan.io";
    case "11155111":
      return "https://sepolia.etherscan.io";
    case "8453":
      return "https://basescan.org";
    case "56":
      return "https://bscscan.com";
    case "42161":
      return "https://arbiscan.io";
    case "nile":
    case "3448148188":
      return "https://nile.tronscan.org";
    case "shasta":
      return "https://shasta.tronscan.org";
    case "tron":
    case "728126428":
      return "https://tronscan.org";
    case "devnet":
      return "https://explorer.solana.com";
    case "mainnet-beta":
    case "solana":
      return "https://explorer.solana.com";
    default:
      return null;
  }
}

function isTronExplorer(chainId: string | null | undefined): boolean {
  return networkKind(chainId) === "tron";
}

function isSolanaExplorer(chainId: string | null | undefined): boolean {
  return networkKind(chainId) === "solana";
}

export function explorerAddressUrl(chainId: string | null | undefined, address: string): string | null {
  const base = explorerBase(chainId);
  if (!base) return null;
  if (isTronExplorer(chainId)) return `${base}/#/address/${address}`;
  if (isSolanaExplorer(chainId)) {
    return `${base}/address/${address}${solanaExplorerCluster(chainId)}`;
  }
  return `${base}/address/${address}`;
}

export function explorerTxUrl(chainId: string | null | undefined, txHash: string): string | null {
  const base = explorerBase(chainId);
  if (!base) return null;
  if (isTronExplorer(chainId)) return `${base}/#/transaction/${txHash}`;
  if (isSolanaExplorer(chainId)) {
    return `${base}/tx/${txHash}${solanaExplorerCluster(chainId)}`;
  }
  return `${base}/tx/${txHash}`;
}
