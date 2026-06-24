import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { FastSwapInvoice, FastSwapInvoiceTrackPatch } from "../../shared/types.js";
import { AuditLog } from "../../shared/audit.js";
import { verifyInvoiceSignature } from "../../shared/signing.js";
import {
  readTargetSwapState,
  relaySwapOnTarget,
  scanSwapRequested,
  type RelayChain,
} from "./index.js";
import type { RelayRunnerConfig } from "../../config/adapters/relay.js";

type RelayProgress = Record<string, number>;

export class RelayRunner {
  private timer?: NodeJS.Timeout;
  private progress: RelayProgress = {};
  private readonly audit: AuditLog;

  constructor(private readonly config: RelayRunnerConfig) {
    this.audit = new AuditLog(config.auditLogPath, "relay");
  }

  async start() {
    await this.loadProgress();
    await this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => console.error("[relay-node]", error));
    }, this.config.pollIntervalMs);
    console.log(`[relay-node] started (${this.config.chains.length} chain(s), poll ${this.config.pollIntervalMs}ms)`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  private async runOnce() {
    const chains = this.config.chains;
    await Promise.all(chains.flatMap((source) => chains.map((target) => this.relayFrom(source, target))));
    await writeFile(this.config.progressPath, JSON.stringify(this.progress, null, 2));
    this.audit.append("heartbeat", { payload: { message: "relay node running" } });
  }

  private async relayFrom(source: RelayChain, target: RelayChain) {
    const progressKey = `${source.id}->${target.id}`;
    const cursor = this.progress[progressKey] ?? (source.type === "tron" ? source.startTimestamp ?? 0 : source.startBlock ?? 0);

    let scan;
    try {
      scan = await scanSwapRequested(source, cursor);
    } catch (error) {
      this.audit.append("error", { chainId: source.id, payload: { message: String(error), stage: "scan" } });
      return;
    }

    for (const event of scan.events) {
      try {
        const invoice = await this.fetchInvoice(event.swapId);
        if (!invoice || invoice.targetChainId !== target.id) continue;
        if (!verifyInvoiceSignature(invoice, this.config.nodeAuthSecret)) {
          this.audit.append("error", {
            invoiceId: event.swapId,
            payload: { message: "invalid invoice signature" },
          });
          continue;
        }

        const state = await readTargetSwapState(target, event.swapId);
        if (state.relayed || state.processed) continue;

        this.audit.append("relay.planned", {
          invoiceId: event.swapId,
          chainId: target.id,
          payload: { source: source.id, target: target.id, txHash: event.txHash },
        });

        await this.track(event.swapId, {
          relay: {
            swapRequestedTx: {
              chainId: source.id,
              txHash: event.txHash,
              blockNumber: event.blockNumber,
              status: "confirmed",
            },
          },
        });

        const relay = await relaySwapOnTarget(target, event.swapId, invoice.data);
        const relayTx = {
          chainId: target.id,
          txHash: relay.txHash,
          blockNumber: relay.blockNumber,
          gasUsed: relay.gasUsed,
          status: relay.status,
        };
        const patch: FastSwapInvoiceTrackPatch = {
          relay: { status: relay.status === "confirmed" ? "confirmed" : "failed", tx: relayTx },
        };
        if (relay.processed) {
          patch.payout = {
            status: "confirmed",
            tx: relayTx,
            token: invoice.targetToken,
            amount: invoice.targetAmount,
            recipient: invoice.recipient,
          };
        }
        await this.track(event.swapId, patch);
        this.audit.append(relay.status === "confirmed" ? "relay.confirmed" : "relay.failed", {
          invoiceId: event.swapId,
          chainId: target.id,
          txHash: relay.txHash,
          payload: { processed: relay.processed },
        });
        console.log(`[relay-node] ${source.name} -> ${target.name} relayed ${event.swapId}`);
      } catch (error) {
        this.audit.append("error", {
          invoiceId: event.swapId,
          txHash: event.txHash,
          payload: { message: String(error) },
        });
      }
    }

    this.progress[progressKey] = scan.cursor;
  }

  private async fetchInvoice(invoiceId: string): Promise<FastSwapInvoice | undefined> {
    const response = await fetch(`${this.config.apiBaseUrl}/invoices/${encodeURIComponent(invoiceId)}`);
    return response.ok ? ((await response.json()) as FastSwapInvoice) : undefined;
  }

  private async track(invoiceId: string, patch: FastSwapInvoiceTrackPatch) {
    const response = await fetch(`${this.config.apiBaseUrl}/invoices/${encodeURIComponent(invoiceId)}/track`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.config.nodeAuthSecret,
      },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      console.error("[relay-node] track failed", response.status, await response.text());
    }
  }

  private async loadProgress() {
    try {
      await mkdir(dirname(this.config.progressPath), { recursive: true });
      this.progress = JSON.parse(await readFile(this.config.progressPath, "utf8")) as RelayProgress;
    } catch {
      this.progress = {};
    }
  }
}
