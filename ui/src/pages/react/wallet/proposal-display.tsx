import { formatUnits, getAddress } from "ethers";
import type { WalletProposalRecord } from "../../../../../commerce/shared/wallet.js";
import { ExplorerLink } from "@/components/ExplorerLink";

const ERC20_TRANSFER_SELECTOR = "0xa9059cbb";

export function isClosedProposal(p: WalletProposalRecord): boolean {
  return p.status === "executed" || p.status === "cancelled";
}

export function isFullySigned(p: WalletProposalRecord, threshold: number): boolean {
  return (p.signatureCount ?? 0) >= threshold;
}

export function isErc20TransferData(data: string): boolean {
  return data.toLowerCase().startsWith(ERC20_TRANSFER_SELECTOR);
}

export function decodeErc20Transfer(data: string): { to: string; amount: bigint } | null {
  const hex = data.toLowerCase();
  if (!hex.startsWith(ERC20_TRANSFER_SELECTOR) || hex.length < 138) return null;
  try {
    const to = getAddress(`0x${hex.slice(34, 74)}`);
    const amount = BigInt(`0x${hex.slice(74, 138)}`);
    return { to, amount };
  } catch {
    return null;
  }
}

export function shortAddr(addr: string): string {
  if (addr.length < 12) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-4)}`;
}

export type ProposalToken = { symbol: string; address: string; decimals: number };

export function tokenForProposal(
  proposal: WalletProposalRecord,
  tokens?: ProposalToken[]
): ProposalToken | undefined {
  const target = proposal.target.toLowerCase();
  return tokens?.find((tok) => tok.address.toLowerCase() === target);
}

export function proposalSummary(
  p: WalletProposalRecord,
  t: (k: string, vars?: Record<string, string | number>) => string,
  decimals = 6,
  tokens?: ProposalToken[]
): string {
  const transfer = decodeErc20Transfer(p.data);
  if (transfer) {
    const token = tokenForProposal(p, tokens);
    const symbol = token?.symbol ? ` ${token.symbol}` : "";
    return `${t("wallet.proposalsKindTransfer")} ${formatUnits(transfer.amount, token?.decimals ?? decimals)}${symbol} → ${shortAddr(transfer.to)}`;
  }
  return `${t("wallet.proposalsContractCall")} ${shortAddr(p.target)}`;
}

/** Summary with a small explorer icon beside the address (tx when executed). */
export function ProposalSummaryLine({
  proposal,
  t,
  decimals = 6,
  tokens,
}: {
  proposal: WalletProposalRecord;
  t: (k: string, vars?: Record<string, string | number>) => string;
  decimals?: number;
  tokens?: ProposalToken[];
}) {
  const transfer = decodeErc20Transfer(proposal.data);
  const token = tokenForProposal(proposal, tokens);
  const symbol = token?.symbol ? ` ${token.symbol}` : "";
  const text = transfer
    ? `${t("wallet.proposalsKindTransfer")} ${formatUnits(transfer.amount, token?.decimals ?? decimals)}${symbol} → ${shortAddr(transfer.to)}`
    : `${t("wallet.proposalsContractCall")} ${shortAddr(proposal.target)}`;
  return (
    <span className="inline-flex min-w-0 items-center gap-1">
      <span className="truncate">{text}</span>
      {proposal.txHash && (
        <ExplorerLink chainId={proposal.chainId} value={proposal.txHash} kind="tx" />
      )}
    </span>
  );
}
