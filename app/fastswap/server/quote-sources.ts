import type { FastSwapQuoteRequest, QuoteSourceResult } from "../shared/types.js";

export type QuoteSource = {
  name: string;
  getQuote(request: FastSwapQuoteRequest): Promise<QuoteSourceResult>;
};

export class StaticQuoteSource implements QuoteSource {
  constructor(
    readonly name: string,
    private readonly rates: Record<string, string>
  ) {}

  async getQuote(request: FastSwapQuoteRequest): Promise<QuoteSourceResult> {
    const key = `${request.sourceChainId}:${request.sourceToken}->${request.targetChainId}:${request.targetToken}`;
    const rate = this.rates[key] ?? "1";
    const usdMicros = request.usdAmountMicros ?? String(BigInt(request.usdPack ?? 0) * 1_000_000n);
    const targetAmount = BigInt(usdMicros) * BigInt(rate);
    return {
      source: this.name,
      rate,
      targetAmount: targetAmount.toString(),
      updatedAt: Date.now(),
    };
  }
}

export class HttpQuoteSource implements QuoteSource {
  constructor(
    readonly name: string,
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch
  ) {}

  async getQuote(request: FastSwapQuoteRequest): Promise<QuoteSourceResult> {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
    if (!response.ok) throw new Error(`${this.name} quote failed: ${response.statusText}`);
    const body = (await response.json()) as Partial<QuoteSourceResult>;
    if (!body.rate || !body.targetAmount) throw new Error(`${this.name} quote response missing rate`);
    return {
      source: this.name,
      rate: body.rate,
      targetAmount: body.targetAmount,
      updatedAt: body.updatedAt ?? Date.now(),
    };
  }
}
