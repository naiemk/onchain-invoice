import { getAddress } from "ethers";
import type { AppConfig, WalletChainEntry } from "./config.js";
import type { CommerceDb } from "./db.js";
import { walletStableTokensForChain } from "../shared/evm-stables.js";
import {
  outgoingTransferFromProposal,
  outgoingTransfersFromUserOp,
  type TransferDraft,
} from "../shared/wallet-transfers.js";
import type {
  WalletProposalRecord,
  WalletStableToken,
  WalletUserOpRecord,
} from "../shared/wallet.js";

const EXPLORER_INTERVAL_MS = 250;
const PAGE_SIZE = 100;
const PAGES_PER_TICK = 3;

let explorerIntervalMs = EXPLORER_INTERVAL_MS;

export type ExplorerHttp = (url: string) => Promise<{
  status: number;
  json: () => Promise<unknown>;
}>;

let explorerHttp: ExplorerHttp = globalThis.fetch;
let queue: Promise<void> = Promise.resolve();
const inflight = new Set<string>();

export function setExplorerHttpForTests(fn: ExplorerHttp | null): void {
  explorerHttp = fn ?? globalThis.fetch;
}

export function resetExplorerSyncForTests(): void {
  queue = Promise.resolve();
  inflight.clear();
  explorerIntervalMs = EXPLORER_INTERVAL_MS;
}

export function waitForExplorerSyncForTests(): Promise<void> {
  return queue;
}

export function setExplorerIntervalForTests(ms: number): void {
  explorerIntervalMs = ms;
}

export function stablesForChain(chain: {
  chainId: string;
  feeTokenAddress?: string | null;
  feeTokenSymbol: string;
  feeTokenDecimals: number;
}): WalletStableToken[] {
  const extras = walletStableTokensForChain(chain);
  const out = [...extras];
  const fee = chain.feeTokenAddress;
  if (fee && !out.some((t) => t.address.toLowerCase() === fee.toLowerCase())) {
    out.unshift({
      symbol: chain.feeTokenSymbol,
      address: fee,
      decimals: chain.feeTokenDecimals,
    });
  }
  return out;
}

export function recordIncludedUserOpTransfers(
  db: CommerceDb,
  config: AppConfig,
  userOp: WalletUserOpRecord
): void {
  if (userOp.status !== "included" || !userOp.txHash) return;
  const chain = chainFor(config, userOp.chainId);
  const drafts = outgoingTransfersFromUserOp({
    walletAddress: userOp.walletAddress,
    chainId: userOp.chainId,
    txHash: userOp.txHash,
    userOpHash: userOp.userOpHash,
    userOp: userOp.userOp,
    stables: stablesForChain(chain),
    feeTokenAddress: chain.feeTokenAddress ?? config.wallet.feeTokenAddress,
    bundlerBeneficiary: config.wallet.bundlerBeneficiary,
  });
  for (const draft of drafts) db.upsertWalletTransfer(draft);
}

export function recordProposalTransfers(db: CommerceDb, config: AppConfig, proposal: WalletProposalRecord): void {
  if (!proposal.txHash) return;
  const chain = chainFor(config, proposal.chainId);
  const draft = outgoingTransferFromProposal({
    walletAddress: proposal.walletAddress,
    chainId: proposal.chainId,
    txHash: proposal.txHash,
    proposalId: proposal.id,
    target: proposal.target,
    data: proposal.data,
    stables: stablesForChain(chain),
    feeTokenAddress: chain.feeTokenAddress ?? config.wallet.feeTokenAddress,
    bundlerBeneficiary: config.wallet.bundlerBeneficiary,
  });
  if (draft) db.upsertWalletTransfer(draft);
}

export function enqueueWalletTransferSync(
  db: CommerceDb,
  config: AppConfig,
  walletAddress: string,
  chainId: string
): void {
  if (!config.etherscanApiKey) return;
  const key = `${walletAddress.toLowerCase()}:${chainId}`;
  if (inflight.has(key)) return;
  const cursor = db.getWalletTransferSync(walletAddress, chainId);
  if (cursor) {
    const age = Date.now() - Date.parse(cursor.lastFetchedAt);
    if (Number.isFinite(age) && age < config.walletTransferSyncMinMs) return;
  }
  inflight.add(key);
  queue = queue
    .then(() => syncWalletTransfersFromExplorer(db, config, walletAddress, chainId))
    .catch(() => undefined)
    .finally(() => {
      inflight.delete(key);
    });
}

