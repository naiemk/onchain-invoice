import { readFile } from "node:fs/promises";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import {
  CommerceInvoiceSdk,
  COMMERCE_ERC20_ABI,
  COMMERCE_NATIVE_TOKEN,
  deriveTronInvoiceAddress,
  prepareInvoiceResourcesForSweep,
  readTronTokenBalance,
  releaseInvoiceResourcesAfterSweep,
  sweepTrc20FromInvoice,
  tronNumericChainId,
  type TronSponsorConfig,
} from "onchain-invoice";
import { TronWeb } from "tronweb";
import type { InvoiceRecord } from "../shared/types.js";
import { signSweeperRequest } from "../server/sweeper-auth.js";
import { ActivityLog } from "./activity-log.js";
import { load as loadYaml } from "./config-loader.js";

export type SweeperRole = "evm" | "tron" | "all";

export interface SweeperConfig {
  serverUrl: string;
  /** @deprecated Prefer wallet signing via privateKey + registered sweeper */
  apiKey?: string;
  intervalMs?: number;
  /** Private key of the registered sweeper wallet (signs API requests). */
  sweeperWalletKey?: string;
  maxRetries?: number;
  /** Host-persisted JSONL activity log path (bind-mount on VPS). */
  activityLogPath?: string;
  /**
   * Which half of a shared YAML this process should handle.
   * Prefer env `SWEEPER_ROLE=evm|tron|all` (compose dual services).
   */
  role?: SweeperRole;
  chains: EvmChainConfig[];
  tron?: TronSweeperConfig;
  solana?: {
    enabled: boolean;
    note?: string;
  };
}

export interface EvmChainConfig {
  chainId: string | number;
  rpcUrl: string;
  sweeperAddress: string;
  privateKey: string;
  tokens?: Array<{
    symbol: string;
    address: string;
    decimals?: number;
  }>;
}

export interface TronSweeperConfig {
  enabled: boolean;
  note?: string;
  /** Product chain id (`nile`) stored on invoices. */
  chainId?: string;
  fullHost?: string;
  invoiceMasterSecret?: string;
  /** Sponsor / sweep key (energy + bandwidth delegation). Defaults to first EVM privateKey / sweeper wallet. */
  privateKey?: string;
  sponsorPrivateKey?: string;
  usdtAddress?: string;
  feeLimit?: number;
  /**
   * `staked` (default): delegate ENERGY + BANDWIDTH — invoice keeps 0 TRX.
   * `burn`: top up liquid TRX on the invoice (legacy).
   */
  energyMode?: "staked" | "burn" | "rent";
  /** Sun of staked TRX to delegate as ENERGY. */
  minDelegateEnergy?: number;
  /** Sun of staked TRX to delegate as BANDWIDTH. */
  minDelegateBandwidth?: number;
  tokens?: Array<{
    symbol: string;
    address: string;
    decimals?: number;
  }>;
}

const ERC20_ABI = ["function balanceOf(address account) view returns (uint256)"] as const;

export class SweeperWorker {
  private stopped = false;
  private tickInFlight: Promise<void> | null = null;
  private wallet: Wallet | null = null;
  private readonly activity: ActivityLog | null;
  private readonly role: SweeperRole;
  private readonly chains: EvmChainConfig[];
  private tron: TronSweeperConfig | undefined;

  constructor(private readonly config: SweeperConfig) {
    this.role = resolveRole(config);
    this.chains = this.role === "tron" ? [] : config.chains ?? [];
    this.tron =
      this.role === "evm"
        ? undefined
        : config.tron?.enabled
          ? config.tron
          : undefined;

    if (config.sweeperWalletKey) {
      this.wallet = new Wallet(config.sweeperWalletKey);
    } else if (this.chains[0]?.privateKey) {
      this.wallet = new Wallet(this.chains[0].privateKey);
    }
    const logPath = config.activityLogPath?.trim();
    this.activity = logPath ? new ActivityLog(logPath) : null;
  }

