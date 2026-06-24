import type {
  FastSwapChainConfig,
  FastSwapTokenConfig,
  FastSwapTokenPriceSourceConfig,
} from "../shared/types.js";

export type FastSwapChainType = "evm" | "tron";

export type FastSwapConfigToken = Omit<FastSwapTokenConfig, "chainId"> & {
  priceSources?: FastSwapTokenPriceSourceConfig[];
};

export type LiquidityTokenBand = {
  symbol: string;
  address?: string;
  decimals: number;
  isStable?: boolean;
  floor: string;
  target: string;
  ceiling: string;
};

export type LiquidityReserveStable = {
  symbol: string;
  address: string;
  decimals: number;
};

export type LiquidityReceiverConfig = {
  /** Defaults to the chain FastSwap receiver when omitted. */
  address?: string;
  tokens: LiquidityTokenBand[];
};

export type ChainLiquidityConfig = {
  reserveStable: LiquidityReserveStable;
  receivers: LiquidityReceiverConfig[];
};

export type TronChainContracts = {
  fastSwapAddress: string;
  sweeperAddress: string;
  forwarderImplementation?: string;
  liquidityManagerAddress?: string;
};

export type FastSwapChainDefinition = {
  key: string;
  id: string;
  type: FastSwapChainType;
  name: string;
  optional?: boolean;
  rpcUrl?: string;
  fullHost?: string;
  feeLimit?: number;
  explorerUrl: string;
  confirmations?: number;
  startBlock?: number;
  startTimestamp?: number;
  aggregatorSlug?: string;
  nativeSentinel?: string;
  router?: string;
  /** Tron-only deployed addresses. EVM chains inherit deploy.contracts. */
  contracts?: TronChainContracts;
  tokens: FastSwapConfigToken[];
  liquidity?: ChainLiquidityConfig;
};

import type { DeploySaltSpec, ResolvedDeploySalts } from "./salts.js";

export type DeployContracts = {
  fastSwapImplementation: string;
  fastSwapAddress: string;
  sweeperAddress: string;
  forwarderImplementation: string;
  liquidityManagerImplementation: string;
  liquidityManagerAddress: string;
};

export type DeployConfig = {
  /** Canonical CreateX factory address (same on all supported EVM chains). */
  createx: string;
  /** @deprecated Use `createx`. Kept for backward compatibility with older configs. */
  create2Factory?: string;
  owner: string;
  /** Human-readable namespace + version; hashed to CREATE2 salts at load. */
  salts: DeploySaltSpec | ResolvedDeploySalts;
  /** Bytes32 salts derived from `salts.namespace` + `salts.version` (set by loader). */
  resolvedSalts?: ResolvedDeploySalts;
  contracts: DeployContracts;
};

export type FastSwapConfigFile = {
  version: number;
  "active-chains": string[];
  server: {
    host: string;
    apiPort: number;
    /** Public URL nodes and UI use (no trailing slash). */
    publicUrl?: string;
    sqlitePath: string;
    auditLogPath: string;
    /** Env var name holding the HMAC signing secret (default API_SIGNING_SECRET). */
    signingSecretEnv?: string;
    /** @deprecated Use signingSecretEnv. */
    nodeApiKey?: string;
    uiPort?: number;
    adminPort?: number;
    captcha: {
      provider: string;
      siteKey: string;
      secretKey: string;
      requireForQuotes?: boolean;
      requireForInvoices?: boolean;
    };
  };
  quote: {
    feeBps: number | string;
    maxDeviationBps: number | string;
    quoteTtlSec: number;
    /** Human USD notionals in on-disk config (e.g. "10" = $10). */
    packsUsd?: string[];
    /** Normalized micro-USD notionals (always set after load). */
    packsUsdMicros: string[];
  };
  sweepNode: {
    pollIntervalMs: number;
    pageLimit: number;
    confirmations: number;
    logScanOverlap: number;
    sqlitePath: string;
  };
  relayNode: {
    pollIntervalMs: number;
    confirmations: number;
  };
  liquidityMonitor: {
    pollIntervalMs: number;
  };
  deploy: DeployConfig;
  liquidityManager: {
    pollIntervalMs: number;
    sqlitePath: string;
    economics: {
      gasGateBps: number;
      minNotionalUsd: number;
      maxStalenessSec: number;
      riskCapUsd: number;
      cooldownSec: number;
      slippageBps: number;
      maxGasPriceGwei?: number;
    };
  };
  nodes: {
    sweep: { auditLogPath: string };
    relay: { progressPath: string; auditLogPath: string };
    liqman: { auditLogPath: string };
  };
  chains: FastSwapChainDefinition[];
};

export type ResolvedChainContracts = {
  fastSwapImplementation: string;
  fastSwapAddress: string;
  sweeperAddress: string;
  forwarderImplementation: string;
  liquidityManagerImplementation: string;
  liquidityManagerAddress: string;
};

export type ResolvedFastSwapChain = FastSwapChainDefinition & {
  contracts: ResolvedChainContracts;
  fastSwap: FastSwapChainConfig;
};
