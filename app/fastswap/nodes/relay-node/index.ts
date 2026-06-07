import { Contract, Interface, JsonRpcProvider, Wallet, hexlify } from "ethers";
import { TronWeb } from "tronweb";
import { TRON_FASTSWAP_RECEIVER_ABI } from "../../../../src/tron-abis.js";
import { FASTSWAP_RECEIVER_ABI } from "../../shared/fastswap-abi.js";

export type RelayChainType = "evm" | "tron";

export type RelayChain = {
  id: string;
  name: string;
  type: RelayChainType;
  /** EVM JSON-RPC endpoint. */
  rpcUrl?: string;
  /** TRON HTTP endpoint (TronWeb fullHost). */
  fullHost?: string;
  fastSwapAddress: string;
  /** Relayer key. EVM expects 0x-prefixed; TRON expects raw hex (handled internally). */
  privateKey: string;
  /** EVM source scan starting block. */
  startBlock?: number;
  /** TRON source scan starting block timestamp (ms). */
  startTimestamp?: number;
  /** EVM confirmations to wait before scanning. */
  confirmations?: number;
  /** TRON fee limit (SUN) for relaySwap. */
  feeLimit?: number;
  /** TRON event page size. */
  eventPollLimit?: number;
};

export type SwapRequestedEvent = {
  swapId: string;
  txHash: string;
  blockNumber?: number;
  timestamp?: number;
};

export type SwapRequestedScan = {
  events: SwapRequestedEvent[];
  /** New cursor: latest EVM block scanned, or latest TRON block timestamp. */
  cursor: number;
};

export type TargetSwapState = {
  relayed: boolean;
  processed: boolean;
  queued: boolean;
};

export type RelaySwapResult = {
  txHash: string;
  blockNumber?: number;
  gasUsed?: string;
  status: "confirmed" | "failed";
  processed: boolean;
};

const swapRequestedInterface = new Interface([
  "event SwapRequested(bytes32 indexed swapId,bytes32 indexed quoteId,uint256 indexed targetChainId,address sourceToken,uint256 sourceAmount,address targetToken,uint256 targetAmount,address recipient)",
]);

/** Scan a source chain for new `SwapRequested` events since `cursor` (EVM block or TRON timestamp). */
export async function scanSwapRequested(chain: RelayChain, cursor: number): Promise<SwapRequestedScan> {
  return chain.type === "tron" ? scanTronSwapRequested(chain, cursor) : scanEvmSwapRequested(chain, cursor);
}

/** Read the swap state on the target chain to decide whether a relay is still needed. */
export async function readTargetSwapState(chain: RelayChain, swapId: string): Promise<TargetSwapState> {
  if (chain.type === "tron") {
    const tronWeb = tronClient(chain);
    const contract = await tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.fastSwapAddress);
    const state = await contract.swapState(swapId).call();
    return { relayed: Boolean(state.relayed), processed: Boolean(state.processed), queued: Boolean(state.queued) };
  }
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const contract = new Contract(chain.fastSwapAddress, FASTSWAP_RECEIVER_ABI, provider);
  const state = await contract.swapState(swapId);
  return { relayed: Boolean(state.relayed), processed: Boolean(state.processed), queued: Boolean(state.queued) };
}

/** Submit `relaySwap(data)` on the target chain (EVM or TRON) and report the resulting state. */
export async function relaySwapOnTarget(chain: RelayChain, swapId: string, data: string): Promise<RelaySwapResult> {
  if (chain.type === "tron") {
    const tronWeb = tronClient(chain);
    const contract = await tronWeb.contract(TRON_FASTSWAP_RECEIVER_ABI as never, chain.fastSwapAddress);
    const txId: string = await contract.relaySwap(hexlify(data)).send({ feeLimit: chain.feeLimit ?? 1_000_000_000 });
    const after = await readTargetSwapState(chain, swapId);
    return { txHash: txId, status: "confirmed", processed: after.processed };
  }
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const wallet = new Wallet(chain.privateKey, provider);
  const contract = new Contract(chain.fastSwapAddress, FASTSWAP_RECEIVER_ABI, wallet);
  const tx = await contract.relaySwap(data);
  const receipt = await tx.wait();
  const after = await readTargetSwapState(chain, swapId);
  return {
    txHash: receipt?.hash ?? tx.hash,
    blockNumber: receipt?.blockNumber,
    gasUsed: receipt?.gasUsed != null ? receipt.gasUsed.toString() : undefined,
    status: receipt?.status === 1 ? "confirmed" : "failed",
    processed: after.processed,
  };
}

async function scanEvmSwapRequested(chain: RelayChain, cursor: number): Promise<SwapRequestedScan> {
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const latest = Math.max(0, (await provider.getBlockNumber()) - (chain.confirmations ?? 0));
  const fromBlock = Math.max(chain.startBlock ?? 0, (cursor || (chain.startBlock ?? 0)) + 1);
  if (fromBlock > latest) return { events: [], cursor: Math.max(cursor, latest) };

  const logs = await provider.getLogs({
    address: chain.fastSwapAddress,
    fromBlock,
    toBlock: latest,
    topics: [swapRequestedInterface.getEvent("SwapRequested")!.topicHash],
  });

  const events: SwapRequestedEvent[] = [];
  for (const log of logs) {
    const parsed = swapRequestedInterface.parseLog(log);
    if (!parsed) continue;
    events.push({ swapId: parsed.args.swapId, txHash: log.transactionHash, blockNumber: log.blockNumber });
  }
  return { events, cursor: latest };
}

async function scanTronSwapRequested(chain: RelayChain, cursor: number): Promise<SwapRequestedScan> {
  const tronWeb = tronClient(chain);
  const since = cursor || chain.startTimestamp || 0;
  const raw = await tronWeb.getEventResult(chain.fastSwapAddress, {
    eventName: "SwapRequested",
    sinceTimestamp: since,
    onlyConfirmed: true,
    limit: chain.eventPollLimit ?? 200,
    orderBy: "block_timestamp,asc",
  } as never);

  const list = Array.isArray(raw) ? raw : (raw as { data?: unknown[] })?.data ?? [];
  let maxTimestamp = since;
  const events: SwapRequestedEvent[] = [];
  for (const event of list as Array<Record<string, unknown>>) {
    const result = (event.result ?? {}) as Record<string, unknown>;
    const swapId = ensureHex32(result.swapId);
    if (!swapId) continue;
    events.push({
      swapId,
      txHash: String(event.transaction_id ?? ""),
      timestamp: Number(event.timestamp ?? 0),
    });
    maxTimestamp = Math.max(maxTimestamp, Number(event.timestamp ?? maxTimestamp));
  }
  return { events, cursor: maxTimestamp };
}

function tronClient(chain: RelayChain): TronWeb {
  return new TronWeb({ fullHost: chain.fullHost ?? chain.rpcUrl ?? "", privateKey: chain.privateKey.replace(/^0x/, "") });
}

function ensureHex32(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const prefixed = value.startsWith("0x") ? value : `0x${value}`;
  return prefixed.length === 66 ? prefixed : undefined;
}
