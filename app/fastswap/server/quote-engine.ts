import { randomUUID } from "node:crypto";
import type { FastSwapChainConfig, FastSwapQuote, FastSwapQuoteRequest, FastSwapTokenConfig, QuoteSourceResult } from "../shared/types.js";
import { resolveTokenPriceUsdMicros, type PriceFetch } from "./price-sources.js";
import type { QuoteSource } from "./quote-sources.js";

export type QuoteEngineOptions = {
  sources: QuoteSource[];
  feeBps: bigint;
  quoteTtlMs: number;
  maxDeviationBps: bigint;
  allowedPackUsdMicros: string[];
  chains?: FastSwapChainConfig[];
  priceFetch?: PriceFetch;
};

export class QuoteEngine {
  constructor(private readonly options: QuoteEngineOptions) {}

  async quote(request: FastSwapQuoteRequest): Promise<FastSwapQuote> {
    const usdMicros = requestUsdMicros(request);
    if (!this.options.allowedPackUsdMicros.includes(usdMicros.toString())) {
      throw new Error("Unsupported pack amount");
    }
    if (this.options.sources.length < 3) {
      throw new Error("At least three quote sources are required");
    }

    const results = await Promise.allSettled(this.options.sources.map((source) => source.getQuote(request)));
    const good = results
      .filter((result): result is PromiseFulfilledResult<QuoteSourceResult> => result.status === "fulfilled")
      .map((result) => result.value)
      .sort((a, b) => compareBigInt(BigInt(a.targetAmount), BigInt(b.targetAmount)));

    if (good.length < 2) throw new Error("Not enough quote sources");
    const median = good[Math.floor(good.length / 2)];
    const accepted = good.filter((quote) => withinDeviation(BigInt(quote.targetAmount), BigInt(median.targetAmount), this.options.maxDeviationBps));
    if (accepted.length < 2) throw new Error("Quote sources diverged");

    const conservative = accepted[0];
    const sourceToken = findToken(this.options.chains, request.sourceChainId, request.sourceToken);
    const targetToken = findToken(this.options.chains, request.targetChainId, request.targetToken);
    const targetPriceUsdMicros = await resolveTokenPriceUsdMicros(targetToken, this.options.priceFetch);
    const sourcePriceUsdMicros = await resolveTokenPriceUsdMicros(sourceToken, this.options.priceFetch);
    const pricedTarget = tokenAmountFromUsdPack(usdMicros, targetToken, targetPriceUsdMicros);
    const grossTarget = pricedTarget ?? BigInt(conservative.targetAmount);
    const feeUsdMicros = (usdMicros * this.options.feeBps) / 10_000n;
    const sourceAmount = tokenAmountFromUsdPack(usdMicros + feeUsdMicros, sourceToken, sourcePriceUsdMicros) ?? usdMicros + feeUsdMicros;
    const sources = pricedTarget
      ? accepted.map((source) => ({ ...source, targetAmount: grossTarget.toString() }))
      : accepted;

    return {
      quoteId: randomUUID(),
      expiresAt: Date.now() + this.options.quoteTtlMs,
      sourceChainId: request.sourceChainId,
      sourceToken: request.sourceToken,
      sourceAmount: sourceAmount.toString(),
      targetChainId: request.targetChainId,
      targetToken: request.targetToken,
      targetAmount: grossTarget.toString(),
      recipient: request.recipient,
      feeAmount: tokenAmountFromUsdPack(feeUsdMicros, sourceToken, sourcePriceUsdMicros)?.toString() ?? feeUsdMicros.toString(),
      rate: conservative.rate,
      sources,
    };
  }
}

function withinDeviation(value: bigint, reference: bigint, maxDeviationBps: bigint) {
  if (reference === 0n) return value === 0n;
  const diff = value > reference ? value - reference : reference - value;
  return (diff * 10_000n) / reference <= maxDeviationBps;
}

function compareBigInt(a: bigint, b: bigint) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function findToken(chains: FastSwapChainConfig[] | undefined, chainId: string, tokenAddress: string): FastSwapTokenConfig | undefined {
  const chain = chains?.find((candidate) => candidate.id === chainId);
  if (!chain) return undefined;
  const isTron = chain.type === "tron";
  if (isNativeAddress(tokenAddress)) return chain.tokens.find((token) => token.isNative);
  const normalized = normalizeAddress(tokenAddress, isTron);
  return chain.tokens.find(
    (token) => !token.isNative && normalizeAddress(token.address, isTron) === normalized
  );
}

const ZERO_EVM_ADDRESS = "0x0000000000000000000000000000000000000000";

function isNativeAddress(address: string | undefined): boolean {
  return !address || address === "native" || address.toLowerCase() === ZERO_EVM_ADDRESS;
}

/** TRON base58 (`T...`) addresses are case-sensitive, so only EVM hex addresses are lowercased. */
function normalizeAddress(address: string | undefined, isTron: boolean) {
  if (!address) return ZERO_EVM_ADDRESS;
  return isTron && address.startsWith("T") ? address : address.toLowerCase();
}

const USD_MICROS = 1_000_000n;

function requestUsdMicros(request: FastSwapQuoteRequest): bigint {
  const raw = request.usdAmountMicros;
  if (raw !== undefined) {
    const parsed = parsePositiveBigInt(raw);
    if (!parsed) throw new Error("Invalid USD amount");
    return parsed;
  }
  if (request.usdPack === undefined || !Number.isInteger(request.usdPack) || request.usdPack <= 0) {
    throw new Error("Invalid USD amount");
  }
  return BigInt(request.usdPack) * USD_MICROS;
}

function tokenAmountFromUsdPack(usdMicros: bigint, token: FastSwapTokenConfig | undefined, resolvedPriceMicros?: bigint): bigint | undefined {
  const priceMicros = resolvedPriceMicros ?? parsePositiveBigInt(token?.priceUsdMicros);
  if (!priceMicros || !token) return undefined;
  const scale = 10n ** BigInt(token.decimals);
  return ceilDiv(usdMicros * scale, priceMicros);
}

function parsePositiveBigInt(value: string | undefined): bigint | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = BigInt(value);
  return parsed > 0n ? parsed : undefined;
}

function ceilDiv(numerator: bigint, denominator: bigint) {
  return (numerator + denominator - 1n) / denominator;
}
