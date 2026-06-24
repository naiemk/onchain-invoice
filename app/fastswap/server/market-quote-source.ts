import type { FastSwapChainConfig, FastSwapQuoteRequest, FastSwapTokenConfig, QuoteSourceResult } from "../shared/types.js";
import { resolveTokenPriceUsdMicros } from "./price-sources.js";
import type { QuoteSource } from "./quote-sources.js";

const USD_MICROS = 1_000_000n;

/** Quote source backed by a single price-feed type (coingecko, binance, or dexscreener). */
export class MarketQuoteSource implements QuoteSource {
  constructor(
    readonly name: string,
    private readonly priceType: "coingecko" | "binance" | "dexscreener",
    private readonly chains: FastSwapChainConfig[]
  ) {}

  async getQuote(request: FastSwapQuoteRequest): Promise<QuoteSourceResult> {
    const usdMicros = requestUsdMicros(request);
    const sourceToken = findToken(this.chains, request.sourceChainId, request.sourceToken);
    const targetToken = findToken(this.chains, request.targetChainId, request.targetToken);
    const sourcePrice = await priceForType(sourceToken, this.priceType);
    const targetPrice = await priceForType(targetToken, this.priceType);
    if (!sourcePrice || !targetPrice) throw new Error(`${this.name}: missing token price`);

    const sourceAmount = tokenAmountFromUsd(usdMicros, sourceToken, sourcePrice);
    const targetAmount = tokenAmountFromUsd(usdMicros, targetToken, targetPrice);
    const rate = targetAmount > 0n ? ((sourceAmount * USD_MICROS) / targetAmount).toString() : "0";

    return {
      source: this.name,
      rate,
      targetAmount: targetAmount.toString(),
      updatedAt: Date.now(),
    };
  }
}

async function priceForType(
  token: FastSwapTokenConfig | undefined,
  type: "coingecko" | "binance" | "dexscreener"
): Promise<bigint | undefined> {
  if (!token) return undefined;
  const filtered = { ...token, priceSources: token.priceSources?.filter((s) => s.type === type) };
  return resolveTokenPriceUsdMicros(filtered);
}

function requestUsdMicros(request: FastSwapQuoteRequest): bigint {
  if (request.usdAmountMicros) return BigInt(request.usdAmountMicros);
  if (request.usdPack === undefined) throw new Error("Missing USD amount");
  return BigInt(request.usdPack) * USD_MICROS;
}

function tokenAmountFromUsd(usdMicros: bigint, token: FastSwapTokenConfig | undefined, priceMicros: bigint): bigint {
  if (!token) throw new Error("Unknown token");
  const scale = 10n ** BigInt(token.decimals);
  return (usdMicros * scale + priceMicros - 1n) / priceMicros;
}

function findToken(chains: FastSwapChainConfig[], chainId: string, tokenAddress: string): FastSwapTokenConfig | undefined {
  const chain = chains.find((c) => c.id === chainId);
  if (!chain) return undefined;
  if (!tokenAddress || tokenAddress === "native" || tokenAddress.toLowerCase() === "0x0000000000000000000000000000000000000000") {
    return chain.tokens.find((t) => t.isNative);
  }
  const isTron = chain.type === "tron";
  const normalized = isTron && tokenAddress.startsWith("T") ? tokenAddress : tokenAddress.toLowerCase();
  return chain.tokens.find((t) => {
    if (t.isNative) return false;
    const addr = t.address ?? "";
    const cmp = isTron && addr.startsWith("T") ? addr : addr.toLowerCase();
    return cmp === normalized;
  });
}

export function buildMarketQuoteSources(chains: FastSwapChainConfig[]): QuoteSource[] {
  return [
    new MarketQuoteSource("coingecko", "coingecko", chains),
    new MarketQuoteSource("binance", "binance", chains),
    new MarketQuoteSource("dexscreener", "dexscreener", chains),
  ];
}