  async start(): Promise<void> {
    console.log(
      JSON.stringify({
        level: "info",
        msg: "sweeper role",
        role: this.role,
        evmChains: this.chains.map((c) => String(c.chainId)),
        tronEnabled: Boolean(this.tron?.enabled),
      })
    );
    if (this.config.tron?.enabled && this.role === "evm") {
      console.log(JSON.stringify({ level: "info", msg: "Tron config present but role=evm; skipping Tron" }));
    }
    if (this.config.solana?.enabled) {
      console.warn(
        JSON.stringify({ level: "warn", msg: "Solana sweeper not implemented; skipping", note: this.config.solana.note })
      );
    }
    if (this.tron?.enabled) {
      try {
        assertTronConfig(this.tron);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (this.role === "tron") {
          throw new Error(`Tron sweeper misconfigured: ${message}`);
        }
        console.warn(JSON.stringify({ level: "warn", msg: "Tron enabled but incomplete; skipping", error: message }));
        this.tron = undefined;
      }
    }
    while (!this.stopped) {
      this.tickInFlight = this.tick().catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.error("sweeper tick failed", error);
        this.activity?.append("tick-failed", { payload: { error: message } });
      });
      await this.tickInFlight;
      this.tickInFlight = null;
      if (this.stopped) break;
      await sleep(this.config.intervalMs ?? 15_000);
    }
  }

  /** Request stop and wait for the in-flight tick (claim/sweep) to finish. */
  async stopAndWait(): Promise<void> {
    this.stopped = true;
    if (this.tickInFlight) {
      await this.tickInFlight;
      this.tickInFlight = null;
    }
  }

  /** @deprecated Prefer stopAndWait for graceful Docker stop. */
  stop(): void {
    this.stopped = true;
  }

  async tick(): Promise<void> {
    const invoices = await this.fetchInvoices();
    const readyByChain = new Map<string, Array<{ invoice: InvoiceRecord; token: string | null; balance: bigint }>>();
    const readyTron: Array<{ invoice: InvoiceRecord; token: string; balance: bigint }> = [];

    for (const invoice of invoices) {
      try {
        if (isTronInvoice(invoice)) {
          if (!this.tron?.enabled) continue;
          const prepared = await this.prepareTronInvoice(invoice);
          if (!prepared) continue;
          this.activity?.append("invoice-paid", {
            invoiceId: invoice.id,
            chainId: String(invoice.chainId),
            invoiceAddress: invoice.invoiceAddress ?? undefined,
            payload: {
              token: prepared.token,
              amount: prepared.balance.toString(),
              status: invoice.status,
            },
          });
          readyTron.push(prepared);
          continue;
        }

        const prepared = await this.prepareInvoice(invoice);
        if (!prepared) continue;
        this.activity?.append("invoice-paid", {
          invoiceId: invoice.id,
          chainId: String(invoice.chainId),
          invoiceAddress: invoice.invoiceAddress ?? undefined,
          payload: {
            token: prepared.token ?? COMMERCE_NATIVE_TOKEN,
            amount: prepared.balance.toString(),
            status: invoice.status,
          },
        });
        const key = String(prepared.chain.chainId);
        const list = readyByChain.get(key) ?? [];
        list.push({ invoice, token: prepared.token, balance: prepared.balance });
        readyByChain.set(key, list);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.activity?.append("sweep-failed", {
          invoiceId: invoice.id,
          chainId: invoice.chainId ? String(invoice.chainId) : undefined,
          invoiceAddress: invoice.invoiceAddress ?? undefined,
          payload: { error: message, stage: "prepare" },
        });
        await this.trackWithRetry({
          invoiceId: invoice.id,
          error: message,
          expectedVersion: invoice.version,
        });
      }
    }

    for (const [chainId, batch] of readyByChain) {
      const chain = this.chains.find((entry) => String(entry.chainId) === chainId);
      if (!chain || batch.length === 0) continue;

      for (const item of batch) {
        try {
          const claimed = await this.claimWithRetry(item.invoice);
          if (!claimed) continue;
          const afterPaid = await this.trackWithRetry({
            invoiceId: item.invoice.id,
            status: item.invoice.allowPartial ? "paid_partial" : "paid",
            amountPaid: item.balance.toString(),
            expectedVersion: claimed.version,
            payload: { observedBalance: item.balance.toString(), token: item.token ?? COMMERCE_NATIVE_TOKEN },
          });
          const provider = new JsonRpcProvider(chain.rpcUrl);
          const signer = new Wallet(chain.privateKey, provider);
          const sdk = new CommerceInvoiceSdk({
            provider,
            signer,
            sweeperAddress: chain.sweeperAddress,
          });
          await this.sweepOne(sdk, item.invoice, item.token, item.balance, afterPaid?.version ?? claimed.version + 1);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.activity?.append("sweep-failed", {
            invoiceId: item.invoice.id,
            chainId,
            invoiceAddress: item.invoice.invoiceAddress ?? undefined,
            payload: {
              error: message,
              token: item.token ?? COMMERCE_NATIVE_TOKEN,
              amount: item.balance.toString(),
            },
          });
          await this.trackWithRetry({
            invoiceId: item.invoice.id,
            error: message,
            expectedVersion: item.invoice.version,
          }).catch(() => undefined);
        }
      }
    }

    for (const item of readyTron) {
      try {
        const claimed = await this.claimWithRetry(item.invoice);
        if (!claimed) continue;
        const afterPaid = await this.trackWithRetry({
          invoiceId: item.invoice.id,
          status: item.invoice.allowPartial ? "paid_partial" : "paid",
          amountPaid: item.balance.toString(),
          expectedVersion: claimed.version,
          payload: { observedBalance: item.balance.toString(), token: item.token },
        });
        await this.sweepTronOne(item.invoice, item.token, item.balance, afterPaid?.version ?? claimed.version + 1);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.activity?.append("sweep-failed", {
          invoiceId: item.invoice.id,
          chainId: item.invoice.chainId ? String(item.invoice.chainId) : undefined,
          invoiceAddress: item.invoice.invoiceAddress ?? undefined,
          payload: { error: message, token: item.token, amount: item.balance.toString() },
        });
        await this.trackWithRetry({
          invoiceId: item.invoice.id,
          error: message,
          expectedVersion: item.invoice.version,
        }).catch(() => undefined);
      }
    }
  }

  private async prepareInvoice(
    invoice: InvoiceRecord
  ): Promise<{ chain: EvmChainConfig; token: string | null; balance: bigint } | null> {
    if (!invoice.chainId || !invoice.invoiceAddress || !invoice.selectedTo) return null;
    if (invoice.status === "swept") return null;
    const chain = this.chains.find((entry) => String(entry.chainId) === String(invoice.chainId));
    if (!chain) return null;

    const provider = new JsonRpcProvider(chain.rpcUrl);
    const token = resolveToken(chain, invoice.token);
    const balance = await readBalance(provider, invoice.invoiceAddress, token);
    if (balance === 0n) return null;
    return { chain, token, balance };
  }

  private async prepareTronInvoice(
    invoice: InvoiceRecord
  ): Promise<{ invoice: InvoiceRecord; token: string; balance: bigint } | null> {
    if (!this.tron?.enabled) return null;
    if (!invoice.chainId || !invoice.invoiceAddress || !invoice.selectedTo) return null;
    if (invoice.status === "swept") return null;
    const expectedChain = this.tron.chainId ?? "nile";
    if (String(invoice.chainId) !== expectedChain) return null;

    const token = resolveTronToken(this.tron, invoice.token);
    const tronWeb = new TronWeb({ fullHost: this.tron.fullHost ?? "https://nile.trongrid.io" });
    const balance = await readTronTokenBalance(tronWeb, invoice.invoiceAddress, token);
    if (balance === 0n) return null;
    return { invoice, token, balance };
  }

  private async sweepOne(
    sdk: CommerceInvoiceSdk,
    invoice: InvoiceRecord,
    token: string | null,
    balance: bigint,
    expectedVersion: number
  ): Promise<void> {
    const result = await sdk.sweep({
      token: token ?? undefined,
      amount: balance,
      to: invoice.selectedTo!,
      invoiceId: invoice.id,
    });
    this.activity?.append("sweep-submitted", {
      invoiceId: invoice.id,
      chainId: invoice.chainId ? String(invoice.chainId) : undefined,
      invoiceAddress: invoice.invoiceAddress ?? undefined,
      txHash: result.tx.hash,
      payload: {
        token: token ?? COMMERCE_NATIVE_TOKEN,
        amount: balance.toString(),
        to: invoice.selectedTo,
      },
    });

    const receipt = await result.tx.wait();
    const gasPrice = (receipt as { gasPrice?: bigint } | null)?.gasPrice ?? 0n;
    const gasSpentWei = receipt ? (receipt.gasUsed * gasPrice).toString() : "0";

    await this.trackWithRetry({
      invoiceId: invoice.id,
      status: "swept",
      amountPaid: balance.toString(),
      amountSwept: result.amount.toString(),
      feeCollected: result.fee.toString(),
      gasSpentWei,
      sweepTx: result.tx.hash,
      expectedVersion,
      payload: { token: result.token, to: result.to },
    });

    this.activity?.append("sweep-confirmed", {
      invoiceId: invoice.id,
      chainId: invoice.chainId ? String(invoice.chainId) : undefined,
      invoiceAddress: invoice.invoiceAddress ?? undefined,
      txHash: result.tx.hash,
      payload: {
        token: result.token,
        amountSwept: result.amount.toString(),
        feeCollected: result.fee.toString(),
        gasSpentWei,
        to: result.to,
      },
    });
  }

  private async sweepTronOne(
    invoice: InvoiceRecord,
    token: string,
    balance: bigint,
    expectedVersion: number
  ): Promise<void> {
    const tron = this.tron!;
    assertTronConfig(tron);
    const sponsorKey = tron.sponsorPrivateKey ?? tron.privateKey ?? this.config.sweeperWalletKey;
    if (!sponsorKey) throw new Error("Tron sponsor private key is required");
    const merchant = invoice.selectedTo!;
    const chainId = String(invoice.chainId ?? tron.chainId ?? "nile");
    const numericId = tronNumericChainId(chainId);
    const fullHost = tron.fullHost ?? "https://nile.trongrid.io";

    // Sanity: invoice address must match EOA derivation
    const expected = deriveTronInvoiceAddress(tron.invoiceMasterSecret!, numericId, invoice.id, fullHost);
    if (expected !== invoice.invoiceAddress) {
      throw new Error(`Tron invoice address mismatch: expected ${expected}, got ${invoice.invoiceAddress}`);
    }

    const sponsorConfig: TronSponsorConfig = {
      fullHost,
      sponsorPrivateKey: sponsorKey,
      feeLimit: tron.feeLimit,
      energyMode: tron.energyMode ?? "staked",
      minDelegateEnergy: tron.minDelegateEnergy,
      minDelegateBandwidth: tron.minDelegateBandwidth,
    };

    // Default: delegate ENERGY + BANDWIDTH so the invoice EOA never receives liquid TRX.
    const delegated = await prepareInvoiceResourcesForSweep(sponsorConfig, invoice.invoiceAddress!);

    let result: { txId: string; amount: bigint; token: string };
    try {
      result = await sweepTrc20FromInvoice(
        sponsorConfig,
        tron.invoiceMasterSecret!,
        numericId,
        invoice.id,
        invoice.invoiceAddress!,
        token,
        merchant
      );
    } finally {
      await releaseInvoiceResourcesAfterSweep(sponsorConfig, invoice.invoiceAddress!, delegated);
    }

    this.activity?.append("sweep-submitted", {
      invoiceId: invoice.id,
      chainId,
      invoiceAddress: invoice.invoiceAddress ?? undefined,
      txHash: result.txId,
      payload: {
        token: result.token,
        amount: result.amount.toString(),
        to: merchant,
        resourceMode: "mode" in delegated ? "burn" : "delegate",
        energyTxId: "energyTxId" in delegated ? delegated.energyTxId : undefined,
        bandwidthTxId: "bandwidthTxId" in delegated ? delegated.bandwidthTxId : undefined,
      },
    });

    await this.trackWithRetry({
      invoiceId: invoice.id,
      status: "swept",
      amountPaid: balance.toString(),
      amountSwept: result.amount.toString(),
      feeCollected: "0",
      gasSpentWei: "0",
      sweepTx: result.txId,
      expectedVersion,
      payload: { token: result.token, to: merchant },
    });

    this.activity?.append("sweep-confirmed", {
      invoiceId: invoice.id,
      chainId,
      invoiceAddress: invoice.invoiceAddress ?? undefined,
      txHash: result.txId,
      payload: {
        token: result.token,
        amountSwept: result.amount.toString(),
        feeCollected: "0",
        to: merchant,
      },
    });
  }

  private async claimWithRetry(invoice: InvoiceRecord): Promise<InvoiceRecord | null> {
    const max = this.config.maxRetries ?? 5;
    let version = invoice.version;
    for (let attempt = 0; attempt < max; attempt++) {
      const response = await this.signedFetch("/api/sweeper/claim", {
        method: "POST",
        body: JSON.stringify({ invoiceId: invoice.id, expectedVersion: version }),
      });
      if (response.ok) {
        const body = (await response.json()) as { invoice: InvoiceRecord };
        return body.invoice;
      }
      if (response.status === 409) {
        const body = (await response.json()) as { invoice?: InvoiceRecord };
        if (!body.invoice || body.invoice.status === "swept") return null;
        version = body.invoice.version;
        await sleep(100 * 2 ** attempt);
        continue;
      }
      if (response.status >= 500) {
        await sleep(200 * 2 ** attempt);
        continue;
      }
      throw new Error(`Claim failed: ${response.status} ${await response.text()}`);
    }
    return null;
  }

  private async trackWithRetry(body: Record<string, unknown>): Promise<InvoiceRecord | null> {
    const max = this.config.maxRetries ?? 5;
    let expectedVersion = body.expectedVersion as number | undefined;
    for (let attempt = 0; attempt < max; attempt++) {
      const payload = { ...body, expectedVersion };
      const response = await this.signedFetch("/api/sweeper/track", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      if (response.ok) {
        const okBody = (await response.json()) as { invoice?: InvoiceRecord };
        return okBody.invoice ?? null;
      }
      if (response.status === 409) {
        const conflict = (await response.json()) as { invoice?: InvoiceRecord };
        if (conflict.invoice?.status === "swept") return conflict.invoice;
        expectedVersion = conflict.invoice?.version;
        await sleep(100 * 2 ** attempt);
        continue;
      }
      if (response.status >= 500) {
        await sleep(200 * 2 ** attempt);
        continue;
      }
      throw new Error(`Track failed: ${response.status} ${await response.text()}`);
    }
    return null;
  }

  private async fetchInvoices(): Promise<InvoiceRecord[]> {
    const response = await this.signedFetch("/api/sweeper/invoices", { method: "GET" });
    if (!response.ok) {
      // Fallback to legacy API key path during migration
      if (this.config.apiKey) {
        const legacy = await fetch(`${this.config.serverUrl.replace(/\/$/, "")}/api/internal/invoices`, {
          headers: { "x-api-key": this.config.apiKey },
        });
        if (!legacy.ok) throw new Error(`Invoice list failed: ${legacy.status}`);
        const body = (await legacy.json()) as { invoices?: InvoiceRecord[] };
        return body.invoices ?? [];
      }
      throw new Error(`Sweeper invoice list failed: ${response.status} ${await response.text()}`);
    }
    const body = (await response.json()) as { invoices?: InvoiceRecord[] };
    return body.invoices ?? [];
  }

  private async signedFetch(path: string, init: { method: string; body?: string }): Promise<Response> {
    const base = this.config.serverUrl.replace(/\/$/, "");
    const headers: Record<string, string> = {};
    if (init.body) headers["content-type"] = "application/json";

    if (this.wallet) {
      const signed = await signSweeperRequest(this.wallet, {
        method: init.method,
        path,
        body: init.body,
      });
      Object.assign(headers, signed);
    } else if (this.config.apiKey) {
      headers["x-api-key"] = this.config.apiKey;
      // Legacy internal paths
      const legacyPath = path
        .replace("/api/sweeper/invoices", "/api/internal/invoices")
        .replace("/api/sweeper/track", "/api/internal/track");
      if (legacyPath !== path && (path.includes("invoices") || path.includes("track"))) {
        return fetch(`${base}${legacyPath}`, { method: init.method, headers, body: init.body });
      }
    }

    return fetch(`${base}${path}`, { method: init.method, headers, body: init.body });
  }
}

