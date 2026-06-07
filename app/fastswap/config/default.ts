import type { FastSwapChainConfig, FastSwapPack } from "../shared/types.js";

export const FASTSWAP_PACKS: FastSwapPack[] = [
  { usdAmountMicros: "10000000" },
  { usdAmountMicros: "20000000" },
  { usdAmountMicros: "25000000" },
  { usdAmountMicros: "40000000" },
  { usdAmountMicros: "50000000" },
  { usdAmountMicros: "100000000" },
  { usdAmountMicros: "200000000" },
];

export const FASTSWAP_DEFAULT_FEE_BPS = 75n;

export const FASTSWAP_CHAINS: FastSwapChainConfig[] = [
  {
    id: "base",
    type: "evm",
    name: "Base",
    nativeSymbol: "ETH",
    sweeperAddress: "0x0000000000000000000000000000000000000000",
    fastSwapAddress: "0x0000000000000000000000000000000000000000",
    explorerUrl: "https://basescan.org",
    tokens: [
      {
        symbol: "ETH",
        chainId: "base",
        decimals: 18,
        isNative: true,
        priceUsdMicros: "2000000000",
      },
      {
        symbol: "USDC",
        chainId: "base",
        address: "0x0000000000000000000000000000000000000000",
        decimals: 6,
        priceUsdMicros: "1000000",
      },
    ],
  },
  {
    id: "tron",
    type: "tron",
    name: "Tron",
    nativeSymbol: "TRX",
    sweeperAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
    fastSwapAddress: "T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb",
    explorerUrl: "https://tronscan.org",
    tokens: [
      {
        symbol: "TRX",
        chainId: "tron",
        decimals: 6,
        isNative: true,
        priceUsdMicros: "120000",
        priceSources: [
          { type: "coingecko", coinId: "tron" },
          { type: "binance", symbol: "TRXUSDT" },
          { type: "dexscreener", chainId: "tron", tokenAddress: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" },
        ],
      },
      {
        symbol: "USDT",
        chainId: "tron",
        address: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
        decimals: 6,
        priceUsdMicros: "1000000",
        priceSources: [
          { type: "coingecko", coinId: "tether" },
          { type: "static", priceUsdMicros: "1000000" },
        ],
      },
    ],
  },
];
