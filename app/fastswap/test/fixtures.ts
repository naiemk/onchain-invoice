import type { FastSwapChainConfig, FastSwapPack } from "../shared/types.js";

export const FASTSWAP_PACKS: FastSwapPack[] = [
  { usdAmountMicros: "10000000" },
  { usdAmountMicros: "20000000" },
  { usdAmountMicros: "50000000" },
  { usdAmountMicros: "100000000" },
];

export const FASTSWAP_DEFAULT_FEE_BPS = 75n;

export const FASTSWAP_CHAINS: FastSwapChainConfig[] = [
  {
    id: "base",
    type: "evm",
    name: "Base",
    nativeSymbol: "ETH",
    sweeperAddress: "0x0000000000000000000000000000000000000001",
    fastSwapAddress: "0x0000000000000000000000000000000000000002",
    explorerUrl: "https://basescan.org",
    tokens: [
      {
        symbol: "ETH",
        chainId: "base",
        decimals: 18,
        isNative: true,
        priceUsdMicros: "2000000000",
        priceSources: [{ type: "coingecko", coinId: "ethereum" }],
      },
      {
        symbol: "USDC",
        chainId: "base",
        address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        decimals: 6,
        priceUsdMicros: "1000000",
        priceSources: [{ type: "static", priceUsdMicros: "1000000" }],
      },
    ],
  },
];
