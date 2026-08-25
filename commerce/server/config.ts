import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { JSON_SCHEMA, load as yamlLoad } from "js-yaml";
import {
  SOLANA_KNOWN_MINTS,
  type SolanaChainConfig,
  type SolanaNetworksConfig,
} from "onchain-invoice";
import { DEFAULT_ONRAMPER_FIATS } from "../shared/onramper.js";
export interface RateLimitConfig {
  /** Max invoice creates per IP per second (default 1). */
  createPerSecond: number;
  publicPerIpPerSecond: number;
  sweeperPerIpPerSecond: number;
  /** Sustained Onramper quote/methods requests per IP per second (default 2). */
  quotePerSecond: number;
  /** Burst capacity for quote/methods (default 20). */
  quoteBurst: number;
}

export type EvmTokenConfig = {
  address: string;
  decimals?: number;
};

/** Per product chainId (`11155111`, `8453`, `56`). */
export type EvmChainConfig = {
  rpcUrl?: string;
  sweeperAddress?: string;
  forwarderImplementation?: string;
  tokens?: Record<string, EvmTokenConfig>;
};

export type EvmNetworksConfig = Record<string, EvmChainConfig>;

export interface AppConfig {
  port: number;
  baseUrl: string;
  dbPath: string;
  sweeperApiKey: string;
  adminApiKey: string;
  /**
   * Per-chainId EVM settlement config (preferred).
   * Legacy flat `EVM_RPC_URL` / `SWEEPER_ADDRESS` synthesize `11155111` when `evm.chains` is absent.
   */
  evmChains: EvmNetworksConfig;
  /** @deprecated Prefer `resolveEvmChain(config.evmChains, chainId)`. Sepolia / flat-env mirror. */
  evmRpcUrl?: string;
  /** @deprecated Prefer `resolveEvmChain(config.evmChains, chainId)`. */
  sweeperAddress?: string;
  /** @deprecated Prefer `resolveEvmChain(config.evmChains, chainId)`. */
  forwarderImplementation?: string;
  sweeperPrivateKey?: string;
  /** Nile (or other) Tron full node host for EOA address derivation. */
  tronFullHost?: string;
  /** Master secret for deterministic Tron invoice EOAs. */
  tronInvoiceMasterSecret?: string;
  /** Optional Nile USDT TRC-20 contract (documented for operators; sweeper uses its own YAML). */
  tronUsdtAddress?: string;
  /**
   * Solana networks keyed by product chainId (`devnet`, `mainnet-beta`).
   * Runtime only differs by which entry is looked up.
   */
  solanaChains: SolanaNetworksConfig;
  captchaProvider?: string;
  turnstileSecret?: string;
  corsOrigins: string[];
  rateLimit: RateLimitConfig;
  claimLeaseMs: number;
  configPath?: string;
  /** Operator-gated Onramper card/bank onramp. Default off. */
  onramper: OnramperConfig;
  /** Passkey smart wallet factory (Sepolia / per-chain). */
  wallet: WalletConfig;
  /** Testnet faucet for fiat-only invoice e2e (secret-gated). */
  faucet: FaucetConfig;
}

export interface FaucetConfig {
  /** Master switch; default on unless FAUCET_ENABLED=0/false/no. */
  enabled: boolean;
  /** Shared secret typed on /pay. Empty → not publicly usable. */
  secret?: string;
  /** EVM funding key; falls back to sweeperPrivateKey. */
  privateKey?: string;
  /** Tron Nile funding key (FAUCET_TRON_PRIVATE_KEY or TRON_SPONSOR_PRIVATE_KEY). */
  tronPrivateKey?: string;
  /** Test-only: skip on-chain transfer after validation. */
  dryRun: boolean;
}

export interface WalletConfig {
  chainId: string;
  factoryAddress?: string;
  recoveryAddress?: string;
  implementationAddress?: string;
  recoveryTimelockSeconds: number;
  rpcUrl?: string;
  entryPointAddress: string;
  bundlerFeeUsdc: bigint;
  bundlerBeneficiary?: string;
  feeTokenAddress?: string;
  feeTokenSymbol: string;
  feeTokenDecimals: number;
  chains: WalletChainEntry[];
}

