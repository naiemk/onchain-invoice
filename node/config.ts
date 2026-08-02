import { readFileSync } from "node:fs";
import type { TronEnergyMode } from "../src/tron-sponsor.js";

function expandEnvDeep<T>(value: T): T {
  return JSON.parse(JSON.stringify(value), (_key, v) =>
    typeof v === "string" ? v.replace(/\$\{([A-Z0-9_]+)\}/g, (_m, name: string) => process.env[name] ?? "") : v
  ) as T;
}

export type SweepNodeConfig = {
  webServer: {
    baseUrl: string;
    nodeApiKey: string;
    pageLimit?: number;
    lookbackMs?: number;
  };
  cache: {
    sqlitePath: string;
  };
  pollIntervalMs?: number;
  reconcileReceiverLimitPerChain?: number;
  auditLogPath?: string;
  /**
   * Optional product-specific invoice parser (e.g. FastSwap HMAC verify).
   * Defaults to extracting chainId / invoiceId / address / data fields.
   */
  parseInvoice?: (value: Record<string, unknown>) => SweepNodeInvoice | undefined;
  /**
   * Optional product-specific track status after payment (e.g. FastSwap swapState).
   * Defaults to `"paid"`.
   */
  resolveTrackStatus?: (inv: SweepNodeInvoice) => Promise<string> | string;
  chains: ChainConfig[];
};

export type ChainConfig = EvmChainConfig | TronChainConfig;

export type TronTokenHint = {
  symbol: string;
  address?: string;
  decimals?: number;
  priceUsd?: number;
  isNative?: boolean;
};

export type BaseChainConfig = {
  id: string;
  /** EVM: sweeper contract. TRON EOA: optional / empty. */
  sweeperAddress?: string;
  /** EVM: receiver. TRON EOA: optional / empty. */
  receiverAddress?: string;
  confirmations?: number;
  logScanChunkSize?: number;
  logScanOverlap?: number;
  sweepBatchSize?: number;
};

export type EvmChainConfig = BaseChainConfig & {
  type: "evm";
  rpcUrl: string;
  privateKey: string;
  startBlock?: number;
  sweeperAddress: string;
  receiverAddress: string;
};

export type TronChainConfig = BaseChainConfig & {
  type: "tron";
  fullHost: string;
  privateKey: string;
  startTimestamp?: number;
  eventPollLimit?: number;
  feeLimit?: number;
  /** `eoa` (default) or legacy `contract`. */
  sweepMode?: "eoa" | "contract";
  invoiceMasterSecret?: string;
  sponsorAddress?: string;
  batchSweepThresholdUsd?: number;
  batchSweepMaxInvoices?: number;
  energyMode?: TronEnergyMode;
  energyRentProvider?: string;
  minDelegateEnergy?: number;
  /** Sun of staked TRX to delegate as BANDWIDTH (Stake 2.0). */
  minDelegateBandwidth?: number;
  tokens?: TronTokenHint[];
};

export type SweepNodeInvoice = {
  chainId: string;
  invoiceId: string;
  invoiceAddress: string;
  data: string;
  token?: string;
  amount?: string | number;
  minAmount?: string | number;
  /** FastSwap (and similar): target chain for swap state when reconciling status. */
  targetChainId?: string;
};

export function loadSweepNodeConfig(path: string): SweepNodeConfig {
  const config = expandEnvDeep(JSON.parse(readTextFile(path)) as SweepNodeConfig);
  validateSweepNodeConfig(config);
  return config;
}

function validateSweepNodeConfig(config: SweepNodeConfig) {
  if (!config.webServer?.baseUrl) throw new Error("webServer.baseUrl is required");
  if (!config.webServer?.nodeApiKey) throw new Error("webServer.nodeApiKey is required");
  if (!config.cache?.sqlitePath) throw new Error("cache.sqlitePath is required");
  if (!Array.isArray(config.chains) || config.chains.length === 0) {
    throw new Error("At least one chain is required");
  }

  for (const chain of config.chains) {
    if (!chain.id) throw new Error("chain.id is required");
    if (chain.type === "evm") {
      if (!chain.sweeperAddress) throw new Error(`${chain.id}: sweeperAddress is required`);
      if (!chain.receiverAddress) throw new Error(`${chain.id}: receiverAddress is required`);
      if (!chain.rpcUrl) throw new Error(`${chain.id}: rpcUrl is required`);
      if (!chain.privateKey) throw new Error(`${chain.id}: privateKey is required`);
    } else if (chain.type === "tron") {
      if (!chain.fullHost) throw new Error(`${chain.id}: fullHost is required`);
      if (!chain.privateKey) throw new Error(`${chain.id}: privateKey is required`);
      const eoa = chain.sweepMode !== "contract";
      if (eoa) {
        if (!chain.invoiceMasterSecret) {
          throw new Error(`${chain.id}: invoiceMasterSecret is required for TRON EOA sweep`);
        }
      } else {
        if (!chain.sweeperAddress) throw new Error(`${chain.id}: sweeperAddress is required for contract mode`);
        if (!chain.receiverAddress) throw new Error(`${chain.id}: receiverAddress is required for contract mode`);
      }
    } else {
      throw new Error(`${(chain as { id?: string }).id ?? "chain"}: unsupported chain type`);
    }
  }
}

function readTextFile(path: string): string {
  return readFileSync(path, "utf8");
}
