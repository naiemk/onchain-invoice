export type FastSwapChainType = "evm" | "tron";

export type FastSwapTokenConfig = {
  symbol: string;
  chainId: string;
  address?: string;
  decimals: number;
  isNative?: boolean;
  /** Raw integer micro-USD price, e.g. "$2,000" = "2000000000". UI applies decimal display only. */
  priceUsdMicros?: string;
  priceSources?: FastSwapTokenPriceSourceConfig[];
  minLiquidity?: string;
  explorerUrl?: string;
};

export type FastSwapTokenPriceSourceConfig =
  | {
      type: "coingecko";
      coinId?: string;
      platformId?: string;
      contractAddress?: string;
    }
  | {
      type: "binance";
      symbol: string;
    }
  | {
      type: "dexscreener";
      chainId: string;
      tokenAddress?: string;
      pairAddress?: string;
    }
  | {
      type: "static";
      priceUsdMicros: string;
    };

export type FastSwapChainConfig = {
  id: string;
  type: FastSwapChainType;
  name: string;
  nativeSymbol: string;
  sweeperAddress: string;
  fastSwapAddress: string;
  explorerUrl: string;
  tokens: FastSwapTokenConfig[];
};

export type FastSwapPack = {
  /** Raw integer micro-USD notional. "$20" = "20000000". */
  usdAmountMicros: string;
};

export type FastSwapQuoteRequest = {
  sourceChainId: string;
  sourceToken: string;
  targetChainId: string;
  targetToken: string;
  recipient: string;
  /** Raw integer micro-USD notional. Preferred over legacy usdPack. */
  usdAmountMicros?: string;
  /** Legacy whole-dollar pack value kept for old clients/tests. */
  usdPack?: number;
  refundAddress?: string;
};

export type QuoteSourceResult = {
  source: string;
  rate: string;
  targetAmount: string;
  updatedAt: number;
};

export type FastSwapQuote = {
  quoteId: string;
  expiresAt: number;
  sourceChainId: string;
  sourceToken: string;
  sourceAmount: string;
  targetChainId: string;
  targetToken: string;
  targetAmount: string;
  recipient: string;
  feeAmount: string;
  rate: string;
  sources: QuoteSourceResult[];
};

export type FastSwapStatus =
  | "quoted"
  | "waiting_payment"
  | "paid"
  | "relaying"
  | "queued"
  | "complete"
  | "failed";

/** On-chain transfer (sweep, relay, payout, or user payment). */
export type FastSwapChainTx = {
  chainId: string;
  txHash: string;
  blockNumber?: number;
  gasUsed?: string;
  status: "pending" | "confirmed" | "failed";
  explorerTxUrl?: string;
};

/** Sweep metadata: optional payer payment tx, sweeper tx, forwarder context. */
export type FastSwapSweepInfo = {
  /** Sweeper transaction that pulls funds from the invoice contract. */
  tx?: FastSwapChainTx;
  /** Original payer → forwarder payment, when known from indexer. */
  sourcePayment?: FastSwapChainTx;
  forwarder?: string;
  paymentToken?: string;
  paymentAmount?: string;
  sweeperAddress?: string;
  error?: string;
};

export type FastSwapRelayInfo = {
  status?: "pending" | "submitted" | "confirmed" | "failed";
  /** Source-chain tx where `SwapRequested` was emitted (cross-chain swap intent). */
  swapRequestedTx?: FastSwapChainTx;
  tx?: FastSwapChainTx;
  error?: string;
};

export type FastSwapPayoutInfo = {
  status?: "pending" | "confirmed" | "failed";
  tx?: FastSwapChainTx;
  token?: string;
  amount?: string;
  recipient?: string;
  error?: string;
};

export type FastSwapInvoice = FastSwapQuote & {
  invoiceId: string;
  invoiceAddress: string;
  data: string;
  chainId: string;
  token?: string;
  amount: string;
  status: FastSwapStatus;
  /** HMAC-SHA256 hex over canonical invoice fields; nodes verify before acting. */
  signature?: string;
  sweep?: FastSwapSweepInfo;
  relay?: FastSwapRelayInfo;
  payout?: FastSwapPayoutInfo;
};

/** Allowed fields for `POST /invoices/:id/track` (node-authenticated merge). */
export type FastSwapInvoiceTrackPatch = {
  status?: FastSwapStatus;
  sweep?: Partial<FastSwapSweepInfo> & { tx?: Partial<FastSwapChainTx>; sourcePayment?: Partial<FastSwapChainTx> };
  relay?: Partial<FastSwapRelayInfo> & { tx?: Partial<FastSwapChainTx>; swapRequestedTx?: Partial<FastSwapChainTx> };
  payout?: Partial<FastSwapPayoutInfo> & { tx?: Partial<FastSwapChainTx> };
};

export type FastSwapRecentSwap = {
  swapId: string;
  sourceChainId: string;
  targetChainId: string;
  sourceToken: string;
  targetToken: string;
  sourceAmount?: string;
  targetAmount?: string;
  amountBand: string;
  status: FastSwapStatus;
  txHash?: string;
  explorerTxUrl?: string;
  completedAt?: number;
};

export type FastSwapLiquiditySummary = {
  chainId: string;
  token: string;
  balance: string;
  reserved: string;
  queuedAmount: string;
  lowLiquidity: boolean;
};
