import { Contract, Interface, JsonRpcProvider, Wallet, ZeroAddress, getAddress, hexlify } from "ethers";
import { TronWeb } from "tronweb";
import { SweepNodeCache, normalizeInvoiceId, type PaidInvoice } from "./cache.js";
import type { ChainConfig, EvmChainConfig, SweepNodeConfig, SweepNodeInvoice, TronChainConfig } from "./config.js";
import { FASTSWAP_RECEIVER_ABI } from "../app/fastswap/shared/fastswap-abi.js";
import { ERC20_ABI, INVOICE_SWEEPER_ABI, NATIVE_TOKEN } from "../src/abis.js";
import { OnchainInvoiceSdk } from "../src/sdk.js";
import { TRC20_ABI, TRON_FASTSWAP_RECEIVER_ABI, TRON_NATIVE_TOKEN } from "../src/tron-abis.js";
import { TronInvoiceSdk } from "../src/tron.js";
import { sendNodeLog } from "../src/node-log-ingest.js";
import { InvoiceWebClient } from "../src/web-client.js";
import type { JsonObject } from "../src/web-server.js";

const RECEIVER_EVENT_ABI = [
  "event InvoicePaid(bytes32 indexed invoiceId,address indexed token,address indexed forwarder,uint256 amount,bytes data)",
] as const;

const RECEIVER_INVOICE_PAYMENT_ABI = [
  "function invoicePayment(bytes32 invoiceId) view returns (address token,uint256 amount,address forwarder,bool paid)",
] as const;

const receiverInterface = new Interface(RECEIVER_EVENT_ABI);

/** Placeholder tx hash when `paid_invoices` row is synthesized from `invoicePayment` (no log index). */
const RECONCILED_PLACEHOLDER_TX = `0x${"00".repeat(32)}` as const;

export class SweepNode {
  private readonly cache: SweepNodeCache;
  private readonly webClient: InvoiceWebClient<unknown, JsonObject>;
  private timer?: NodeJS.Timeout;

  constructor(private readonly config: SweepNodeConfig) {
    this.cache = new SweepNodeCache(config.cache.sqlitePath);
    this.webClient = new InvoiceWebClient({
      baseUrl: config.webServer.baseUrl,
      nodeApiKey: config.webServer.nodeApiKey,
    });
  }

  async runOnce() {
    await this.syncInvoices();

    for (const chain of this.config.chains) {
      await this.reconcileReceiverPaymentState(chain);
    }

    for (const chain of this.config.chains) {
      await this.scanPaidLogs(chain);
      await this.checkAndSweep(chain);
    }
  }

  start() {
    if (this.timer) return;
    const tick = () => {
      void (async () => {
        const t0 = Date.now();
        try {
          await this.runOnce();
          this.nodeHeartbeat("sweep node running", { ms: Date.now() - t0 });
        } catch (error) {
          this.nodeHeartbeat(
            "sweep tick failed",
            {
              message: error instanceof Error ? error.message : String(error),
            },
            "error"
          );
          this.nodeLog("error", "sweep tick failed", {
            message: error instanceof Error ? error.message : String(error),
          });
          console.error("[sweep-node] tick failed", error);
        }
      })();
    };
    tick();
    this.timer = setInterval(tick, this.config.pollIntervalMs ?? 30_000);
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
    this.cache.close();
  }

  private async syncInvoices() {
    let cursor: string | undefined;
    const limit = this.config.webServer.pageLimit ?? 500;
    const lookbackMs = this.config.webServer.lookbackMs;
    let pages = 0;
    let rows = 0;

    do {
      pages += 1;
      const page = await this.webClient.listInvoices({ limit, cursor, lookbackMs });
      for (const record of page.invoices) {
        const invoice = toSweepNodeInvoice(record.invoice);
        if (invoice) {
          this.cache.upsertInvoice(invoice);
          rows += 1;
        }
      }
      cursor = page.nextCursor;
    } while (cursor);

    void pages;
    void rows;
  }