export async function loadSweeperConfig(path: string): Promise<SweeperConfig> {
  let config: SweeperConfig;
  if (path.endsWith(".yaml") || path.endsWith(".yml")) {
    config = (await loadYaml(path)) as unknown as SweeperConfig;
  } else {
    config = JSON.parse(await readFile(path, "utf8")) as SweeperConfig;
  }
  const fromEnv = process.env.ACTIVITY_LOG_PATH?.trim();
  if (fromEnv) {
    config.activityLogPath = fromEnv;
  } else if (!config.activityLogPath?.trim()) {
    config.activityLogPath = "/data/logs/activity.jsonl";
  }
  const roleEnv = process.env.SWEEPER_ROLE?.trim().toLowerCase();
  if (roleEnv === "evm" || roleEnv === "tron" || roleEnv === "all") {
    config.role = roleEnv;
  }
  return config;
}

function resolveRole(config: SweeperConfig): SweeperRole {
  if (config.role === "evm" || config.role === "tron" || config.role === "all") return config.role;
  return "all";
}

function isTronInvoice(invoice: InvoiceRecord): boolean {
  const id = String(invoice.chainId ?? "");
  return id === "nile" || id === "shasta" || id === "tron" || id === "3448148188";
}

function assertTronConfig(tron: TronSweeperConfig): void {
  if (!tron.invoiceMasterSecret) throw new Error("tron.invoiceMasterSecret is required");
  if (!tron.fullHost) throw new Error("tron.fullHost is required");
  const token = tron.usdtAddress ?? tron.tokens?.find((t) => t.symbol.toUpperCase() === "USDT")?.address;
  if (!token) throw new Error("tron.usdtAddress (or tokens USDT) is required");
}

