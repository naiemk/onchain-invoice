import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "yaml";
import type { FastSwapChainConfig, FastSwapPack, FastSwapTokenConfig, FastSwapTokenPriceSourceConfig } from "../app/fastswap/shared/types.js";

export type DemoYamlConfig = {
  server: {
    host: string;
    apiPort: number;
    uiPort: number;
    adminPort: number;
    nodeApiKey: string;
    captchaToken: string;
  };
  wallet: {
    privateKey: string;
  };
  quote: {
    feeBps: number | string;
    maxDeviationBps: number | string;
    packsUsdMicros: string[];
  };
  sweepNode: {
    pollIntervalMs: number;
    pageLimit: number;
    confirmations: number;
    logScanOverlap: number;
  };
  relayNode: {
    pollIntervalMs: number;
  };
  seedInvoice: {
    enabled: boolean;
    usdAmountMicros: string;
  };
  chains: DemoChainConfig[];
};

export type DemoChainConfig = {
  key: string;
  demoDeploy?: boolean;
  id: string;
  type?: "evm" | "tron";
  mockChainId?: string | number | bigint;
  name: string;
  rpcPort?: number;
  rpcUrl?: string;
  /** TRON HTTP endpoint (TronWeb fullHost). Defaults to rpcUrl when omitted. */
  fullHost?: string;
  /** TRON fee limit in SUN for sweep/relay txs. */
  feeLimit?: number;
  sweeperAddress?: string;
  fastSwapAddress?: string;
  explorerUrl?: string;
  nativeSymbol: string;
  nativePriceUsdMicros?: string;
  nativeInitialLiquidity?: string;
  nativeMinLiquidity?: string;
  stableTokenName?: string;
  stableTokenSymbol?: string;
  stableTokenDecimals?: number;
  stablePriceUsdMicros?: string;
  stableOwnerMint?: string;
  stableInitialLiquidity?: string;
  stableMinLiquidity?: string;
  tokens?: FastSwapTokenConfig[];
};

export const DEMO_CONFIG_PATH = join(process.cwd(), "fastSwapDemo", "config.yaml");
export const DEMO_CONFIG = parse(readFileSync(DEMO_CONFIG_PATH, "utf8")) as DemoYamlConfig;
export const DEMO_HOST = DEMO_CONFIG.server.host;
export const DEMO_CHAIN_CONFIGS = DEMO_CONFIG.chains.map(resolveRuntimeValues);
export const DEMO_RUNTIME_CHAINS = DEMO_CHAIN_CONFIGS.map(toRuntimeChain);
export const DEMO_DEPLOY_CHAINS = DEMO_RUNTIME_CHAINS.filter((chain) => chain.demoDeploy !== false);

export const API_PORT = DEMO_CONFIG.server.apiPort;
export const UI_PORT = DEMO_CONFIG.server.uiPort;
export const ADMIN_PORT = DEMO_CONFIG.server.adminPort;
export const NODE_API_KEY = DEMO_CONFIG.server.nodeApiKey;
export const DEMO_CAPTCHA_TOKEN = DEMO_CONFIG.server.captchaToken;
export const DEMO_PRIVATE_KEY = DEMO_CONFIG.wallet.privateKey;
export const FASTSWAP_DEMO_FEE_BPS = BigInt(DEMO_CONFIG.quote.feeBps);
export const FASTSWAP_DEMO_MAX_DEVIATION_BPS = BigInt(DEMO_CONFIG.quote.maxDeviationBps);
export const FASTSWAP_DEMO_PACKS: FastSwapPack[] = DEMO_CONFIG.quote.packsUsdMicros.map((usdAmountMicros) => ({ usdAmountMicros }));
export const DEMO_SWEEP_NODE = DEMO_CONFIG.sweepNode;
export const DEMO_RELAY_NODE = DEMO_CONFIG.relayNode;
export const DEMO_SEED_INVOICE = DEMO_CONFIG.seedInvoice;

export type DemoDeployment = {
  chains: DemoChainDeployment[];
  /** Legacy fields kept so older state/deployment.json files still load. */
  alice?: DemoChainDeployment;
  bob?: DemoChainDeployment;
};

