import type {
  FastSwapChainDefinition,
  FastSwapConfigFile,
  FastSwapConfigToken,
  ChainLiquidityConfig,
  LiquidityReceiverConfig,
  LiquidityTokenBand,
} from "./types.js";
import type { FastSwapTokenPriceSourceConfig } from "../shared/types.js";

const USD_DECIMALS = 6;

/** Parse a human decimal string into raw base units (e.g. "10" USDT @ 6 → "10000000"). */
export function parseDecimalToRaw(value: string, decimals: number, label = "amount"): string {
  const trimmed = value.trim();
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Invalid decimal ${label}: "${value}"`);
  }
  const [whole, fraction = ""] = trimmed.split(".");
  if (fraction.length > decimals) {
    throw new Error(`Too many decimal places in ${label} "${value}" (max ${decimals})`);
  }
  const raw = BigInt(whole + fraction.padEnd(decimals, "0"));
  return raw.toString();
}

/** Parse a USD notional (e.g. "10" → micro-USD "10000000"). */
export function parseUsdToMicros(value: string): string {
  return parseDecimalToRaw(value, USD_DECIMALS, "USD amount");
}

type RawTokenDef = {
  address?: string;
  decimals: number;
  isNative?: boolean;
  minLiquidity?: string;
  priceUsd?: string;
  priceSources?: RawPriceSource[];
};

type RawPriceSource =
  | { type: "coingecko"; coinId?: string; platformId?: string; contractAddress?: string }
  | { type: "binance"; symbol: string }
  | { type: "dexscreener"; chainId: string; tokenAddress?: string; pairAddress?: string }
  | { type: "static"; priceUsd?: string; priceUsdMicros?: string };

type RawLiquidityBand = {
  isStable?: boolean;
  floor: string;
  target: string;
  ceiling: string;
};

type RawChain = Omit<FastSwapChainDefinition, "tokens" | "liquidity" | "feeLimit"> & {
  tokens: Record<string, RawTokenDef> | FastSwapConfigToken[];
  feeLimit?: number | string;
  liquidity?: {
    reserveStable: string;
    receivers: Array<{
      address?: string;
      tokens: Record<string, RawLiquidityBand> | LiquidityTokenBand[];
    }>;
  };
};

type RawConfig = Omit<FastSwapConfigFile, "quote" | "chains"> & {
  quote: Omit<FastSwapConfigFile["quote"], "packsUsdMicros"> & {
    packsUsd?: string[];
    packsUsdMicros?: string[];
  };
  chains: RawChain[];
};

export function normalizeFastSwapConfig(raw: RawConfig): FastSwapConfigFile {
  const packsUsdMicros =
    raw.quote.packsUsd?.map(parseUsdToMicros) ??
    raw.quote.packsUsdMicros ??
    (() => {
      throw new Error("quote.packsUsd or quote.packsUsdMicros is required");
    })();

  return {
    ...raw,
    quote: {
      feeBps: raw.quote.feeBps,
      maxDeviationBps: raw.quote.maxDeviationBps,
      quoteTtlSec: raw.quote.quoteTtlSec,
      packsUsdMicros,
    },
    chains: raw.chains.map(normalizeChain),
  };
}

function normalizeChain(chain: RawChain): FastSwapChainDefinition {
  if (Array.isArray(chain.tokens)) {
    return {
      ...chain,
      feeLimit: normalizeFeeLimit(chain),
      tokens: chain.tokens,
      liquidity: chain.liquidity as ChainLiquidityConfig | undefined,
    };
  }

  const tokenMap = chain.tokens;
  const tokens = Object.entries(tokenMap).map(([symbol, def]) => normalizeToken(symbol, def));

  return {
    ...chain,
    feeLimit: normalizeFeeLimit(chain),
    tokens,
    liquidity: chain.liquidity ? normalizeLiquidity(chain.liquidity, tokenMap) : undefined,
  };
}

function normalizeToken(symbol: string, def: RawTokenDef): FastSwapConfigToken {
  const minLiquidity =
    def.minLiquidity !== undefined ? parseDecimalToRaw(def.minLiquidity, def.decimals, `${symbol} minLiquidity`) : "0";

  const priceSources = normalizePriceSources(def.priceSources, def.priceUsd, symbol);
  const priceUsdMicros = def.priceUsd ? parseUsdToMicros(def.priceUsd) : undefined;

  return {
    symbol,
    address: def.address,
    decimals: def.decimals,
    isNative: def.isNative,
    minLiquidity,
    priceUsdMicros,
    priceSources,
  };
}

function normalizePriceSources(
  sources: RawPriceSource[] | undefined,
  priceUsd: string | undefined,
  symbol: string
): FastSwapTokenPriceSourceConfig[] | undefined {
  const normalized = (sources ?? []).map((source) => normalizePriceSource(source, symbol));
  if (normalized.length > 0) return normalized;
  if (priceUsd) return [{ type: "static", priceUsdMicros: parseUsdToMicros(priceUsd) }];
  return undefined;
}

function normalizePriceSource(source: RawPriceSource, symbol: string): FastSwapTokenPriceSourceConfig {
  switch (source.type) {
    case "static": {
      const priceUsdMicros =
        source.priceUsdMicros ??
        (source.priceUsd ? parseUsdToMicros(source.priceUsd) : undefined);
      if (!priceUsdMicros) throw new Error(`${symbol}: static price source needs priceUsd`);
      return { type: "static", priceUsdMicros };
    }
    case "coingecko":
      return { type: "coingecko", coinId: source.coinId, platformId: source.platformId, contractAddress: source.contractAddress };
    case "binance":
      return { type: "binance", symbol: source.symbol };
    case "dexscreener":
      return {
        type: "dexscreener",
        chainId: source.chainId,
        tokenAddress: source.tokenAddress,
        pairAddress: source.pairAddress,
      };
  }
}

function normalizeLiquidity(
  liquidity: NonNullable<RawChain["liquidity"]>,
  tokenMap: Record<string, RawTokenDef>
): ChainLiquidityConfig {
  const reserveSymbol = liquidity.reserveStable;
  const reserveDef = tokenMap[reserveSymbol];
  if (!reserveDef?.address) {
    throw new Error(`liquidity.reserveStable "${reserveSymbol}": token not found or missing address`);
  }

  return {
    reserveStable: {
      symbol: reserveSymbol,
      address: reserveDef.address,
      decimals: reserveDef.decimals,
    },
    receivers: liquidity.receivers.map((receiver) => normalizeReceiver(receiver, tokenMap)),
  };
}

function normalizeReceiver(
  receiver: NonNullable<RawChain["liquidity"]>["receivers"][number],
  tokenMap: Record<string, RawTokenDef>
): LiquidityReceiverConfig {
  if (Array.isArray(receiver.tokens)) {
    return { address: receiver.address, tokens: receiver.tokens };
  }

  const tokens: LiquidityTokenBand[] = Object.entries(receiver.tokens).map(([symbol, band]) => {
    const def = tokenMap[symbol];
    if (!def) throw new Error(`liquidity band: unknown token symbol "${symbol}"`);
    return {
      symbol,
      address: def.address,
      decimals: def.decimals,
      isStable: band.isStable,
      floor: parseDecimalToRaw(band.floor, def.decimals, `${symbol} floor`),
      target: parseDecimalToRaw(band.target, def.decimals, `${symbol} target`),
      ceiling: parseDecimalToRaw(band.ceiling, def.decimals, `${symbol} ceiling`),
    };
  });

  return { address: receiver.address, tokens };
}

function normalizeFeeLimit(chain: RawChain): number | undefined {
  if (chain.feeLimit === undefined) return undefined;
  if (typeof chain.feeLimit === "number") return chain.feeLimit;
  return Number(parseDecimalToRaw(chain.feeLimit, 6, `${chain.key} feeLimit`));
}

function microsToUsd(micros: string): string {
  const raw = BigInt(micros);
  const whole = raw / 1_000_000n;
  const frac = raw % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
}