function resolveToken(chain: EvmChainConfig, token: string | null): string | null {
  if (!token || token === "ETH" || token === "native" || token === COMMERCE_NATIVE_TOKEN) {
    return null;
  }
  if (token.startsWith("0x") && token.length === 42) {
    return token;
  }
  const found = chain.tokens?.find((entry) => entry.symbol.toLowerCase() === token.toLowerCase());
  if (!found) {
    throw new Error(`Token ${token} is not configured for chain ${chain.chainId}`);
  }
  return found.address;
}

function resolveTronToken(tron: TronSweeperConfig, token: string | null): string {
  if (token && token.startsWith("T")) return token;
  if (!token || token.toUpperCase() === "USDT") {
    const addr = tron.usdtAddress ?? tron.tokens?.find((t) => t.symbol.toUpperCase() === "USDT")?.address;
    if (!addr) throw new Error("USDT address is not configured for Tron");
    return addr;
  }
  const found = tron.tokens?.find((entry) => entry.symbol.toLowerCase() === token.toLowerCase());
  if (!found?.address) throw new Error(`Token ${token} is not configured for Tron`);
  return found.address;
}

async function readBalance(provider: JsonRpcProvider, invoiceAddress: string, token: string | null): Promise<bigint> {
  if (!token) {
    return provider.getBalance(invoiceAddress);
  }
  const erc20 = new Contract(token, ERC20_ABI.length > 0 ? ERC20_ABI : COMMERCE_ERC20_ABI, provider);
  return BigInt(await erc20.balanceOf(invoiceAddress));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