export interface WalletChainEntry {
  chainId: string;
  factoryAddress: string;
  rpcUrl?: string;
  feeTokenAddress?: string;
  feeTokenSymbol: string;
  feeTokenDecimals: number;
  networkLabel: string;
}

export interface OnramperConfig {
  enabled: boolean;
  /**
   * True when card/bank UX is on without live Onramper keys (testnet).
   * Session returns a local demo page instead of buy.onramper.com/.dev.
   */
  demo: boolean;
  apiKey?: string;
  /** Ed25519 PEM (V2) or dashboard HMAC hex (V1). Never expose publicly. */
  signingKey?: string;
  /** HMAC secret for `X-Onramper-Webhook-Signature`. Optional. */
  webhookSecret?: string;
  widgetOrigin: string;
  fiats: string[];
}

interface YamlFile {
  port?: number;
  baseUrl?: string;
  db?: { path?: string };
  adminApiKey?: string;
  sweeperApiKey?: string;
  evm?: {
    /** Preferred: per-chainId map */
    chains?: EvmNetworksConfig;
    /** @deprecated flat single-chain fields — mapped to `11155111` when `chains` absent */
    rpcUrl?: string;
    sweeperAddress?: string;
    forwarderImplementation?: string;
    sweeperPrivateKey?: string;
  };
  tron?: {
    fullHost?: string;
    invoiceMasterSecret?: string;
    usdtAddress?: string;
  };
  solana?: {
    /** Preferred: per-chainId map */
    chains?: SolanaNetworksConfig;
    /** @deprecated flat single-chain fields — mapped to `devnet` when `chains` absent */
    rpcUrl?: string;
    programId?: string;
    usdcMint?: string;
    usdtMint?: string;
  };
  captcha?: { provider?: string; turnstileSecret?: string };
  cors?: { origins?: string[] };
  rateLimit?: Partial<RateLimitConfig>;
  claimLeaseMs?: number;
  onramper?: {
    enabled?: boolean;
    apiKey?: string;
    signingKey?: string;
    webhookSecret?: string;
    widgetOrigin?: string;
    fiats?: string[];
  };
  faucet?: {
    enabled?: boolean;
    secret?: string;
    privateKey?: string;
    tronPrivateKey?: string;
  };
  wallet?: {
    chainId?: string;
    factoryAddress?: string;
    recoveryAddress?: string;
    implementationAddress?: string;
    rpcUrl?: string;
    recoveryTimelockSeconds?: number | string;
    entryPointAddress?: string;
    bundlerFeeUsdc?: string | number;
    bundlerBeneficiary?: string;
    feeTokenAddress?: string;
    feeTokenSymbol?: string;
    feeTokenDecimals?: number;
  };
}

/** Sepolia product chainId used when synthesizing legacy flat EVM env. */
export const EVM_LEGACY_CHAIN_ID = "11155111";

/**
 * Resolve EVM settlement config for a product chainId.
 * Returns undefined when the chain has no sweeper address (create should 503).
 * Operators should also set `forwarderImplementation` for offline CREATE2; RPC is a fallback.
 */
