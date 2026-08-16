import { readFile } from "node:fs/promises";
import { Contract, JsonRpcProvider, Wallet } from "ethers";
import {
  CommerceInvoiceSdk,
  CommerceSolanaSdk,
  COMMERCE_ERC20_ABI,
  COMMERCE_NATIVE_TOKEN,
  defaultTronFullHost,
  deriveTronInvoiceAddress,
  prepareInvoiceResourcesForSweep,
  readTronTokenBalance,
  releaseInvoiceResourcesAfterSweep,
  sweepTrc20FromInvoice,
  tronNumericChainId,
  type TronSponsorConfig,
} from "onchain-invoice";
import { Connection, Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import { TronWeb } from "tronweb";
import type { InvoiceRecord } from "../shared/types.js";
import { signSweeperRequest } from "../server/sweeper-auth.js";
import { ActivityLog } from "./activity-log.js";
import { load as loadYaml } from "./config-loader.js";

export type SweeperRole = "evm" | "tron" | "solana" | "all";

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
   * Prefer env `SWEEPER_ROLE=evm|tron|solana|all` (compose dual/triple services).
   */
  role?: SweeperRole;
  chains: EvmChainConfig[];
  tron?: TronSweeperConfig;
  solana?: SolanaSweeperConfig;
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

export interface SolanaSweeperConfig {
  enabled: boolean;
  note?: string;
  /**
   * Per product chainId (`devnet`, `mainnet-beta`). Prefer this over flat fields.
   * Same code path for every chain — only config entries differ.
   */
  chains?: Record<
    string,
    {
      enabled?: boolean;
      rpcUrl?: string;
      programId?: string;
      feeRecipient?: string;
      feeBps?: number;
      tokens?: Record<string, { mint?: string; address?: string; decimals?: number }>;
    }
  >;
  /** @deprecated Use `chains.devnet` */
  chainId?: string;
  rpcUrl?: string;
  programId?: string;
  usdcMint?: string;
  usdtMint?: string;
  /** Settle authority secret: JSON byte array or base58. */
  privateKey?: string;
  feeRecipient?: string;
  feeBps?: number;
  tokens?: Array<{
    symbol: string;
    address: string;
    decimals?: number;
  }>;
}


const ERC20_ABI = ["function balanceOf(address account) view returns (uint256)"] as const;

/** Empty / operator placeholder secrets — treat as unset so containers can boot before keys are filled. */
export function isUnsetSecret(value: string | undefined | null): boolean {
  const v = value?.trim() ?? "";
  if (!v) return true;
  if (v === "_PRIVATE_KEY_") return true;
  if (/^change-me/i.test(v)) return true;
  if (/^PLACEHOLDER/i.test(v)) return true;
  return false;
}

export class SweeperWorker {
  private stopped = false;
  private tickInFlight: Promise<void> | null = null;
  private wallet: Wallet | null = null;
  private readonly activity: ActivityLog | null;
  private readonly role: SweeperRole;
  private readonly chains: EvmChainConfig[];
  private tron: TronSweeperConfig | undefined;
  private solana: SolanaSweeperConfig | undefined;
  private solanaAuthority: Keypair | null = null;

  constructor(private readonly config: SweeperConfig) {
    this.role = resolveRole(config);
    const rawChains = this.role === "tron" || this.role === "solana" ? [] : config.chains ?? [];
    // Soft-skip incomplete EVM entries (empty/placeholder key or sweeper) so mainnet templates stay up.
    this.chains = rawChains.filter(
      (c) =>
        Boolean(c.rpcUrl?.trim()) &&
        Boolean(c.sweeperAddress?.trim()) &&
        !/^0x0{40}$/i.test(c.sweeperAddress.trim()) &&
        !isUnsetSecret(c.privateKey)
    );
    this.tron =
      this.role === "evm" || this.role === "solana"
        ? undefined
        : config.tron?.enabled
          ? config.tron
          : undefined;
    this.solana =
      this.role === "evm" || this.role === "tron"
        ? undefined
        : config.solana?.enabled
          ? config.solana
          : undefined;

    const walletKey = !isUnsetSecret(config.sweeperWalletKey)
      ? config.sweeperWalletKey
      : this.chains[0] && !isUnsetSecret(this.chains[0].privateKey)
        ? this.chains[0].privateKey
        : undefined;
    if (walletKey) {
      this.wallet = new Wallet(walletKey);
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
        solanaEnabled: Boolean(this.solana?.enabled),
      })
    );
    if (this.config.tron?.enabled && (this.role === "evm" || this.role === "solana")) {
      console.log(JSON.stringify({ level: "info", msg: "Tron config present but role skips Tron" }));
    }
    if (this.solana?.enabled) {
      try {
        assertSolanaConfig(this.solana);
        this.solanaAuthority = loadSolanaKeypair(this.solana.privateKey!);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const incomplete =
          isUnsetSecret(this.solana.privateKey) || listSweeperSolanaChains(this.solana).length === 0;
        // Soft-skip empty defaults so triple-compose stays up before SOLANA_* is filled in.
        // Hard-fail when role=solana and keys look present but invalid.
        if (this.role === "solana" && !incomplete) {
          throw new Error(`Solana sweeper misconfigured: ${message}`);
        }
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "solana-disabled",
            detail:
              "Solana enabled but incomplete; skipping until SOLANA_PROGRAM_ID / SOLANA_SWEEPER_KEY are set",
            role: this.role,
            error: message,
          })
        );
        this.activity?.append("solana-disabled", {
          payload: { role: this.role, error: message },
        });
        this.solana = undefined;
      }
    }
    if (this.tron?.enabled) {
      try {
        assertTronConfig(this.tron);
        const sponsorKey =
          this.tron.sponsorPrivateKey ?? this.tron.privateKey ?? this.config.sweeperWalletKey;
        if (isUnsetSecret(sponsorKey)) {
          throw new Error("tron sponsor private key is unset (use a real key instead of _PRIVATE_KEY_)");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // Soft-skip when role=tron and keys are still placeholders so compose stays healthy.
        console.warn(
          JSON.stringify({
            level: "warn",
            msg: "tron-disabled",
            detail: "Tron enabled but incomplete; skipping until keys / master secret are set",
            role: this.role,
            error: message,
          })
        );
        this.activity?.append("tron-disabled", {
          payload: { role: this.role, error: message },
        });
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
    const readySolana: Array<{
      invoice: InvoiceRecord;
      balance: bigint;
      mint: string;
      symbol: string;
      chainId: string;
    }> = [];

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

        if (isSolanaInvoice(invoice)) {
          if (!this.solana?.enabled) continue;
          const prepared = await this.prepareSolanaInvoice(invoice);
          if (!prepared) continue;
          this.activity?.append("invoice-paid", {
            invoiceId: invoice.id,
            chainId: String(invoice.chainId),
            invoiceAddress: invoice.invoiceAddress ?? undefined,
            payload: {
              token: prepared.symbol,
              amount: prepared.balance.toString(),
              status: invoice.status,
            },
          });
          readySolana.push(prepared);
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

    for (const item of readySolana) {
      try {
        const claimed = await this.claimWithRetry(item.invoice);
        if (!claimed) continue;
        const afterPaid = await this.trackWithRetry({
          invoiceId: item.invoice.id,
          status: item.invoice.allowPartial ? "paid_partial" : "paid",
          amountPaid: item.balance.toString(),
          expectedVersion: claimed.version,
          payload: { observedBalance: item.balance.toString(), token: item.symbol },
        });
        await this.sweepSolanaOne(
          item.invoice,
          item.balance,
          item.mint,
          item.symbol,
          item.chainId,
          afterPaid?.version ?? claimed.version + 1
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.activity?.append("sweep-failed", {
          invoiceId: item.invoice.id,
          chainId: item.chainId,
          invoiceAddress: item.invoice.invoiceAddress ?? undefined,
          payload: { error: message, token: item.symbol, amount: item.balance.toString() },
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
    const expectedChain = nonempty(this.tron.chainId) ?? "nile";
    if (String(invoice.chainId) !== expectedChain) return null;

    const token = resolveTronToken(this.tron, invoice.token);
    const tronWeb = new TronWeb({
      fullHost: this.tron.fullHost ?? defaultTronFullHost(expectedChain),
    });
    const balance = await readTronTokenBalance(tronWeb, invoice.invoiceAddress, token);
    if (balance === 0n) return null;
    return { invoice, token, balance };
  }

  private async prepareSolanaInvoice(
    invoice: InvoiceRecord
  ): Promise<{ invoice: InvoiceRecord; balance: bigint; mint: string; symbol: string; chainId: string } | null> {
    if (!this.solana?.enabled || !this.solanaAuthority) return null;
    if (!invoice.chainId || !invoice.invoiceAddress || !invoice.selectedTo) return null;
    if (invoice.status === "swept") return null;

    const chain = resolveSweeperSolanaChain(this.solana, String(invoice.chainId));
    if (!chain) return null;
    const token = resolveSweeperSolanaToken(chain, invoice.token);
    if (!token) return null;

    const sdk = this.buildSolanaSdk(chain);
    const balance = await sdk.readInvoiceBalance(invoice.selectedTo, invoice.id, token.mint);
    if (balance === 0n) return null;
    return { invoice, balance, mint: token.mint, symbol: token.symbol, chainId: String(invoice.chainId) };
  }

  private async sweepSolanaOne(
    invoice: InvoiceRecord,
    balance: bigint,
    mint: string,
    symbol: string,
    chainId: string,
    expectedVersion: number
  ): Promise<void> {
    const chain = resolveSweeperSolanaChain(this.solana!, chainId);
    if (!chain) throw new Error(`Solana chain ${chainId} not configured`);
    const sdk = this.buildSolanaSdk(chain);
    const feeBps = BigInt(chain.feeBps ?? this.solana!.feeBps ?? 50);
    const fee = (balance * feeBps) / 10_000n;
    const amountSwept = balance - fee;

    const sig = await sdk.settle({
      merchant: invoice.selectedTo!,
      invoiceId: invoice.id,
      mint,
    });

    this.activity?.append("sweep-submitted", {
      invoiceId: invoice.id,
      chainId,
      invoiceAddress: invoice.invoiceAddress ?? undefined,
      txHash: sig,
      payload: { token: symbol, amount: balance.toString(), to: invoice.selectedTo },
    });

    await this.trackWithRetry({
      invoiceId: invoice.id,
      status: "swept",
      amountPaid: balance.toString(),
      amountSwept: amountSwept.toString(),
      feeCollected: fee.toString(),
      gasSpentWei: "0",
      sweepTx: sig,
      expectedVersion,
      payload: { token: symbol, to: invoice.selectedTo, mint },
    });

    this.activity?.append("sweep-confirmed", {
      invoiceId: invoice.id,
      chainId,
      invoiceAddress: invoice.invoiceAddress ?? undefined,
      txHash: sig,
      payload: { token: symbol, amount: balance.toString(), to: invoice.selectedTo },
    });
  }

  private buildSolanaSdk(chain: ResolvedSweeperSolanaChain): CommerceSolanaSdk {
    if (!this.solanaAuthority) throw new Error("Solana authority keypair not loaded");
    const feeRecipient =
      nonempty(chain.feeRecipient) ??
      nonempty(this.solana?.feeRecipient) ??
      this.solanaAuthority.publicKey.toBase58();
    return new CommerceSolanaSdk({
      connection: new Connection(chain.rpcUrl, "confirmed"),
      programId: chain.programId,
      authority: this.solanaAuthority,
      feeRecipient,
      feeBps: chain.feeBps ?? 50,
    });
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
    const fullHost = tron.fullHost ?? defaultTronFullHost(chainId);

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
  if (roleEnv === "evm" || roleEnv === "tron" || roleEnv === "solana" || roleEnv === "all") {
    config.role = roleEnv;
  }
  return config;
}

function resolveRole(config: SweeperConfig): SweeperRole {
  if (config.role === "evm" || config.role === "tron" || config.role === "solana" || config.role === "all") {
    return config.role;
  }
  return "all";
}

function isTronInvoice(invoice: InvoiceRecord): boolean {
  const id = String(invoice.chainId ?? "");
  return (
    id === "nile" ||
    id === "shasta" ||
    id === "tron" ||
    id === "3448148188" ||
    id === "728126428" ||
    id === "2494104990"
  );
}

function isSolanaInvoice(invoice: InvoiceRecord): boolean {
  const id = String(invoice.chainId ?? "");
  return id === "devnet" || id === "mainnet-beta" || id === "solana" || id === "solana-devnet";
}

function assertTronConfig(tron: TronSweeperConfig): void {
  if (!tron.invoiceMasterSecret) throw new Error("tron.invoiceMasterSecret is required");
  if (!tron.fullHost) throw new Error("tron.fullHost is required");
  const token = tron.usdtAddress ?? tron.tokens?.find((t) => t.symbol.toUpperCase() === "USDT")?.address;
  if (!token) throw new Error("tron.usdtAddress (or tokens USDT) is required");
}

function assertSolanaConfig(solana: SolanaSweeperConfig): void {
  if (!solana.privateKey) throw new Error("solana.privateKey is required");
  const chains = listSweeperSolanaChains(solana);
  if (chains.length === 0) {
    throw new Error("solana.chains (or legacy rpcUrl/programId/usdcMint) must define at least one enabled chain");
  }
}

type ResolvedSweeperSolanaChain = {
  chainId: string;
  rpcUrl: string;
  programId: string;
  feeRecipient?: string;
  feeBps?: number;
  tokens: Record<string, { mint: string; decimals: number }>;
};

function listSweeperSolanaChains(solana: SolanaSweeperConfig): ResolvedSweeperSolanaChain[] {
  if (solana.chains && Object.keys(solana.chains).length > 0) {
    return Object.entries(solana.chains)
      .map(([chainId, raw]) => normalizeSweeperSolanaChain(chainId, raw, solana))
      .filter((c): c is ResolvedSweeperSolanaChain => c != null);
  }
  // Legacy flat config → single chain (default product id `devnet`)
  const chainId = solana.chainId ?? "devnet";
  return [
    normalizeSweeperSolanaChain(
      chainId,
      {
        enabled: true,
        rpcUrl: solana.rpcUrl,
        programId: solana.programId,
        feeRecipient: solana.feeRecipient,
        feeBps: solana.feeBps,
        tokens: {
          USDC: { mint: solana.usdcMint, decimals: 6 },
          USDT: { mint: solana.usdtMint, decimals: 6 },
        },
      },
      solana
    ),
  ].filter((c): c is ResolvedSweeperSolanaChain => c != null);
}

function normalizeSweeperSolanaChain(
  chainId: string,
  raw: NonNullable<SolanaSweeperConfig["chains"]>[string],
  root: SolanaSweeperConfig
): ResolvedSweeperSolanaChain | null {
  if (raw.enabled === false) return null;
  const programId = raw.programId ?? root.programId;
  const rpcUrl = raw.rpcUrl ?? root.rpcUrl;
  if (!programId || programId.startsWith("PLACEHOLDER") || !rpcUrl) return null;

  const tokens: Record<string, { mint: string; decimals: number }> = {};
  if (raw.tokens) {
    for (const [symbol, t] of Object.entries(raw.tokens)) {
      const mint = t.mint ?? t.address;
      if (!mint || mint.startsWith("PLACEHOLDER")) continue;
      tokens[symbol.toUpperCase()] = { mint, decimals: t.decimals ?? 6 };
    }
  }
  if (Object.keys(tokens).length === 0 && root.tokens) {
    for (const t of root.tokens) {
      if (!t.address || t.address.startsWith("PLACEHOLDER")) continue;
      tokens[t.symbol.toUpperCase()] = { mint: t.address, decimals: t.decimals ?? 6 };
    }
  }
  if (Object.keys(tokens).length === 0) return null;

  return {
    chainId,
    rpcUrl,
    programId,
    feeRecipient: nonempty(raw.feeRecipient) ?? nonempty(root.feeRecipient),
    feeBps: raw.feeBps ?? root.feeBps,
    tokens,
  };
}

function nonempty(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function resolveSweeperSolanaChain(
  solana: SolanaSweeperConfig,
  chainId: string
): ResolvedSweeperSolanaChain | null {
  return listSweeperSolanaChains(solana).find((c) => c.chainId === chainId) ?? null;
}

function resolveSweeperSolanaToken(
  chain: ResolvedSweeperSolanaChain,
  token: string | null
): { symbol: string; mint: string; decimals: number } | null {
  const symbol = (token ?? "USDC").toUpperCase();
  const found = chain.tokens[symbol];
  if (!found) return null;
  return { symbol, mint: found.mint, decimals: found.decimals };
}

function loadSolanaKeypair(secret: string): Keypair {
  const trimmed = secret.trim();
  if (trimmed.startsWith("[")) {
    const bytes = JSON.parse(trimmed) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(bytes));
  }
  try {
    return Keypair.fromSecretKey(bs58.decode(trimmed));
  } catch {
    throw new Error("solana.privateKey must be a JSON byte array or base58 secret key");
  }
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
