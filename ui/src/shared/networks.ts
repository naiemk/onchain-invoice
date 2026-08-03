export type ChainKind = "evm" | "tron" | "solana";

export interface NetworkOption {
  id: string;
  label: string;
  kind: ChainKind;
  short: string;
  testnet?: boolean;
}

export interface TokenOption {
  id: string;
  label: string;
}

export const NETWORKS: NetworkOption[] = [
  { id: "11155111", label: "Ethereum Sepolia", short: "Sepolia", kind: "evm", testnet: true },
  { id: "nile", label: "TRON Nile", short: "Nile", kind: "tron", testnet: true },
  { id: "devnet", label: "Solana Devnet", short: "Solana", kind: "solana", testnet: true },
  { id: "1", label: "Ethereum Mainnet", short: "Ethereum", kind: "evm" },
  { id: "8453", label: "Base", short: "Base", kind: "evm" },
  { id: "42161", label: "Arbitrum One", short: "Arbitrum", kind: "evm" },
];

export const TOKENS: TokenOption[] = [
  { id: "USDC", label: "USDC" },
  { id: "USDT", label: "USDT" },
];

/** Stablecoins only until FX/conversion is implemented (USD price ≠ ETH amount). */
export const SUPPORTED_TOKENS = new Set(TOKENS.map((t) => t.id.toUpperCase()));

const TRON_BASE58_RE = /^T[1-9A-HJ-NP-Za-km-z]{33}$/;
const SOLANA_BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

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
  const kind = networkKind(chainId);
  if (kind === "tron") return symbol === "USDT";
  return symbol === "USDC";
}

export function tokensForChains(chainIds: string[]): TokenOption[] {
  if (chainIds.length === 0) return [];
  return TOKENS.filter((token) => chainIds.some((id) => tokenAllowedOnChain(id, token.id)));
}

export function looksLikeTronAddress(value: string): boolean {
  return TRON_BASE58_RE.test(value.trim());
}

export function looksLikeSolanaAddress(value: string): boolean {
  const trimmed = value.trim();
  if (!SOLANA_BASE58_RE.test(trimmed)) return false;
  if (trimmed.startsWith("T") && trimmed.length === 34) return false;
  return true;
}

export function isValidAddress(value: string, kind: ChainKind): boolean {
  const trimmed = value.trim();
  if (kind === "tron") return looksLikeTronAddress(trimmed);
  if (kind === "solana") return looksLikeSolanaAddress(trimmed);
  return /^0x[0-9a-fA-F]{40}$/.test(trimmed);
}

export function normalizeAddress(value: string, kind: ChainKind): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Address is required");
  if (kind === "tron") {
    if (!looksLikeTronAddress(trimmed)) throw new Error(`Invalid Tron address: ${value}`);
    return trimmed;
  }
  if (kind === "solana") {
    if (!looksLikeSolanaAddress(trimmed)) throw new Error(`Invalid Solana address: ${value}`);
    return trimmed;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) throw new Error(`Invalid EVM address: ${value}`);
  return trimmed;
}

export function networkLabel(chainId: string): string {
  return NETWORKS.find((n) => n.id === chainId)?.label ?? `Chain ${chainId}`;
}

export function networkShort(chainId: string): string {
  return NETWORKS.find((n) => n.id === chainId)?.short ?? networkLabel(chainId);
}

export function isTestnet(chainId: string | null | undefined): boolean {
  if (!chainId) return false;
  const known = NETWORKS.find((n) => n.id === chainId);
  if (known) return Boolean(known.testnet);
  return ["11155111", "84532", "421614", "11155420", "5", "80001", "nile", "shasta", "devnet"].includes(
    String(chainId)
  );
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
  return NETWORKS.filter((n) => Boolean(n.testnet) === wantTestnet);
}

export function testnetPillHtml(chainId: string | null | undefined): string {
  if (!isTestnet(chainId)) return "";
  return `<span class="testnet-pill" role="status">Testnet invoice — no real value</span>`;
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
  return `<span class="token-chip token-chip-${size}"><span class="token-chip-mark">${escapeText(symbol.slice(0, 1))}</span><span class="token-chip-label">${escapeText(symbol)}</span></span>`;
}

function escapeText(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char
  );
}

export function tokenDecimals(token: string | null | undefined): number {
  const symbol = (token ?? "").toUpperCase();
  if (symbol === "ETH" || symbol === "NATIVE" || symbol === "") return 18;
  if (symbol === "USDC" || symbol === "USDT") return 6;
  return 18;
}

/** Format a raw on-chain amount (integer string) for display. */
export function formatTokenAmount(raw: string | null | undefined, token: string | null | undefined): string {
  if (!raw || raw === "0") return `0 ${token ?? ""}`.trim();
  const decimals = tokenDecimals(token);
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
    case "42161":
      return "https://arbiscan.io";
    case "nile":
      return "https://nile.tronscan.org";
    case "shasta":
      return "https://shasta.tronscan.org";
    case "tron":
    case "3448148188":
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
    const cluster = String(chainId) === "devnet" || String(chainId) === "solana-devnet" ? "?cluster=devnet" : "";
    return `${base}/address/${address}${cluster}`;
  }
  return `${base}/address/${address}`;
}

export function explorerTxUrl(chainId: string | null | undefined, txHash: string): string | null {
  const base = explorerBase(chainId);
  if (!base) return null;
  if (isTronExplorer(chainId)) return `${base}/#/transaction/${txHash}`;
  if (isSolanaExplorer(chainId)) {
    const cluster = String(chainId) === "devnet" || String(chainId) === "solana-devnet" ? "?cluster=devnet" : "";
    return `${base}/tx/${txHash}${cluster}`;
  }
  return `${base}/tx/${txHash}`;
}
