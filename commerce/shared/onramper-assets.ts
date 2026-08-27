/**
 * Browser-safe Onramper asset / stablecoin mapping (no node:crypto).
 */

/** Default fiat currencies exposed when Onramper is enabled. */
export const DEFAULT_ONRAMPER_FIATS = [
  "USD",
  "EUR",
  "GBP",
  "SEK",
  "NOK",
  "DKK",
  "CHF",
  "CAD",
  "AUD",
  "JPY",
  "PLN",
  "CZK",
] as const;

export interface OnramperAssetIds {
  /** Onramper crypto id (onlyCryptos / wallets prefix). */
  cryptoId: string;
  /** Onramper network id (onlyCryptoNetworks / networkWallets prefix). */
  networkId: string;
}

/** Product chain/token pairs that may use card/bank checkout (mainnet + testnet stand-ins). */
export const ONRAMPER_SUPPORTED_PAIRS = [
  { chainId: "1", token: "USDC" },
  { chainId: "8453", token: "USDC" },
  { chainId: "tron", token: "USDT" },
  { chainId: "56", token: "USDC" },
  { chainId: "56", token: "USDT" },
  { chainId: "11155111", token: "USDC" },
  { chainId: "nile", token: "USDT" },
] as const;

export function onramperPairKey(chainId: string, token: string): string {
  return `${String(chainId)}:${token.trim().toUpperCase()}`;
}

/** True when the widget origin host is Onramper sandbox (.dev). */
export function isOnramperSandboxOrigin(widgetOrigin: string): boolean {
  try {
    return new URL(widgetOrigin).hostname.endsWith(".dev");
  } catch {
    return false;
  }
}

/**
 * Map product chainId + token → Onramper asset ids for widget locking.
 * Testnet pairs (Sepolia, Nile) map to mainnet Onramper ids for sandbox UX only —
 * sandbox checkout does not fund testnet invoice addresses.
 */
export function resolveOnramperAsset(chainId: string, token: string): OnramperAssetIds | null {
  const symbol = token.trim().toUpperCase();
  const id = String(chainId).toLowerCase();

  if (id === "8453" && symbol === "USDC") {
    return { cryptoId: "usdc_base", networkId: "base" };
  }
  if ((id === "1" || id === "0x1") && symbol === "USDC") {
    return { cryptoId: "usdc_ethereum", networkId: "ethereum" };
  }
  if ((id === "tron" || id === "0x2b6653dc") && symbol === "USDT") {
    return { cryptoId: "usdt_tron", networkId: "tron" };
  }
  if (id === "56" && symbol === "USDC") {
    return { cryptoId: "usdc_bsc", networkId: "bsc" };
  }
  if (id === "56" && symbol === "USDT") {
    return { cryptoId: "usdt_bsc", networkId: "bsc" };
  }
  if (id === "11155111" && symbol === "USDC") {
    return { cryptoId: "usdc_base", networkId: "base" };
  }
  if (id === "nile" && symbol === "USDT") {
    return { cryptoId: "usdt_tron", networkId: "tron" };
  }
  return null;
}

export function onramperSupportedPair(chainId: string, token: string): boolean {
  return resolveOnramperAsset(chainId, token) != null;
}

export type OnramperWidgetMode = "buy" | "sell";

export interface OnramperSessionAsset {
  chainId: string;
  token: string;
  cryptoId: string;
  networkId: string;
}

/** EVM wallet rails: USDC + USDT wherever Onramper already maps them (skips Tron/Nile). */
export function listOnramperEvmWalletAssets(chainIds: readonly string[]): OnramperSessionAsset[] {
  const out: OnramperSessionAsset[] = [];
  const seen = new Set<string>();
  for (const chainId of chainIds) {
    const id = String(chainId).toLowerCase();
    if (id === "tron" || id === "nile" || id === "0x2b6653dc") continue;
    for (const token of ["USDC", "USDT"] as const) {
      const asset = resolveOnramperAsset(chainId, token);
      if (!asset) continue;
      const key = `${asset.cryptoId}|${asset.networkId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ chainId: String(chainId), token, ...asset });
    }
  }
  return out;
}

/** Map Onramper crypto id → product chain/token (first matching EVM pair). */
export function resolveProductAssetFromOnramperCryptoId(
  cryptoId: string
): { chainId: string; token: string } | null {
  const id = cryptoId.trim().toLowerCase();
  for (const pair of ONRAMPER_SUPPORTED_PAIRS) {
    const asset = resolveOnramperAsset(pair.chainId, pair.token);
    if (asset?.cryptoId === id) {
      const cid = String(pair.chainId).toLowerCase();
      if (cid === "tron" || cid === "nile") continue;
      return { chainId: String(pair.chainId), token: pair.token };
    }
  }
  return null;
}

/**
 * Well-known mainnet ERC-20 addresses for wallet stables beyond the fee token.
 * Fee-token address from wallet config always wins when symbols match.
 */
export const EVM_KNOWN_STABLE_ADDRESSES: Readonly<
  Record<string, Partial<Record<"USDC" | "USDT", string>>>
> = {
  "1": { USDC: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  "8453": { USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  "56": {
    USDC: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    USDT: "0x55d398326f99059fF775485246999027B3197955",
  },
};

export function resolveEvmStableTokenAddress(
  chainId: string,
  token: string,
  feeToken?: { symbol: string; address?: string | null }
): string | null {
  const symbol = token.trim().toUpperCase();
  if (feeToken?.address && feeToken.symbol.trim().toUpperCase() === symbol) {
    return feeToken.address;
  }
  const known = EVM_KNOWN_STABLE_ADDRESSES[String(chainId)]?.[symbol as "USDC" | "USDT"];
  return known ?? null;
}

/** Stable tokens the wallet can on/off-ramp on a chain (fee token + known USDT when mapped). */
export function walletStableTokensForChain(chain: {
  chainId: string;
  feeTokenAddress?: string | null;
  feeTokenSymbol: string;
  feeTokenDecimals: number;
}): Array<{ symbol: string; address: string; decimals: number }> {
  const out: Array<{ symbol: string; address: string; decimals: number }> = [];
  const seen = new Set<string>();
  const push = (symbol: string, address: string | null | undefined, decimals: number) => {
    if (!address) return;
    const key = symbol.toUpperCase();
    if (seen.has(key)) return;
    if (!resolveOnramperAsset(chain.chainId, key)) return;
    seen.add(key);
    out.push({ symbol: key, address, decimals });
  };
  push(chain.feeTokenSymbol, chain.feeTokenAddress, chain.feeTokenDecimals);
  for (const symbol of ["USDC", "USDT"] as const) {
    const addr = resolveEvmStableTokenAddress(chain.chainId, symbol, {
      symbol: chain.feeTokenSymbol,
      address: chain.feeTokenAddress,
    });
    push(symbol, addr, 6);
  }
  return out;
}