export type DemoChainDeployment = {
  id: string;
  name: string;
  rpcUrl: string;
  receiver: string;
  sweeper: string;
  fastSwap: string;
  nativeSymbol: string;
  explorerUrl?: string;
  tokens: {
    native: string;
    nativePriceUsdMicros?: string;
    nativeMinLiquidity?: string;
    stable: {
      symbol: string;
      address: string;
      decimals: number;
      priceUsdMicros?: string;
      minLiquidity?: string;
    };
  };
  startBlock: number;
};

export function deploymentChains(deployment: DemoDeployment): DemoChainDeployment[] {
  if (deployment.chains?.length) return deployment.chains;
  return [deployment.alice, deployment.bob].filter((chain): chain is DemoChainDeployment => chain !== undefined);
}

export function toFastSwapChains(deployment: DemoDeployment): FastSwapChainConfig[] {
  const deployed = deploymentChains(deployment).map((chain) => toFastSwapChain(chain, chain.nativeSymbol));
  const deployedIds = new Set(deployed.map((chain) => chain.id));
  const configured = DEMO_RUNTIME_CHAINS
    .filter((chain) => chain.demoDeploy === false && chain.fastSwapAddress && chain.sweeperAddress)
    .map(toConfiguredFastSwapChain)
    .filter((chain) => !deployedIds.has(chain.id));
  return [...deployed, ...configured];
}

function toRuntimeChain(chain: DemoChainConfig) {
  return {
    ...chain,
    mockChainId: BigInt(chain.mockChainId ?? chain.id),
    rpcUrl: chain.rpcUrl ?? `http://${DEMO_HOST}:${requiredNumber(chain.rpcPort, `${chain.key} rpcPort`)}`,
  };
}

function toFastSwapChain(chain: DemoChainDeployment, nativeSymbol: string): FastSwapChainConfig {
  return {
    id: chain.id,
    type: "evm",
    name: chain.name,
    nativeSymbol,
    sweeperAddress: chain.sweeper,
    fastSwapAddress: chain.fastSwap,
    explorerUrl: chain.explorerUrl ?? "",
    tokens: [
      {
        symbol: nativeSymbol,
        chainId: chain.id,
        decimals: 18,
        isNative: true,
        priceUsdMicros: chain.tokens.nativePriceUsdMicros,
        minLiquidity: chain.tokens.nativeMinLiquidity,
      },
      {
        symbol: chain.tokens.stable.symbol,
        chainId: chain.id,
        address: chain.tokens.stable.address,
        decimals: chain.tokens.stable.decimals,
        priceUsdMicros: chain.tokens.stable.priceUsdMicros,
        minLiquidity: chain.tokens.stable.minLiquidity,
      },
    ],
  };
}

function toConfiguredFastSwapChain(chain: DemoChainConfig): FastSwapChainConfig {
  return {
    id: chain.id,
    type: chain.type ?? "evm",
    name: chain.name,
    nativeSymbol: chain.nativeSymbol,
    sweeperAddress: requireConfigString(chain.sweeperAddress, `${chain.key} sweeperAddress`),
    fastSwapAddress: requireConfigString(chain.fastSwapAddress, `${chain.key} fastSwapAddress`),
    explorerUrl: chain.explorerUrl ?? "",
    tokens: (chain.tokens ?? []).map((token) => ({
      ...token,
      chainId: chain.id,
      priceSources: token.priceSources as FastSwapTokenPriceSourceConfig[] | undefined,
    })),
  };
}

function resolveRuntimeValues(chain: DemoChainConfig): DemoChainConfig {
  return JSON.parse(JSON.stringify(chain), (_key, value) => (typeof value === "string" ? expandEnv(value) : value)) as DemoChainConfig;
}

function expandEnv(value: string) {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_match, name: string) => process.env[name] ?? "");
}

function requiredNumber(value: number | undefined, name: string) {
  if (typeof value !== "number") throw new Error(`Missing ${name} in ${DEMO_CONFIG_PATH}`);
  return value;
}

function requireConfigString(value: string | undefined, name: string) {
  if (!value) throw new Error(`Missing ${name} in ${DEMO_CONFIG_PATH}`);
  return value;
}
