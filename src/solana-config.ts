/**
 * Shared Solana chain/token config helpers.
 * Runtime differs only by chainId (+ token symbol) lookup — not testnet/mainnet branches.
 */

export type SolanaTokenConfig = {
  mint: string;
  decimals?: number;
};

export type SolanaChainConfig = {
  /** When false, create/sweep skip this chain (e.g. mainnet placeholder). */
  enabled?: boolean;
  rpcUrl?: string;
  programId: string;
  feeRecipient?: string;
  feeBps?: number;
  tokens: Record<string, SolanaTokenConfig>;
};

export type SolanaNetworksConfig = Record<string, SolanaChainConfig>;

/** Well-known mints (placeholders until operator overrides). */
export const SOLANA_KNOWN_MINTS = {
  "mainnet-beta": {
    USDC: { mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
    USDT: { mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  },
  devnet: {
    /** Circle USDC on Solana Devnet */
    USDC: { mint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU", decimals: 6 },
    /** Placeholder — replace with your deployed / faucet USDT mint on Devnet */
    USDT: { mint: "PLACEHOLDER_DEVNET_USDT_MINT", decimals: 6 },
  },
} as const;

export function resolveSolanaChain(
  chains: SolanaNetworksConfig | undefined,
  chainId: string | null | undefined
): SolanaChainConfig | undefined {
  if (!chains || !chainId) return undefined;
  const chain = chains[String(chainId)];
  if (!chain) return undefined;
  if (chain.enabled === false) return undefined;
  if (!chain.programId || chain.programId.startsWith("PLACEHOLDER")) return undefined;
  return chain;
}

export function resolveSolanaToken(
  chain: SolanaChainConfig,
  tokenSymbol: string | null | undefined
): (SolanaTokenConfig & { symbol: string }) | undefined {
  const symbol = (tokenSymbol ?? "USDC").trim().toUpperCase();
  const token = chain.tokens[symbol];
  if (!token?.mint || token.mint.startsWith("PLACEHOLDER")) return undefined;
  return { symbol, mint: token.mint, decimals: token.decimals ?? 6 };
}

export function solanaTokenSymbols(chain: SolanaChainConfig): string[] {
  return Object.keys(chain.tokens)
    .map((s) => s.toUpperCase())
    .filter((symbol) => {
      const mint = chain.tokens[symbol]?.mint ?? chain.tokens[symbol.toLowerCase()]?.mint;
      return Boolean(mint && !mint.startsWith("PLACEHOLDER"));
    });
}
