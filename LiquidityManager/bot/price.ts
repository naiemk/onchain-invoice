import { NATIVE_TOKEN, type ChainConfig } from "../shared/types.js";

/** USD spot price per whole token, used for notional/gating decisions. */
export interface PriceFetcher {
  priceUsd(symbol: string): Promise<number>;
}

/** Static overrides first, stablecoins pinned to $1, otherwise Binance spot. */
export class SimplePriceFetcher implements PriceFetcher {
  private cache = new Map<string, { price: number; at: number }>();

  constructor(
    private readonly statics: Record<string, number> = {},
    private readonly ttlMs = 30_000
  ) {}

  async priceUsd(symbol: string): Promise<number> {
    if (symbol in this.statics) return this.statics[symbol];
    if (/^(USD|DAI|USDT|USDC|TUSD)/i.test(symbol)) return 1;

    const hit = this.cache.get(symbol);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.price;

    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${symbol}USDT`);
    if (!res.ok) throw new Error(`price fetch failed for ${symbol}: ${res.status}`);
    const body = (await res.json()) as { price: string };
    const price = Number(body.price);
    this.cache.set(symbol, { price, at: Date.now() });
    return price;
  }
}

export interface SwapRoute {
  router: string;
  data: string;
  /** Aggregator's quoted output in tokenOut base units. */
  expectedOut: bigint;
}

export interface RouteProvider {
  quote(args: {
    chain: ChainConfig;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    slippageBps: number;
  }): Promise<SwapRoute>;
}

/** Deterministic provider for dry-runs/tests: returns provided calldata and a fixed output. */
export class StaticRouteProvider implements RouteProvider {
  constructor(private readonly resolver: (tokenIn: string, tokenOut: string, amountIn: bigint) => SwapRoute) {}

  async quote(args: { chain: ChainConfig; tokenIn: string; tokenOut: string; amountIn: bigint }): Promise<SwapRoute> {
    return this.resolver(args.tokenIn, args.tokenOut, args.amountIn);
  }
}

/**
 * OpenOcean v4 aggregator. Returns the whitelisted router target + calldata + quoted output. Note its
 * own `minOutput` is EVM-only, so the LiquidityManager contract enforces our `minOut` on every chain
 * (including TRON). Best-effort/network-dependent; swap it out for 1inch/0x/Kyber via RouteProvider.
 */
export class OpenOceanRouteProvider implements RouteProvider {
  constructor(private readonly baseUrl = "https://open-api.openocean.finance/v4") {}

  async quote(args: {
    chain: ChainConfig;
    tokenIn: string;
    tokenOut: string;
    amountIn: bigint;
    slippageBps: number;
  }): Promise<SwapRoute> {
    const { chain, tokenIn, tokenOut, amountIn, slippageBps } = args;
    const slug = chain.aggregatorSlug ?? chain.key;
    const inAddr = this.resolveToken(chain, tokenIn);
    const outAddr = this.resolveToken(chain, tokenOut);

    const params = new URLSearchParams({
      inTokenAddress: inAddr,
      outTokenAddress: outAddr,
      amountDecimals: amountIn.toString(),
      gasPriceDecimals: "1",
      slippage: (slippageBps / 100).toString(),
      account: chain.liquidityManager,
    });

    const res = await fetch(`${this.baseUrl}/${slug}/swap?${params.toString()}`);
    if (!res.ok) throw new Error(`OpenOcean quote failed (${slug}): ${res.status}`);
    const body = (await res.json()) as { data?: { to?: string; data?: string; outAmount?: string } };
    const d = body.data;
    if (!d?.to || !d.data || !d.outAmount) throw new Error(`OpenOcean returned no route for ${slug}`);
    if (d.to.toLowerCase() !== chain.router.toLowerCase()) {
      throw new Error(`OpenOcean router ${d.to} is not the whitelisted router ${chain.router}`);
    }
    return { router: d.to, data: d.data, expectedOut: BigInt(d.outAmount) };
  }

  private resolveToken(chain: ChainConfig, token: string): string {
    if (token.toLowerCase() === NATIVE_TOKEN) {
      return chain.nativeSentinel ?? "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
    }
    return token;
  }
}