  /**
   * For every cached invoice on this chain, if the receiver already recorded payment (funds pulled
   * from the invoice forwarder earlier, or indexer missed logs), align local `paid_invoices`,
   * POST track status to the API, and record `swept` so we do not re-submit sweeper txs.
   */
  private async reconcileReceiverPaymentState(chain: ChainConfig) {
    if (chain.type !== "evm") return;

    const limit = this.config.reconcileReceiverLimitPerChain ?? 500;
    const invoices = this.cache.listInvoicesByChain(chain.id, limit);
    if (invoices.length === 0) return;

    const provider = new JsonRpcProvider(chain.rpcUrl);
    const receiver = new Contract(chain.receiverAddress, RECEIVER_INVOICE_PAYMENT_ABI, provider);
    let reconciled = 0;

    for (const inv of invoices) {
      if (this.cache.hasSuccessfulSweep(chain.id, inv.invoiceId)) continue;
      try {
        const pm = await receiver.invoicePayment(inv.invoiceId);
        if (!pm.paid) continue;

        const tokenAddr =
          String(pm.token).toLowerCase() === ZeroAddress.toLowerCase() ? NATIVE_TOKEN : getAddress(String(pm.token));
        const forwarderAddr = getAddress(String(pm.forwarder));

        if (!this.cache.isPaid(chain.id, inv.invoiceId)) {
          this.cache.upsertPaidInvoice({
            chainId: chain.id,
            invoiceId: inv.invoiceId,
            token: tokenAddr,
            amount: pm.amount.toString(),
            forwarder: forwarderAddr,
            txHash: RECONCILED_PLACEHOLDER_TX,
            logIndex: 0,
          });
        }

        const status = await this.resolveFastSwapTrackStatus(inv);
        const ok = await this.postInvoiceTrack(inv.invoiceId, {
          status,
          sweep: {
            forwarder: forwarderAddr,
            paymentToken: tokenAddr,
            paymentAmount: pm.amount.toString(),
            sweeperAddress: chain.sweeperAddress,
          },
        });
        if (ok) {
          this.cache.recordSweepAttempt({
            chainId: chain.id,
            invoiceId: inv.invoiceId,
            status: "swept",
          });
          reconciled += 1;
        }
      } catch (error) {
        this.nodeLog("warn", "receiver reconcile failed for invoice", {
          chainId: chain.id,
          invoiceId: inv.invoiceId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }

    if (reconciled > 0) {
      this.nodeLog("info", "reconciled invoices from on-chain receiver payment", {
        chainId: chain.id,
        count: reconciled,
      });
    }
  }

  private async resolveFastSwapTrackStatus(inv: SweepNodeInvoice): Promise<string> {
    const targetId = inv.targetChainId;
    if (!targetId) return "paid";
    const targetChain = this.config.chains.find((c) => c.id === targetId);
    if (!targetChain) return "paid";
    try {
      const state = targetChain.type === "tron"
        ? await this.readTronSwapState(targetChain, inv.invoiceId)
        : await this.readEvmSwapState(targetChain, inv.invoiceId);
      if (state.processed) return "complete";
      if (state.queued) return "queued";
      if (state.relayed) return "relaying";
      return "paid";
    } catch {
      return "paid";
    }
  }

  private async readEvmSwapState(chain: EvmChainConfig, invoiceId: string) {
    const provider = new JsonRpcProvider(chain.rpcUrl);
    const targetContract = new Contract(chain.receiverAddress, FASTSWAP_RECEIVER_ABI, provider);
    const state = await targetContract.swapState(invoiceId);
    return { relayed: Boolean(state.relayed), processed: Boolean(state.processed), queued: Boolean(state.queued) };
  }

  private async readTronSwapState(chain: TronChainConfig, invoiceId: string) {
    const tronWeb = new TronWeb({ fullHost: chain.fullHost });
    const contract = await tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.receiverAddress);
    const state = await contract.swapState(invoiceId).call();
    return { relayed: Boolean(state.relayed), processed: Boolean(state.processed), queued: Boolean(state.queued) };
  }

  private async scanPaidLogs(chain: ChainConfig) {
    if (chain.type === "evm") {
      await this.scanEvmPaidLogs(chain);
    } else {
      await this.scanTronPaidLogs(chain);
    }
  }

  private async scanEvmPaidLogs(chain: EvmChainConfig) {
    const provider = new JsonRpcProvider(chain.rpcUrl);
    const confirmations = chain.confirmations ?? 3;
    const latest = Math.max(0, (await provider.getBlockNumber()) - confirmations);
    const chunk = chain.logScanChunkSize ?? 2_000;
    const lastScanned = this.cache.getLastScannedBlock(chain.id, chain.startBlock ?? 0);
    const overlap = chain.logScanOverlap ?? 100;
    let fromBlock = Math.max(chain.startBlock ?? 0, lastScanned - overlap + 1);

    while (fromBlock <= latest) {
      const toBlock = Math.min(latest, fromBlock + chunk - 1);
      const logs = await provider.getLogs({
        address: chain.receiverAddress,
        fromBlock,
        toBlock,
        topics: [receiverInterface.getEvent("InvoicePaid")!.topicHash],
      });

      for (const log of logs) {
        const parsed = receiverInterface.parseLog(log);
        if (!parsed) continue;

        const invoiceId = normalizeInvoiceId(parsed.args.invoiceId);
        const existing = this.cache.getPaidInvoice(chain.id, invoiceId);
        this.cache.upsertPaidInvoice({
          chainId: chain.id,
          invoiceId,
          token: getAddress(parsed.args.token),
          amount: parsed.args.amount.toString(),
          forwarder: getAddress(parsed.args.forwarder),
          txHash: log.transactionHash,
          logIndex: log.index,
          blockNumber: log.blockNumber,
        });
        if (!existing || existing.txHash === RECONCILED_PLACEHOLDER_TX) {
          this.nodeLog("info", "invoice received on-chain", {
            chainId: chain.id,
            invoiceId,
            token: getAddress(parsed.args.token),
            amount: parsed.args.amount.toString(),
            forwarder: getAddress(parsed.args.forwarder),
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
          });
        }
        await this.ensureInvoiceRowFromEvmPaid(chain, provider, invoiceId, parsed);
      }

      this.cache.setLastScannedBlock(chain.id, toBlock);
      fromBlock = toBlock + 1;
    }

    void latest;
  }

  /**
   * If the API has not yet synced this invoice into the local DB, create a row from the
   * `InvoicePaid` log so `listAwaitingSweepInvoices` can join paid → invoice and the sweeper can run.
   */
  private async ensureInvoiceRowFromEvmPaid(
    chain: EvmChainConfig,
    provider: JsonRpcProvider,
    invoiceId: string,
    parsed: ReturnType<typeof receiverInterface.parseLog>
  ) {
    if (!parsed) return;
    if (this.cache.getInvoice(chain.id, invoiceId)) return;
    try {
      const sweeper = new Contract(chain.sweeperAddress, INVOICE_SWEEPER_ABI, provider);
      const data = hexlify(parsed.args.data);
      const invoiceAddress = getAddress(await sweeper.getInvoiceAddress(invoiceId));
      const synthetic: SweepNodeInvoice = {
        chainId: chain.id,
        invoiceId,
        invoiceAddress,
        data,
        token: getAddress(parsed.args.token),
        amount: parsed.args.amount.toString(),
      };
      this.cache.upsertInvoice(synthetic);
      console.log(`[sweep-node] synthesized invoice cache row for paid ${invoiceId.slice(0, 12)}…`);
      this.nodeLog("info", "synthesized invoice row from InvoicePaid", {
        chainId: chain.id,
        invoiceId,
        invoiceAddress,
      });
    } catch (error) {
      console.error("[sweep-node] could not synthesize invoice row from InvoicePaid log", invoiceId, error);
      this.nodeLog("error", "could not synthesize invoice from InvoicePaid", {
        chainId: chain.id,
        invoiceId,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async scanTronPaidLogs(chain: TronChainConfig) {
    const tronWeb = new TronWeb({
      fullHost: chain.fullHost,
      privateKey: chain.privateKey,
    });
    const lastTimestamp = this.cache.getLastScannedTimestamp(chain.id, chain.startTimestamp ?? 0);
    const events = await tronWeb.getEventResult(chain.receiverAddress, {
      eventName: "InvoicePaid",
      sinceTimestamp: lastTimestamp,
      onlyConfirmed: true,
      limit: chain.eventPollLimit ?? 200,
      orderBy: "block_timestamp,asc",
    } as any);

    let maxTimestamp = lastTimestamp;
    const eventList = Array.isArray(events) ? events : events?.data ?? [];
    for (const event of eventList) {
      const result = event.result ?? {};
      const invoiceId = ensureHex32(result.invoiceId);
      if (!invoiceId) continue;

      const existing = this.cache.getPaidInvoice(chain.id, invoiceId);
      this.cache.upsertPaidInvoice({
        chainId: chain.id,
        invoiceId,
        token: tronAddressFromEvent(tronWeb, result.token),
        amount: result.amount?.toString() ?? "0",
        forwarder: tronAddressFromEvent(tronWeb, result.forwarder),
        txHash: event.transaction_id ?? "",
        logIndex: Number(event.event_index ?? 0),
        timestamp: event.timestamp,
      });
      if (!existing || existing.txHash === RECONCILED_PLACEHOLDER_TX) {
        this.nodeLog("info", "invoice received on-chain", {
          chainId: chain.id,
          invoiceId,
          token: tronAddressFromEvent(tronWeb, result.token),
          amount: result.amount?.toString() ?? "0",
          forwarder: tronAddressFromEvent(tronWeb, result.forwarder),
          txId: event.transaction_id ?? "",
          timestamp: event.timestamp,
        });
      }
      maxTimestamp = Math.max(maxTimestamp, Number(event.timestamp ?? maxTimestamp));
    }

    this.cache.setLastScannedTimestamp(chain.id, maxTimestamp);
  }

  private async checkAndSweep(chain: ChainConfig) {
    const limit = chain.sweepBatchSize ?? 100;
    const invoices = this.cache.listAwaitingSweepInvoices(chain.id, limit);
    for (const invoice of invoices) {
      try {
        const result = chain.type === "evm"
          ? await this.trySweepEvm(chain, invoice)
          : await this.trySweepTron(chain, invoice);
        this.cache.recordSweepAttempt(result);
      } catch (error) {
        this.nodeLog("error", "sweep attempt threw", {
          chainId: chain.id,
          invoiceId: invoice.invoiceId,
          message: error instanceof Error ? error.message : String(error),
        });
        this.cache.recordSweepAttempt({
          chainId: chain.id,
          invoiceId: invoice.invoiceId,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        this.cache.markInvoiceChecked(chain.id, invoice.invoiceId);
      }
    }
  }

  private async trySweepEvm(chain: EvmChainConfig, invoice: SweepNodeInvoice) {
    const provider = new JsonRpcProvider(chain.rpcUrl);
    const wallet = new Wallet(chain.privateKey, provider);
    const sdk = new OnchainInvoiceSdk({ provider, signer: wallet, sweeperAddress: chain.sweeperAddress });

    const receiverView = new Contract(chain.receiverAddress, RECEIVER_INVOICE_PAYMENT_ABI, provider);
    try {
      const onReceiver = await receiverView.invoicePayment(invoice.invoiceId);
      if (onReceiver.paid) {
        this.nodeLog("info", "receiver already recorded payment (duplicate sweep avoided)", {
          chainId: chain.id,
          invoiceId: invoice.invoiceId,
        });
        const paid = this.cache.getPaidInvoice(chain.id, invoice.invoiceId);
        const status = await this.resolveFastSwapTrackStatus(invoice);
        await this.postInvoiceTrack(invoice.invoiceId, {
          status,
          sweep: {
            forwarder: paid?.forwarder,
            paymentToken: paid?.token,
            paymentAmount: paid?.amount,
            sweeperAddress: chain.sweeperAddress,
            ...(paid
              ? {
                  sourcePayment: {
                    chainId: chain.id,
                    txHash: paid.txHash,
                    blockNumber: paid.blockNumber,
                    status: "confirmed" as const,
                  },
                }
              : {}),
          },
        });
        return {
          chainId: chain.id,
          invoiceId: invoice.invoiceId,
          status: "swept" as const,
        };
      }
    } catch {
      // Non-standard receiver or RPC hiccup; fall through to normal sweep.
    }

    const token = invoice.token ? getAddress(invoice.token) : NATIVE_TOKEN;
    const balance = await getEvmBalance(provider, invoice.invoiceAddress, token);
    const minAmount = BigInt((invoice.amount ?? invoice.minAmount ?? 1).toString());

    if (balance < minAmount) {
      return {
        chainId: chain.id,
        invoiceId: invoice.invoiceId,
        status: "skipped" as const,
        error: `balance ${balance} below ${minAmount}`,
      };
    }

    const sweep = await sdk.sweepInvoice(invoice.invoiceAddress, {
      invoiceId: invoice.invoiceId,
      data: invoice.data,
      token,
      minAmount,
      amount: invoice.amount,
    });
    const receipt = await sweep.tx.wait();
    const paid = this.cache.getPaidInvoice(chain.id, invoice.invoiceId);
    const sweepHash = receipt?.hash ?? sweep.tx.hash;
    const sweepStatus = receipt?.status === 1 ? ("confirmed" as const) : ("failed" as const);
    const paidStatus = await this.resolveFastSwapTrackStatus(invoice);
    await this.postInvoiceTrack(invoice.invoiceId, {
      status: paidStatus,
      sweep: {
        tx: {
          chainId: chain.id,
          txHash: sweepHash,
          blockNumber: receipt?.blockNumber,
          gasUsed: receipt?.gasUsed != null ? receipt.gasUsed.toString() : undefined,
          status: sweepStatus,
        },
        forwarder: paid?.forwarder,
        paymentToken: paid?.token,
        paymentAmount: paid?.amount,
        sweeperAddress: chain.sweeperAddress,
        ...(paid
          ? {
              sourcePayment: {
                chainId: chain.id,
                txHash: paid.txHash,
                blockNumber: paid.blockNumber,
                status: "confirmed" as const,
              },
            }
          : {}),
      },
    });

    this.nodeLog("info", "EVM sweep confirmed", {
      chainId: chain.id,
      invoiceId: invoice.invoiceId,
      txHash: sweepHash,
      status: sweepStatus,
    });

    return {
      chainId: chain.id,
      invoiceId: invoice.invoiceId,
      status: "swept" as const,
      txId: receipt?.hash ?? sweep.tx.hash,
    };
  }

  private async trySweepTron(chain: TronChainConfig, invoice: SweepNodeInvoice) {
    const tronWeb = new TronWeb({
      fullHost: chain.fullHost,
      privateKey: chain.privateKey,
    });
    const sdk = new TronInvoiceSdk({
      tronWeb,
      sweeperAddress: chain.sweeperAddress,
      feeLimit: chain.feeLimit,
    });

    try {
      const receiver = await tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.receiverAddress);
      const payment = await receiver.invoicePayment(invoice.invoiceId).call();
      if (payment.paid) {
        this.nodeLog("info", "receiver already recorded payment (duplicate Tron sweep avoided)", {
          chainId: chain.id,
          invoiceId: invoice.invoiceId,
        });
        await this.postInvoiceTrack(invoice.invoiceId, {
          status: await this.resolveFastSwapTrackStatus(invoice),
          sweep: { sweeperAddress: chain.sweeperAddress },
        });
        return { chainId: chain.id, invoiceId: invoice.invoiceId, status: "swept" as const };
      }
    } catch {
      // Non-FastSwap receiver or RPC hiccup; fall through to normal sweep.
    }

    const token = invoice.token ?? TRON_NATIVE_TOKEN;
    const balance = await sdk.getBalance(invoice.invoiceAddress, token);
    const minAmount = BigInt((invoice.amount ?? invoice.minAmount ?? 1).toString());

    if (balance < minAmount) {
      return {
        chainId: chain.id,
        invoiceId: invoice.invoiceId,
        status: "skipped" as const,
        error: `balance ${balance} below ${minAmount}`,
      };
    }

    const sweep = await sdk.sweepInvoice(invoice.invoiceAddress, {
      invoiceId: invoice.invoiceId,
      data: invoice.data,
      token,
      minAmount,
      amount: invoice.amount,
    });

    const paidStatus = await this.resolveFastSwapTrackStatus(invoice);
    await this.postInvoiceTrack(invoice.invoiceId, {
      status: paidStatus,
      sweep: {
        tx: {
          chainId: chain.id,
          txHash: sweep.txId,
          status: "pending" as const,
        },
      },
    });

    this.nodeLog("info", "Tron sweep submitted", { chainId: chain.id, invoiceId: invoice.invoiceId, txId: sweep.txId });

    return {
      chainId: chain.id,
      invoiceId: invoice.invoiceId,
      status: "swept" as const,
      txId: sweep.txId,
    };
  }

  private nodeLog(
    level: "debug" | "info" | "warn" | "error",
    message: string,
    metadata?: Record<string, unknown>
  ) {
    void sendNodeLog(this.config.webServer.baseUrl, this.config.webServer.nodeApiKey, "sweep", {
      level,
      message,
      metadata,
    });
  }

  private nodeHeartbeat(message: string, metadata?: Record<string, unknown>, level: "info" | "warn" | "error" = "info") {
    void sendNodeLog(this.config.webServer.baseUrl, this.config.webServer.nodeApiKey, "sweep", {
      level,
      message,
      metadata,
      eventType: "heartbeat",
    });
  }

  private async postInvoiceTrack(invoiceId: string, body: Record<string, unknown>): Promise<boolean> {
    const key = this.config.webServer.nodeApiKey;
    const base = this.config.webServer.baseUrl.replace(/\/$/, "");
    try {
      const response = await fetch(`${base}/invoices/${encodeURIComponent(invoiceId)}/track`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": key },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        const text = await response.text();
        console.error("[sweep-node] invoice track failed", response.status, text);
        this.nodeLog("warn", "invoice track POST failed", {
          invoiceId,
          status: response.status,
          body: text.slice(0, 500),
        });
        return false;
      }
      console.log("[sweep-node] invoice track ok", invoiceId);
      return true;
    } catch (error) {
      console.error("[sweep-node] invoice track error", error);
      this.nodeLog("error", "invoice track request failed", {
        invoiceId,
        message: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}

function toSweepNodeInvoice(value: Record<string, unknown>): SweepNodeInvoice | undefined {
  const invoice = value.invoice && typeof value.invoice === "object"
    ? (value.invoice as Record<string, unknown>)
    : value;
  const chainId = stringField(invoice.chainId) ?? stringField(invoice.chain);
  const invoiceId = stringField(invoice.invoiceId) ?? stringField(invoice.id);
  const invoiceAddress = stringField(invoice.invoiceAddress) ?? stringField(invoice.address);
  const data = stringField(invoice.data) ?? stringField(invoice.encodedInvoiceParams);

  if (!chainId || !invoiceId || !invoiceAddress || !data) return undefined;

  const tok = stringField(invoice.token);
  const targetChainId = stringField(invoice.targetChainId);
  return {
    chainId,
    invoiceId: normalizeInvoiceId(invoiceId),
    invoiceAddress,
    data: normalizeData(data),
    token: normalizeTokenField(tok),
    amount: numberLikeField(invoice.amount),
    minAmount: numberLikeField(invoice.minAmount),
    ...(targetChainId ? { targetChainId } : {}),
  };
}

/** TRON tokens are base58 (`T...`) and must not be passed through ethers `getAddress`. */
function normalizeTokenField(token: string | undefined): string | undefined {
  if (!token) return undefined;
  return token.startsWith("0x") ? getAddress(token) : token;
}

async function getEvmBalance(provider: JsonRpcProvider, address: string, token: string): Promise<bigint> {
  if (token === NATIVE_TOKEN) return provider.getBalance(address);
  const erc20 = new Contract(token, ERC20_ABI, provider);
  return erc20.balanceOf(address);
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberLikeField(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function normalizeData(data: string): string {
  return data.startsWith("0x") ? data : `0x${data}`;
}

function ensureHex32(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const prefixed = value.startsWith("0x") ? value : `0x${value}`;
  return prefixed.length === 66 ? prefixed : undefined;
}

function tronAddressFromEvent(tronWeb: TronWeb, value: unknown): string {
  if (typeof value !== "string") return TRON_NATIVE_TOKEN;
  if (value === "0x0000000000000000000000000000000000000000" || value === "0") return TRON_NATIVE_TOKEN;
  if (value.startsWith("T")) return value;
  return tronWeb.address.fromHex(value);
}