export function resolveEvmChain(
  chains: EvmNetworksConfig | undefined,
  chainId: string | null | undefined
): EvmChainConfig | undefined {
  if (!chains || !chainId) return undefined;
  const chain = chains[String(chainId)];
  if (!chain?.sweeperAddress) return undefined;
  return chain;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configPath = env.CONFIG_PATH ? resolve(env.CONFIG_PATH) : undefined;
  const file = configPath && existsSync(configPath) ? readYamlFile(configPath) : {};

  const port = Number(env.PORT ?? file.port ?? 8080);
  const evmChains = loadEvmChains(env, file.evm);
  const legacy = evmChains[EVM_LEGACY_CHAIN_ID];
  const dbPathRaw = expand(env.DB_PATH ?? file.db?.path ?? "./trustless-commerce.db");
  // better-sqlite3 treats ":memory:" specially — do not path-resolve it into a real file.
  const dbPath = dbPathRaw === ":memory:" ? ":memory:" : resolve(dbPathRaw);
  return {
    port,
    baseUrl: expand(env.BASE_URL ?? file.baseUrl ?? `http://localhost:${port}`),
    dbPath,
    sweeperApiKey: expand(env.SWEEPER_API_KEY ?? file.sweeperApiKey ?? ""),
    adminApiKey: expand(env.ADMIN_API_KEY ?? file.adminApiKey ?? ""),
    evmChains,
    evmRpcUrl: legacy?.rpcUrl,
    sweeperAddress: legacy?.sweeperAddress,
    forwarderImplementation: legacy?.forwarderImplementation,
    sweeperPrivateKey: blankToUndefined(expand(env.SWEEPER_PRIVATE_KEY ?? file.evm?.sweeperPrivateKey ?? "")),
    tronFullHost: blankToUndefined(expand(env.TRON_FULL_HOST ?? file.tron?.fullHost ?? "")),
    tronInvoiceMasterSecret: blankToUndefined(
      expand(env.TRON_INVOICE_MASTER_SECRET ?? file.tron?.invoiceMasterSecret ?? "")
    ),
    tronUsdtAddress: blankToUndefined(expand(env.TRON_USDT_ADDRESS ?? file.tron?.usdtAddress ?? "")),
    solanaChains: loadSolanaChains(env, file.solana),
    captchaProvider: blankToUndefined(expand(env.CAPTCHA_PROVIDER ?? file.captcha?.provider ?? "")),
    turnstileSecret: blankToUndefined(expand(env.TURNSTILE_SECRET ?? file.captcha?.turnstileSecret ?? "")),
    corsOrigins: parseOrigins(env.CORS_ORIGINS, file.cors?.origins),
    rateLimit: {
      createPerSecond: Number(env.RATE_LIMIT_CREATE_PER_SECOND ?? file.rateLimit?.createPerSecond ?? 1),
      publicPerIpPerSecond: Number(env.RATE_LIMIT_PUBLIC_PER_SECOND ?? file.rateLimit?.publicPerIpPerSecond ?? 20),
      sweeperPerIpPerSecond: Number(env.RATE_LIMIT_SWEEPER_PER_SECOND ?? file.rateLimit?.sweeperPerIpPerSecond ?? 50),
      quotePerSecond: Number(env.RATE_LIMIT_QUOTE_PER_SECOND ?? file.rateLimit?.quotePerSecond ?? 2),
      quoteBurst: Number(env.RATE_LIMIT_QUOTE_BURST ?? file.rateLimit?.quoteBurst ?? 20),
    },
    claimLeaseMs: Number(env.CLAIM_LEASE_MS ?? file.claimLeaseMs ?? 180_000),
    configPath,
    onramper: loadOnramperConfig(env, file.onramper),
    wallet: loadWalletConfig(env, legacy?.rpcUrl, evmChains, file.wallet),
    faucet: loadFaucetConfig(env, file.faucet, {
      sweeperPrivateKey: blankToUndefined(expand(env.SWEEPER_PRIVATE_KEY ?? file.evm?.sweeperPrivateKey ?? "")),
    }),
  };
}

