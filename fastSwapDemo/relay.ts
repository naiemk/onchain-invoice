import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastSwapInvoiceTrackPatch } from "../app/fastswap/shared/types.js";
import {
  readTargetSwapState,
  relaySwapOnTarget,
  scanSwapRequested,
  type RelayChain,
} from "../app/fastswap/nodes/relay-node/index.js";
import { AuditLog } from "../app/fastswap/shared/audit.js";
import {
  API_PORT,
  DEMO_HOST,
  DEMO_PRIVATE_KEY,
  DEMO_RELAY_NODE,
  DEMO_RUNTIME_CHAINS,
  NODE_API_KEY,
  deploymentChains,
  type DemoDeployment,
} from "./config.js";
import { DEMO_DEPLOYMENT_PATH } from "./deploy.js";
import { postInvoiceTrack } from "./invoice-track.js";

const RELAY_API_BASE = `http://${DEMO_HOST}:${API_PORT}`;

type RelayProgress = Record<string, number>;

export class DemoRelayNode {
  private timer?: NodeJS.Timeout;
  private progress: RelayProgress = {};
  private readonly progressPath = join(process.cwd(), "fastSwapDemo", "state", "relay-progress.json");
  private readonly audit = new AuditLog(join(process.cwd(), "fastSwapDemo", "state", "relay-audit.jsonl"), "relay");
  private readonly chains: RelayChain[];

  constructor(private readonly deployment: DemoDeployment) {
    this.chains = buildRelayChains(deployment);
  }

  async start(intervalMs = DEMO_RELAY_NODE.pollIntervalMs) {
    await this.loadProgress();
    await this.runOnce();
    this.timer = setInterval(() => {
      void this.runOnce().catch((error) => console.error("[fastswap-demo:relay]", error));
    }, intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
  }

  async runOnce() {
    const t0 = Date.now();
    try {
      await Promise.all(
        this.chains.flatMap((source) => this.chains.map((target) => this.relayFrom(source, target)))
      );
      await writeFile(this.progressPath, JSON.stringify(this.progress, null, 2));
      this.audit.append("heartbeat", { payload: { ms: Date.now() - t0 } });
    } catch (error) {
      this.audit.append("error", {
        payload: { message: error instanceof Error ? error.message : String(error), stage: "tick" },
      });
      this.audit.append("relay-tick-failed", {
        payload: { message: error instanceof Error ? error.message : String(error) },
      });
      throw error;
    }
  }

  private async relayFrom(source: RelayChain, target: RelayChain) {
    const progressKey = `${source.id}->${target.id}`;
    const cursor = this.progress[progressKey] ?? (source.type === "tron" ? source.startTimestamp ?? 0 : source.startBlock ?? 0);

    let scan;
    try {
      scan = await scanSwapRequested(source, cursor);
    } catch (error) {
      this.audit.append("scan-failed", {
        payload: { source: source.name, message: error instanceof Error ? error.message : String(error) },
      });
      return;
    }

    for (const event of scan.events) {
      try {
        const invoice = await fetch(`${RELAY_API_BASE}/invoices/${encodeURIComponent(event.swapId)}`).then((r) =>
          r.ok ? r.json() : undefined
        );
        if (!invoice || invoice.targetChainId !== target.id) continue;

        const state = await readTargetSwapState(target, event.swapId);
        if (state.relayed || state.processed) continue;

        await postInvoiceTrack(RELAY_API_BASE, NODE_API_KEY, event.swapId, {
          relay: {
            swapRequestedTx: {
              chainId: source.id,
              txHash: event.txHash,
              blockNumber: event.blockNumber,
              status: "confirmed",
            },
          },
        });
        this.audit.append("swap-requested", {
          invoiceId: event.swapId,
          txHash: event.txHash,
          payload: { source: source.name },
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

        await postInvoiceTrack(RELAY_API_BASE, NODE_API_KEY, event.swapId, patch);
        console.log(`[fastswap-demo:relay] ${source.name} -> ${target.name} relayed ${event.swapId}`);
        this.audit.append("relay-confirmed", {
          invoiceId: event.swapId,
          txHash: relay.txHash,
          payload: {
            source: source.name,
            target: target.name,
            relayStatus: relay.status,
            processed: relay.processed,
          },
        });
      } catch (error) {
        this.audit.append("relay-failed", {
          txHash: event.txHash,
          payload: { message: error instanceof Error ? error.message : String(error) },
        });
        console.error("[fastswap-demo:relay]", error);
      }
    }

    this.progress[progressKey] = scan.cursor;
  }

  private async loadProgress() {
    try {
      this.progress = JSON.parse(await readFile(this.progressPath, "utf8")) as RelayProgress;
    } catch {
      this.progress = {};
    }
  }
}

/** Builds the relay chain set from both locally deployed (EVM) chains and configured external chains (EVM/TRON). */
function buildRelayChains(deployment: DemoDeployment): RelayChain[] {
  const chains: RelayChain[] = deploymentChains(deployment).map((chain) => ({
    id: chain.id,
    name: chain.name,
    type: "evm",
    rpcUrl: chain.rpcUrl,
    fastSwapAddress: chain.fastSwap,
    privateKey: DEMO_PRIVATE_KEY,
    startBlock: chain.startBlock,
  }));
  const deployedIds = new Set(chains.map((chain) => chain.id));

  for (const chain of DEMO_RUNTIME_CHAINS) {
    if (chain.demoDeploy !== false || deployedIds.has(chain.id)) continue;
    if (!chain.fastSwapAddress) continue;
    const type = chain.type ?? "evm";
    chains.push({
      id: chain.id,
      name: chain.name,
      type,
      rpcUrl: chain.rpcUrl,
      fullHost: chain.fullHost ?? chain.rpcUrl,
      fastSwapAddress: chain.fastSwapAddress,
      privateKey: DEMO_PRIVATE_KEY,
      feeLimit: chain.feeLimit,
      ...(type === "tron" ? { startTimestamp: Date.now() } : { startBlock: 0, confirmations: 1 }),
    });
  }

  return chains;
}

if (process.argv[1]?.endsWith("relay.js")) {
  const deployment = JSON.parse(await readFile(DEMO_DEPLOYMENT_PATH, "utf8")) as DemoDeployment;
  await new DemoRelayNode(deployment).start();
}
