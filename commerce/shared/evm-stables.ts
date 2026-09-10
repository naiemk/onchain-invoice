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

/** Stable tokens the wallet tracks on a chain (fee token + known USDC/USDT). */
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
