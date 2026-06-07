/** Shared configuration + decision types for the LiquidityManager rebalancer bot. */

export const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

export type ChainType = "evm" | "tron";

/** A per-token rule on a managed receiver. Amounts are decimal strings in base units. */
export interface TokenBand {
  symbol: string;
  /** Token contract address; omit for the chain's native asset (ETH/TRX/BNB). */
  address?: string;
  decimals: number;
  /** Marks a stablecoin (price pinned to ~$1, no swap needed when it is the reserve). */
  isStable?: boolean;
  /** Refill when balance drops below this. */
  floor: string;
  /** Bring balance back to this after a refill or collect. */
  target: string;
  /** Collect excess when balance rises above this. */
  ceiling: string;
}

export interface ManagedReceiver {
  address: string;
  tokens: TokenBand[];
}

export interface ReserveStable {
  symbol: string;
  address: string;
  decimals: number;
}

export interface ChainConfig {
  key: string;
  id: string;
  type: ChainType;
  nativeSymbol: string;
  /** EVM JSON-RPC endpoint. */
  rpcUrl?: string;
  /** TRON full host (TronWeb). */
  fullHost?: string;
  /** TRON fee limit (sun). */
  feeLimit?: number;
  /** LiquidityManager contract address on this chain. */
  liquidityManager: string;
  /** The stablecoin held as the reserve on this chain. */
  reserveStable: ReserveStable;
  /** Whitelisted DEX router/aggregator used for execution. */
  router: string;
  /** Aggregator chain slug (e.g. OpenOcean: "eth","bsc","base","tron"). Defaults to chain.key. */
  aggregatorSlug?: string;
  /** Aggregator placeholder address for the native asset (e.g. OpenOcean EVM 0xEeee…EEeE). */
  nativeSentinel?: string;
  receivers: ManagedReceiver[];
  explorerUrl?: string;
}

export interface EconomicsConfig {
  /** k: a swap is only worth it when gasCostUsd <= gasGateBps/10000 * notionalUsd. */
  gasGateBps: number;
  /** Hard minimum notional (USD) for any rebalance, regardless of the gate. */
  minNotionalUsd: number;
  /** T_max: force a deferred breach once it has persisted this long (seconds). */
  maxStalenessSec: number;
  /** Never hold volatile inventory above this (USD); forces a collect even below the gate. */
  riskCapUsd: number;
  /** Per (receiver,token) cooldown between actions (seconds). */
  cooldownSec: number;
  /** Slippage tolerance applied to aggregator quotes when computing minOut. */
  slippageBps: number;
  /** EVM: skip when gas price exceeds this (gwei). */
  maxGasPriceGwei?: number;
}

export interface LiquidityManagerConfig {
  chains: ChainConfig[];
  economics: EconomicsConfig;
  pollIntervalMs?: number;
  sqlitePath?: string;
}

// --- decision engine types ---

export type RebalanceKind = "pull" | "swap" | "push" | "processQueued";

/** A queued FastSwap swap waiting for target-chain liquidity (`SwapQueued` on the receiver). */
export interface QueuedSwapObservation {
  receiver: string;
  swapId: string;
  targetToken: string;
  targetAmount: bigint;
  recipient: string;
}

/** A concrete on-chain step the bot intends to execute. */
export interface PlannedAction {
  kind: RebalanceKind;
  /** Stable key for cooldown/staleness tracking: `${receiver}:${tokenKey}` or `queue:${swapId}`. */
  key: string;
  receiver?: string;
  /** FastSwap swap id for `processQueued` actions. */
  swapId?: string;
  /** Token moved (pull/push) or spent (swap-in). */
  token: string;
  tokenSymbol: string;
  /** Token received (swap only). */
  tokenOut?: string;
  tokenOutSymbol?: string;
  amount: bigint;
  /** Expected output for a swap, before slippage (base units of tokenOut). */
  expectedOut?: bigint;
  notionalUsd: number;
  reason: string;
}

/** Observed state of one band, fed to the pure decision function. */
export interface BandObservation {
  receiver: string;
  token: TokenBand;
  balance: bigint;
  priceUsd: number;
}

export interface DecideContext {
  economics: EconomicsConfig;
  reserve: ReserveStable;
  reserveBalance: bigint;
  reservePriceUsd: number;
  /** Estimated cost (USD) of submitting a rebalance tx on this chain. */
  gasCostUsd: number;
  nowSec: number;
  /** Last action time per key (seconds), for cooldown. */
  cooldowns: Map<string, number>;
  /** When each currently-breached key was first observed breached (seconds), for max-staleness. */
  breachSince: Map<string, number>;
}
