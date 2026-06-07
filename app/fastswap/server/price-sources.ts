import type { FastSwapTokenConfig, FastSwapTokenPriceSourceConfig } from "../shared/types.js";

export type PriceFetch = typeof fetch;

export async function resolveTokenPriceUsdMicros(token: FastSwapTokenConfig | undefined, fetchImpl: PriceFetch = fetch): Promise<bigint | undefined> {
  if (!token) return undefined;
  const configuredSources = token.priceSources ?? [];
  const sourcePrices = (
    await Promise.allSettled(configuredSources.map((source) => priceFromSource(source, token, fetchImpl)))
  )
    .filter((result): result is PromiseFulfilledResult<bigint | undefined> => result.status === "fulfilled")
    .map((result) => result.value)
    .filter((value): value is bigint => value !== undefined && value > 0n)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  if (configuredSources.length > 0 && sourcePrices.length >= Math.min(2, configuredSources.length)) {
    return sourcePrices[Math.floor(sourcePrices.length / 2)];
  }

  return parsePositiveBigInt(token.priceUsdMicros);
}

async function priceFromSource(source: FastSwapTokenPriceSourceConfig, token: FastSwapTokenConfig, fetchImpl: PriceFetch): Promise<bigint | undefined> {
  switch (source.type) {
    case "static":
      return parsePositiveBigInt(source.priceUsdMicros);
    case "coingecko":
      return coinGeckoPrice(source, token, fetchImpl);
    case "binance":
      return binancePrice(source, fetchImpl);
    case "dexscreener":
      return dexScreenerPrice(source, token, fetchImpl);
  }
}

async function coinGeckoPrice(
  source: Extract<FastSwapTokenPriceSourceConfig, { type: "coingecko" }>,
  token: FastSwapTokenConfig,
  fetchImpl: PriceFetch
): Promise<bigint | undefined> {
  if (source.platformId && (source.contractAddress || token.address)) {
    // TRON base58 (`T...`) contract addresses are case-sensitive; only lowercase EVM hex.
    const rawAddress = (source.contractAddress ?? token.address)!;
    const key = rawAddress.startsWith("0x") ? rawAddress.toLowerCase() : rawAddress;
    const address = encodeURIComponent(key);
    const platform = encodeURIComponent(source.platformId);
    const body = await fetchJson<Record<string, { usd?: number | string }>>(
      `https://api.coingecko.com/api/v3/simple/token_price/${platform}?contract_addresses=${address}&vs_currencies=usd`,
      fetchImpl
    );
    return usdNumberToMicros(body[key]?.usd);
  }
  if (!source.coinId) return undefined;
  const id = encodeURIComponent(source.coinId);
  const body = await fetchJson<Record<string, { usd?: number | string }>>(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
    fetchImpl
  );
  return usdNumberToMicros(body[source.coinId]?.usd);
}

async function binancePrice(
  source: Extract<FastSwapTokenPriceSourceConfig, { type: "binance" }>,
  fetchImpl: PriceFetch
): Promise<bigint | undefined> {
  const symbol = encodeURIComponent(source.symbol.toUpperCase());
  const body = await fetchJson<{ price?: string }>(`https://data-api.binance.vision/api/v3/ticker/price?symbol=${symbol}`, fetchImpl);
  return usdNumberToMicros(body.price);
}

async function dexScreenerPrice(
  source: Extract<FastSwapTokenPriceSourceConfig, { type: "dexscreener" }>,
  token: FastSwapTokenConfig,
  fetchImpl: PriceFetch
): Promise<bigint | undefined> {
  const chainId = encodeURIComponent(source.chainId);
  if (source.pairAddress) {
    const pairAddress = encodeURIComponent(source.pairAddress);
    const body = await fetchJson<{ pair?: { priceUsd?: string } }>(
      `https://api.dexscreener.com/latest/dex/pairs/${chainId}/${pairAddress}`,
      fetchImpl
    );
    return usdNumberToMicros(body.pair?.priceUsd);
  }
  const address = source.tokenAddress ?? token.address;
  if (!address) return undefined;
  const body = await fetchJson<{ pairs?: Array<{ priceUsd?: string }> }>(
    `https://api.dexscreener.com/latest/dex/tokens/${encodeURIComponent(address)}`,
    fetchImpl
  );
  return usdNumberToMicros(body.pairs?.find((pair) => pair.priceUsd)?.priceUsd);
}

async function fetchJson<T>(url: string, fetchImpl: PriceFetch): Promise<T> {
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Price source failed: ${response.status} ${response.statusText}`);
  return response.json() as Promise<T>;
}

function usdNumberToMicros(value: number | string | undefined): bigint | undefined {
  if (value === undefined) return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return BigInt(Math.round(parsed * 1_000_000));
}

function parsePositiveBigInt(value: string | undefined): bigint | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : undefined;
}