function loadFaucetConfig(
  env: NodeJS.ProcessEnv,
  file: YamlFile["faucet"] | undefined,
  deps: { sweeperPrivateKey?: string }
): FaucetConfig {
  const enabledRaw = (env.FAUCET_ENABLED ?? "").trim();
  const explicitlyOff =
    enabledRaw === "0" ||
    enabledRaw.toLowerCase() === "false" ||
    enabledRaw.toLowerCase() === "no" ||
    file?.enabled === false;
  const enabled = !explicitlyOff;

  const secret = blankToUndefined(expand(env.FAUCET_SECRET ?? file?.secret ?? ""));
  const privateKey =
    blankToUndefined(expand(env.FAUCET_PRIVATE_KEY ?? file?.privateKey ?? "")) ?? deps.sweeperPrivateKey;
  const tronPrivateKey = blankToUndefined(
    expand(env.FAUCET_TRON_PRIVATE_KEY ?? env.TRON_SPONSOR_PRIVATE_KEY ?? file?.tronPrivateKey ?? "")
  );
  const dryRunRaw = (env.FAUCET_DRY_RUN ?? "").trim().toLowerCase();
  const dryRun = dryRunRaw === "1" || dryRunRaw === "true" || dryRunRaw === "yes";

  return { enabled, secret, privateKey, tronPrivateKey, dryRun };
}

function loadWalletConfig(
  env: NodeJS.ProcessEnv,
  fallbackRpc?: string,
  evmChains?: EvmNetworksConfig,
  file?: YamlFile["wallet"]
): WalletConfig {
  const chainId = blankToUndefined(expand(env.WALLET_CHAIN_ID ?? file?.chainId ?? "")) ?? "11155111";
  const timelock = Number(env.WALLET_RECOVERY_TIMELOCK ?? file?.recoveryTimelockSeconds ?? "259200");
  const feeOverride =
    env[`WALLET_${chainId}_BUNDLER_FEE_USDC`] ??
    env.WALLET_BUNDLER_FEE_USDC ??
    (file?.bundlerFeeUsdc != null ? String(file.bundlerFeeUsdc) : undefined) ??
    "100000";
  const feeAtoms = BigInt(feeOverride || "100000");
  const entryPoint =
    blankToUndefined(expand(env.WALLET_ENTRYPOINT_ADDRESS ?? file?.entryPointAddress ?? "")) ??
    "0x433709009B8330FDa32311DF1C2AFA402eD8D009";
  const sepoliaUsdc = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
  // Published Sepolia passkey wallet (data/wallet-deploy-sepolia.json).
  const sepoliaFactory = "0x2b245a20589c745B11F8a69C677F891e8175a550";
  const sepoliaImpl = "0x297CF0F47e9f6dAd3903694dE531abaD83CE8AAA";
  const sepoliaRecovery = "0x87CB1c5eD04959A51A7CACe8eA2787791F9cE347";
  let factoryAddress = blankToUndefined(expand(env.WALLET_FACTORY_ADDRESS ?? file?.factoryAddress ?? ""));
  let implementationAddress = blankToUndefined(
    expand(env.WALLET_IMPLEMENTATION_ADDRESS ?? file?.implementationAddress ?? "")
  );
  let recoveryAddress = blankToUndefined(expand(env.WALLET_RECOVERY_ADDRESS ?? file?.recoveryAddress ?? ""));
  if (chainId === "11155111") {
    factoryAddress ??= sepoliaFactory;
    implementationAddress ??= sepoliaImpl;
    recoveryAddress ??= sepoliaRecovery;
  }
  const rpcUrl = blankToUndefined(
    expand(env.WALLET_RPC_URL ?? file?.rpcUrl ?? env.EVM_RPC_URL ?? fallbackRpc ?? "")
  );
  const feeTokenAddress = blankToUndefined(
    expand(env.WALLET_BUNDLER_FEE_TOKEN ?? env.WALLET_FEE_TOKEN ?? file?.feeTokenAddress ?? sepoliaUsdc)
  );
  const feeTokenSymbol = expand(env.WALLET_FEE_TOKEN_SYMBOL ?? file?.feeTokenSymbol ?? "USDC");
  const feeTokenDecimals = Number(env.WALLET_FEE_TOKEN_DECIMALS ?? file?.feeTokenDecimals ?? "6") || 6;

  const chains = loadWalletChains(env, {
    chainId,
    factoryAddress,
    rpcUrl,
    feeTokenAddress,
    feeTokenSymbol,
    feeTokenDecimals,
    evmChains,
  });

  return {
    chainId,
    factoryAddress,
    recoveryAddress,
    implementationAddress,
    recoveryTimelockSeconds: Number.isFinite(timelock) ? timelock : 259200,
    rpcUrl,
    entryPointAddress: entryPoint,
    bundlerFeeUsdc: feeAtoms,
    bundlerBeneficiary: blankToUndefined(expand(env.WALLET_BUNDLER_BENEFICIARY ?? file?.bundlerBeneficiary ?? "")),
    feeTokenAddress,
    feeTokenSymbol,
    feeTokenDecimals,
    chains,
  };
}