export async function syncWalletTransfersFromExplorer(
  db: CommerceDb,
  config: AppConfig,
  walletAddress: string,
  chainId: string
): Promise<void> {
  const apiKey = config.etherscanApiKey;
  if (!apiKey) return;
  const chain = chainFor(config, chainId);
  const stables = stablesForChain(chain);
  if (stables.length === 0) {
    touchSync(db, walletAddress, chainId, db.getWalletTransferSync(walletAddress, chainId));
    return;
  }
  const stableByAddr = new Map(stables.map((t) => [t.address.toLowerCase(), t]));
  const feeToken = (chain.feeTokenAddress ?? config.wallet.feeTokenAddress)?.toLowerCase();
  const beneficiary = config.wallet.bundlerBeneficiary?.toLowerCase();
  const wallet = getAddress(walletAddress).toLowerCase();
  let cursor = db.getWalletTransferSync(wallet, chainId);
  let startBlock = cursor?.lastBlock ?? 0;
  let lastBlock = startBlock;
  let lastLog = cursor?.lastLogIndex ?? 0;
  let advanced = false;

  for (let page = 1; page <= PAGES_PER_TICK; page++) {
    await delay(explorerIntervalMs);
    const url = explorerUrl(config, {
      chainId,
      wallet,
      startBlock,
      page,
      apiKey,
    });
    const res = await explorerHttp(url);
    if (res.status === 429) {
      touchSync(db, walletAddress, chainId, cursor);
      return;
    }
    const body = (await res.json()) as {
      status?: string;
      message?: string;
      result?: unknown;
    };
    if (res.status >= 400) {
      touchSync(db, walletAddress, chainId, cursor);
      return;
    }
    const resultText = typeof body.result === "string" ? body.result : "";
    if (body.status === "0" && /rate limit/i.test(`${body.message ?? ""} ${resultText}`)) {
      touchSync(db, walletAddress, chainId, cursor);
      return;
    }
    const rows = Array.isArray(body.result) ? (body.result as ExplorerTokentx[]) : [];
    for (const row of rows) {
      const draft = draftFromExplorer(row, {
        wallet,
        chainId,
        stableByAddr,
        feeToken,
        beneficiary,
      });
      if (draft) {
        db.upsertWalletTransfer(draft);
        advanced = true;
      }
      const block = Number(row.blockNumber ?? 0);
      const logIndex = Number(row.logIndex ?? 0);
      if (block > lastBlock || (block === lastBlock && logIndex > lastLog)) {
        lastBlock = block;
        lastLog = logIndex;
        advanced = true;
      }
    }
    if (rows.length < PAGE_SIZE) break;
  }

  db.upsertWalletTransferSync({
    walletAddress: wallet,
    chainId,
    lastBlock: advanced ? lastBlock : (cursor?.lastBlock ?? 0),
    lastLogIndex: advanced ? lastLog : (cursor?.lastLogIndex ?? 0),
    lastFetchedAt: new Date().toISOString(),
  });
}

function touchSync(
  db: CommerceDb,
  walletAddress: string,
  chainId: string,
  cursor: ReturnType<CommerceDb["getWalletTransferSync"]>
): void {
  db.upsertWalletTransferSync({
    walletAddress,
    chainId,
    lastBlock: cursor?.lastBlock ?? 0,
    lastLogIndex: cursor?.lastLogIndex ?? 0,
    lastFetchedAt: new Date().toISOString(),
  });
}

function chainFor(config: AppConfig, chainId: string): WalletChainEntry {
  return (
    config.wallet.chains.find((c) => c.chainId === chainId) ?? {
      chainId,
      factoryAddress: config.wallet.factoryAddress ?? "",
      rpcUrl: config.wallet.rpcUrl,
      feeTokenAddress: config.wallet.feeTokenAddress,
      feeTokenSymbol: config.wallet.feeTokenSymbol,
      feeTokenDecimals: config.wallet.feeTokenDecimals,
      networkLabel: chainId,
    }
  );
}

function explorerUrl(
  config: AppConfig,
  input: { chainId: string; wallet: string; startBlock: number; page: number; apiKey: string }
): string {
  const url = new URL(config.etherscanApiUrl);
  url.searchParams.set("chainid", numericChainId(input.chainId));
  url.searchParams.set("module", "account");
  url.searchParams.set("action", "tokentx");
  url.searchParams.set("address", input.wallet);
  url.searchParams.set("startblock", String(input.startBlock));
  url.searchParams.set("endblock", "99999999");
  url.searchParams.set("page", String(input.page));
  url.searchParams.set("offset", String(PAGE_SIZE));
  url.searchParams.set("sort", "asc");
  url.searchParams.set("apikey", input.apiKey);
  return url.toString();
}

function numericChainId(chainId: string): string {
  if (/^\d+$/.test(chainId)) return chainId;
  return chainId;
}

interface ExplorerTokentx {
  blockNumber?: string;
  timeStamp?: string;
  hash?: string;
  from?: string;
  to?: string;
  contractAddress?: string;
  value?: string;
  tokenSymbol?: string;
  tokenDecimal?: string;
  logIndex?: string;
}

function draftFromExplorer(
  row: ExplorerTokentx,
  ctx: {
    wallet: string;
    chainId: string;
    stableByAddr: Map<string, WalletStableToken>;
    feeToken?: string;
    beneficiary?: string;
  }
): (TransferDraft & { createdAt: string }) | null {
  const hash = String(row.hash ?? "").toLowerCase();
  const from = String(row.from ?? "").toLowerCase();
  const to = String(row.to ?? "").toLowerCase();
  const tokenAddr = String(row.contractAddress ?? "").toLowerCase();
  if (!hash.startsWith("0x") || !tokenAddr.startsWith("0x")) return null;
  const token = ctx.stableByAddr.get(tokenAddr);
  if (!token) return null;
  const inbound = to === ctx.wallet;
  const outbound = from === ctx.wallet;
  if (!inbound && !outbound) return null;
  if (outbound && ctx.beneficiary && ctx.feeToken && to === ctx.beneficiary && tokenAddr === ctx.feeToken) {
    return null;
  }
  let tokenAddress: string;
  let counterparty: string;
  try {
    tokenAddress = getAddress(tokenAddr).toLowerCase();
    counterparty = getAddress(inbound ? from : to).toLowerCase();
  } catch {
    return null;
  }
  const ts = Number(row.timeStamp ?? 0);
  const createdAt = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString();
  return {
    walletAddress: ctx.wallet,
    chainId: ctx.chainId,
    direction: inbound ? "in" : "out",
    tokenAddress,
    tokenSymbol: token.symbol,
    tokenDecimals: token.decimals,
    amount: String(row.value ?? "0"),
    counterparty,
    txHash: hash,
    logIndex: Number(row.logIndex ?? 0),
    blockNumber: Number(row.blockNumber ?? 0),
    source: "explorer",
    userOpHash: null,
    proposalId: null,
    createdAt,
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
