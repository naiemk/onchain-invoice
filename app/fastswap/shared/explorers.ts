import type { FastSwapChainConfig, FastSwapChainTx, FastSwapInvoice } from "./types.js";

export function explorerTxUrlForChain(chain: FastSwapChainConfig | undefined, txHash: string): string | undefined {
  const base = chain?.explorerUrl?.trim();
  if (!base) return undefined;
  return `${base.replace(/\/$/, "")}/tx/${txHash}`;
}

function fillExplorer(
  chainsById: Map<string, FastSwapChainConfig>,
  tx: FastSwapChainTx | undefined
): FastSwapChainTx | undefined {
  if (!tx?.txHash) return tx;
  if (tx.explorerTxUrl) return tx;
  const url = explorerTxUrlForChain(chainsById.get(tx.chainId), tx.txHash);
  return url ? { ...tx, explorerTxUrl: url } : { ...tx };
}

export function enrichFastSwapInvoiceExplorers(
  invoice: FastSwapInvoice,
  chains: FastSwapChainConfig[]
): FastSwapInvoice {
  const byId = new Map(chains.map((c) => [c.id, c]));
  return {
    ...invoice,
    sweep: invoice.sweep
      ? {
          ...invoice.sweep,
          tx: fillExplorer(byId, invoice.sweep.tx),
          sourcePayment: fillExplorer(byId, invoice.sweep.sourcePayment),
        }
      : undefined,
    relay: invoice.relay
      ? {
          ...invoice.relay,
          swapRequestedTx: fillExplorer(byId, invoice.relay.swapRequestedTx),
          tx: fillExplorer(byId, invoice.relay.tx),
        }
      : undefined,
    payout: invoice.payout
      ? {
          ...invoice.payout,
          tx: fillExplorer(byId, invoice.payout.tx),
        }
      : undefined,
  };
}