const CHAIN_LABELS: Record<string, string> = {
  "11155111": "Sepolia",
  "8453": "Base",
  "56": "BNB Chain",
  "1": "Ethereum",
};

function loadWalletChains(
  env: NodeJS.ProcessEnv,
  base: {
    chainId: string;
    factoryAddress?: string;
    rpcUrl?: string;
    feeTokenAddress?: string;
    feeTokenSymbol: string;
    feeTokenDecimals: number;
    evmChains?: EvmNetworksConfig;
  }
): WalletChainEntry[] {
  const rawJson = blankToUndefined(expand(env.WALLET_CHAINS ?? ""));
  if (rawJson) {
    try {
      const parsed = JSON.parse(rawJson) as WalletChainEntry[];
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {
      /* fall through */
    }
  }
  if (!base.factoryAddress) return [];
  const entries: WalletChainEntry[] = [];
  const seen = new Set<string>();
  const add = (chainId: string, rpcUrl?: string, feeToken?: string) => {
    if (seen.has(chainId)) return;
    seen.add(chainId);
    entries.push({
      chainId,
      factoryAddress: base.factoryAddress!,
      rpcUrl: rpcUrl || base.rpcUrl,
      feeTokenAddress: feeToken ?? base.feeTokenAddress,
      feeTokenSymbol: base.feeTokenSymbol,
      feeTokenDecimals: base.feeTokenDecimals,
      networkLabel: CHAIN_LABELS[chainId] ?? `Chain ${chainId}`,
    });
  };
  add(base.chainId, base.rpcUrl, base.feeTokenAddress);
  if (base.evmChains) {
    for (const [id, chain] of Object.entries(base.evmChains)) {
      if (chain.rpcUrl) add(id, chain.rpcUrl);
    }
  }
  return entries;
}

function loadOnramperConfig(
  env: NodeJS.ProcessEnv,
  file: YamlFile["onramper"] | undefined
): OnramperConfig {
  const enabledRaw = (env.ONRAMPER_ENABLED ?? "").trim();
  const apiKey = blankToUndefined(expand(env.ONRAMPER_API_KEY ?? file?.apiKey ?? ""));
  const signingKey = blankToUndefined(expand(env.ONRAMPER_SIGNING_KEY ?? file?.signingKey ?? ""));
  const webhookSecret = blankToUndefined(expand(env.ONRAMPER_WEBHOOK_SECRET ?? file?.webhookSecret ?? ""));
  const widgetOriginExplicit = blankToUndefined(
    expand(env.ONRAMPER_WIDGET_ORIGIN ?? file?.widgetOrigin ?? "")
  );
  const widgetOrigin =
    widgetOriginExplicit ??
    (apiKey?.startsWith("pk_test") ? "https://buy.onramper.dev" : "https://buy.onramper.com");
  const fiatsFromEnv = env.ONRAMPER_FIATS?.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
  const fiats =
    fiatsFromEnv && fiatsFromEnv.length > 0
      ? fiatsFromEnv
      : file?.fiats?.map((s) => String(s).trim().toUpperCase()).filter(Boolean) ??
        [...DEFAULT_ONRAMPER_FIATS];

  const explicitlyOff =
    enabledRaw === "0" ||
    enabledRaw.toLowerCase() === "false" ||
    enabledRaw.toLowerCase() === "no";

  const explicitlyOn =
    enabledRaw === "1" ||
    enabledRaw.toLowerCase() === "true" ||
    enabledRaw.toLowerCase() === "yes" ||
    file?.enabled === true;

  const hasLiveKeys = Boolean(apiKey && signingKey);

  // Live keys → on by default. Explicit ONRAMPER_ENABLED=1 → on even without keys (testnet demo).
  const flagOn =
    !explicitlyOff && (explicitlyOn || (enabledRaw === "" && file?.enabled !== false && hasLiveKeys));

  const enabled = flagOn && (hasLiveKeys || explicitlyOn);
  const demo = enabled && !hasLiveKeys;

  return {
    enabled,
    demo,
    apiKey,
    signingKey,
    webhookSecret,
    widgetOrigin: demo
      ? widgetOriginExplicit ?? "https://buy.onramper.dev"
      : widgetOrigin,
    fiats,
  };
}

function loadEvmChains(env: NodeJS.ProcessEnv, fileEvm: YamlFile["evm"] | undefined): EvmNetworksConfig {
  const fromFile = expandEvmChains(fileEvm?.chains);
  if (Object.keys(fromFile).length > 0) {
    return mergeEnvEvmOverrides(fromFile, env);
  }

  // Legacy flat env / yaml → synthesize Sepolia `11155111`.
  const rpcUrl = blankToUndefined(expand(env.EVM_RPC_URL ?? fileEvm?.rpcUrl ?? ""));
  const sweeperAddress = normalizeAddress(expand(env.SWEEPER_ADDRESS ?? fileEvm?.sweeperAddress ?? ""));
  const forwarderImplementation = normalizeAddress(
    expand(env.FORWARDER_IMPLEMENTATION ?? fileEvm?.forwarderImplementation ?? "")
  );

  const chains: EvmNetworksConfig = {};
  if (rpcUrl || sweeperAddress || forwarderImplementation) {
    chains[EVM_LEGACY_CHAIN_ID] = { rpcUrl, sweeperAddress, forwarderImplementation };
  }
  return mergeEnvEvmOverrides(chains, env);
}

function expandEvmChains(chains: EvmNetworksConfig | undefined): EvmNetworksConfig {
  if (!chains) return {};
  const out: EvmNetworksConfig = {};
  for (const [id, chain] of Object.entries(chains)) {
    const tokens: EvmChainConfig["tokens"] = {};
    for (const [symbol, token] of Object.entries(chain.tokens ?? {})) {
      const address = normalizeAddress(expand(token.address ?? ""));
      if (!address) continue;
      tokens[symbol.toUpperCase()] = {
        address,
        decimals: token.decimals,
      };
    }
    out[String(id)] = {
      rpcUrl: blankToUndefined(expand(chain.rpcUrl ?? "")),
      sweeperAddress: normalizeAddress(expand(chain.sweeperAddress ?? "")),
      forwarderImplementation: normalizeAddress(expand(chain.forwarderImplementation ?? "")),
      tokens: Object.keys(tokens).length > 0 ? tokens : undefined,
    };
  }
  return out;
}

/**
 * Apply `EVM_<chainId>_RPC_URL` / `_SWEEPER_ADDRESS` / `_FORWARDER_IMPLEMENTATION`
 * and legacy flat Sepolia env onto the map (live env wins over YAML blanks).
 */
function mergeEnvEvmOverrides(chains: EvmNetworksConfig, env: NodeJS.ProcessEnv): EvmNetworksConfig {
  const out: EvmNetworksConfig = { ...chains };

  for (const [key, raw] of Object.entries(env)) {
    const match = /^EVM_(\d+)_(RPC_URL|SWEEPER_ADDRESS|FORWARDER_IMPLEMENTATION)$/.exec(key);
    if (!match || raw == null) continue;
    const chainId = match[1]!;
    const field = match[2]!;
    const value = expand(String(raw));
    const prev = out[chainId] ?? {};
    if (field === "RPC_URL") {
      const rpcUrl = blankToUndefined(value);
      if (rpcUrl) out[chainId] = { ...prev, rpcUrl };
    } else if (field === "SWEEPER_ADDRESS") {
      const sweeperAddress = normalizeAddress(value);
      if (sweeperAddress) out[chainId] = { ...prev, sweeperAddress };
    } else {
      const forwarderImplementation = normalizeAddress(value);
      if (forwarderImplementation) out[chainId] = { ...prev, forwarderImplementation };
    }
  }

  // Legacy flat env → Sepolia (covers docker -e after config mount).
  const legacyRpc = blankToUndefined(expand(env.EVM_RPC_URL ?? ""));
  const legacySweeper = normalizeAddress(expand(env.SWEEPER_ADDRESS ?? ""));
  const legacyForwarder = normalizeAddress(expand(env.FORWARDER_IMPLEMENTATION ?? ""));
  if (legacyRpc || legacySweeper || legacyForwarder) {
    const prev = out[EVM_LEGACY_CHAIN_ID] ?? {};
    out[EVM_LEGACY_CHAIN_ID] = {
      ...prev,
      rpcUrl: legacyRpc ?? prev.rpcUrl,
      sweeperAddress: legacySweeper ?? prev.sweeperAddress,
      forwarderImplementation: legacyForwarder ?? prev.forwarderImplementation,
    };
  }

  return out;
}

function loadSolanaChains(
  env: NodeJS.ProcessEnv,
  fileSolana: YamlFile["solana"] | undefined
): SolanaNetworksConfig {
  const fromFile = expandSolanaChains(fileSolana?.chains);
  if (Object.keys(fromFile).length > 0) {
    return mergeEnvSolanaOverrides(fromFile, env);
  }

  // Legacy flat env / yaml → synthesize `devnet` (+ disabled mainnet placeholders).
  const programId = blankToUndefined(expand(env.SOLANA_PROGRAM_ID ?? fileSolana?.programId ?? ""));
  const rpcUrl = blankToUndefined(expand(env.SOLANA_RPC_URL ?? fileSolana?.rpcUrl ?? ""));
  const usdcMint = blankToUndefined(
    expand(env.SOLANA_USDC_MINT ?? fileSolana?.usdcMint ?? SOLANA_KNOWN_MINTS.devnet.USDC.mint)
  );
  const usdtMint = blankToUndefined(
    expand(env.SOLANA_USDT_MINT ?? fileSolana?.usdtMint ?? SOLANA_KNOWN_MINTS.devnet.USDT.mint)
  );

  const chains: SolanaNetworksConfig = {
    "mainnet-beta": {
      enabled: false,
      rpcUrl: "https://api.mainnet-beta.solana.com",
      programId: "PLACEHOLDER_MAINNET_PROGRAM_ID",
      tokens: {
        USDC: { ...SOLANA_KNOWN_MINTS["mainnet-beta"].USDC },
        USDT: { ...SOLANA_KNOWN_MINTS["mainnet-beta"].USDT },
      },
    },
  };

  if (programId) {
    const tokens: SolanaChainConfig["tokens"] = {};
    if (usdcMint) tokens.USDC = { mint: usdcMint, decimals: 6 };
    if (usdtMint) tokens.USDT = { mint: usdtMint, decimals: 6 };
    chains.devnet = {
      enabled: true,
      rpcUrl: rpcUrl ?? "https://api.devnet.solana.com",
      programId,
      tokens,
    };
  } else {
    chains.devnet = {
      enabled: false,
      rpcUrl: rpcUrl ?? "https://api.devnet.solana.com",
      programId: "PLACEHOLDER_DEVNET_PROGRAM_ID",
      tokens: {
        USDC: { ...SOLANA_KNOWN_MINTS.devnet.USDC },
        USDT: { mint: usdtMint ?? SOLANA_KNOWN_MINTS.devnet.USDT.mint, decimals: 6 },
      },
    };
  }

  return mergeEnvSolanaOverrides(chains, env);
}

function expandSolanaChains(chains: SolanaNetworksConfig | undefined): SolanaNetworksConfig {
  if (!chains) return {};
  const out: SolanaNetworksConfig = {};
  for (const [id, chain] of Object.entries(chains)) {
    const tokens: SolanaChainConfig["tokens"] = {};
    for (const [symbol, token] of Object.entries(chain.tokens ?? {})) {
      const mint = blankToUndefined(expand(token.mint ?? ""));
      if (!mint) continue;
      tokens[symbol.toUpperCase()] = {
        mint,
        decimals: token.decimals ?? 6,
      };
    }
    out[id] = {
      enabled: chain.enabled,
      rpcUrl: blankToUndefined(expand(chain.rpcUrl ?? "")),
      programId: expand(chain.programId ?? ""),
      feeRecipient: blankToUndefined(expand(chain.feeRecipient ?? "")),
      feeBps: chain.feeBps,
      tokens,
    };
  }
  return out;
}

function mergeEnvSolanaOverrides(chains: SolanaNetworksConfig, env: NodeJS.ProcessEnv): SolanaNetworksConfig {
  const out = { ...chains };
  // Prefer live env over YAML-expanded blanks (covers docker -e after config mount).
  if (out.devnet) {
    const programId =
      blankToUndefined(expand(env.SOLANA_PROGRAM_ID ?? "")) ?? blankToUndefined(out.devnet.programId);
    const rpcUrl =
      blankToUndefined(expand(env.SOLANA_RPC_URL ?? "")) ?? out.devnet.rpcUrl ?? "https://api.devnet.solana.com";
    const tokens = { ...out.devnet.tokens };
    const usdc = blankToUndefined(expand(env.SOLANA_USDC_MINT ?? ""));
    const usdt = blankToUndefined(expand(env.SOLANA_USDT_MINT ?? ""));
    if (usdc) tokens.USDC = { mint: usdc, decimals: tokens.USDC?.decimals ?? 6 };
    if (usdt) tokens.USDT = { mint: usdt, decimals: tokens.USDT?.decimals ?? 6 };
    if (!tokens.USDC) tokens.USDC = { ...SOLANA_KNOWN_MINTS.devnet.USDC };
    out.devnet = {
      ...out.devnet,
      enabled: out.devnet.enabled !== false && Boolean(programId),
      programId: programId ?? out.devnet.programId,
      rpcUrl,
      tokens,
    };
  }
  const enableMainnet = env.SOLANA_MAINNET_ENABLED === "1" || env.SOLANA_MAINNET_ENABLED === "true";
  const mainnetProgram = blankToUndefined(expand(env.SOLANA_MAINNET_PROGRAM_ID ?? ""));
  if (out["mainnet-beta"]) {
    out["mainnet-beta"] = {
      ...out["mainnet-beta"],
      enabled: enableMainnet && Boolean(mainnetProgram),
      programId: mainnetProgram ?? out["mainnet-beta"].programId,
      rpcUrl: blankToUndefined(expand(env.SOLANA_MAINNET_RPC_URL ?? "")) ?? out["mainnet-beta"].rpcUrl,
    };
  }
  return out;
}

function readYamlFile(path: string): YamlFile {
  const raw = readFileSync(path, "utf8");
  const expanded = expand(raw);
  // JSON_SCHEMA keeps 0x… keys/addresses as strings (YAML 1.1 int parsing corrupts them).
  return (yamlLoad(expanded, { schema: JSON_SCHEMA }) as YamlFile) ?? {};
}

/** Expand ${ENV} placeholders. */
export function expand(value: string): string {
  return value.replace(/\$\{([A-Z0-9_]+)\}/g, (_, key: string) => process.env[key] ?? "");
}

function parseOrigins(envValue: string | undefined, fileOrigins: string[] | undefined): string[] {
  if (envValue?.trim()) {
    return envValue.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (fileOrigins?.length) return fileOrigins;
  return ["*"];
}

function blankToUndefined(value: string | undefined): string | undefined {
  return value?.trim() ? value.trim() : undefined;
}

function normalizeAddress(value: string | undefined): string | undefined {
  const trimmed = blankToUndefined(value);
  if (!trimmed) return undefined;
  if (/^0x0{40}$/i.test(trimmed)) return undefined;
  return trimmed;
}
