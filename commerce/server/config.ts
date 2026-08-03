import "dotenv/config";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { JSON_SCHEMA, load as yamlLoad } from "js-yaml";

export interface RateLimitConfig {
  /** Max invoice creates per IP per second (default 1). */
  createPerSecond: number;
  publicPerIpPerSecond: number;
  sweeperPerIpPerSecond: number;
}

export interface AppConfig {
  port: number;
  baseUrl: string;
  dbPath: string;
  sweeperApiKey: string;
  adminApiKey: string;
  evmRpcUrl?: string;
  sweeperAddress?: string;
  /** Optional; enables offline CREATE2 invoice address prediction without RPC. */
  forwarderImplementation?: string;
  sweeperPrivateKey?: string;
  /** Nile (or other) Tron full node host for EOA address derivation. */
  tronFullHost?: string;
  /** Master secret for deterministic Tron invoice EOAs. */
  tronInvoiceMasterSecret?: string;
  /** Optional Nile USDT TRC-20 contract (documented for operators; sweeper uses its own YAML). */
  tronUsdtAddress?: string;
  /** Solana RPC (optional; address prediction is offline from programId + mint). */
  solanaRpcUrl?: string;
  /** Deployed commerce-invoice program id (base58). */
  solanaProgramId?: string;
  /** USDC mint for Solana invoices (devnet/mainnet). */
  solanaUsdcMint?: string;
  captchaProvider?: string;
  turnstileSecret?: string;
  corsOrigins: string[];
  rateLimit: RateLimitConfig;
  claimLeaseMs: number;
  configPath?: string;
}

interface YamlFile {
  port?: number;
  baseUrl?: string;
  db?: { path?: string };
  adminApiKey?: string;
  sweeperApiKey?: string;
  evm?: {
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
    rpcUrl?: string;
    programId?: string;
    usdcMint?: string;
  };
  captcha?: { provider?: string; turnstileSecret?: string };
  cors?: { origins?: string[] };
  rateLimit?: Partial<RateLimitConfig>;
  claimLeaseMs?: number;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const configPath = env.CONFIG_PATH ? resolve(env.CONFIG_PATH) : undefined;
  const file = configPath && existsSync(configPath) ? readYamlFile(configPath) : {};

  const port = Number(env.PORT ?? file.port ?? 8080);
  return {
    port,
    baseUrl: expand(env.BASE_URL ?? file.baseUrl ?? `http://localhost:${port}`),
    dbPath: resolve(expand(env.DB_PATH ?? file.db?.path ?? "./trustless-commerce.db")),
    sweeperApiKey: expand(env.SWEEPER_API_KEY ?? file.sweeperApiKey ?? ""),
    adminApiKey: expand(env.ADMIN_API_KEY ?? file.adminApiKey ?? ""),
    evmRpcUrl: blankToUndefined(expand(env.EVM_RPC_URL ?? file.evm?.rpcUrl ?? "")),
    sweeperAddress: normalizeAddress(expand(env.SWEEPER_ADDRESS ?? file.evm?.sweeperAddress ?? "")),
    forwarderImplementation: normalizeAddress(
      expand(env.FORWARDER_IMPLEMENTATION ?? file.evm?.forwarderImplementation ?? "")
    ),
    sweeperPrivateKey: blankToUndefined(expand(env.SWEEPER_PRIVATE_KEY ?? file.evm?.sweeperPrivateKey ?? "")),
    tronFullHost: blankToUndefined(expand(env.TRON_FULL_HOST ?? file.tron?.fullHost ?? "")),
    tronInvoiceMasterSecret: blankToUndefined(
      expand(env.TRON_INVOICE_MASTER_SECRET ?? file.tron?.invoiceMasterSecret ?? "")
    ),
    tronUsdtAddress: blankToUndefined(expand(env.TRON_USDT_ADDRESS ?? file.tron?.usdtAddress ?? "")),
    solanaRpcUrl: blankToUndefined(expand(env.SOLANA_RPC_URL ?? file.solana?.rpcUrl ?? "")),
    solanaProgramId: blankToUndefined(expand(env.SOLANA_PROGRAM_ID ?? file.solana?.programId ?? "")),
    solanaUsdcMint: blankToUndefined(expand(env.SOLANA_USDC_MINT ?? file.solana?.usdcMint ?? "")),
    captchaProvider: blankToUndefined(expand(env.CAPTCHA_PROVIDER ?? file.captcha?.provider ?? "")),
    turnstileSecret: blankToUndefined(expand(env.TURNSTILE_SECRET ?? file.captcha?.turnstileSecret ?? "")),
    corsOrigins: parseOrigins(env.CORS_ORIGINS, file.cors?.origins),
    rateLimit: {
      createPerSecond: Number(env.RATE_LIMIT_CREATE_PER_SECOND ?? file.rateLimit?.createPerSecond ?? 1),
      publicPerIpPerSecond: Number(env.RATE_LIMIT_PUBLIC_PER_SECOND ?? file.rateLimit?.publicPerIpPerSecond ?? 20),
      sweeperPerIpPerSecond: Number(env.RATE_LIMIT_SWEEPER_PER_SECOND ?? file.rateLimit?.sweeperPerIpPerSecond ?? 50),
    },
    claimLeaseMs: Number(env.CLAIM_LEASE_MS ?? file.claimLeaseMs ?? 180_000),
    configPath,
  };
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
