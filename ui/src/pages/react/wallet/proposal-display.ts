import { formatUnits, getAddress } from "ethers";
import type { WalletProposalRecord } from "../../../../../commerce/shared/wallet.js";

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

export function proposalSummary(
  p: WalletProposalRecord,
  t: (k: string, vars?: Record<string, string | number>) => string,
  decimals = 6
): string {
  const transfer = decodeErc20Transfer(p.data);
  if (transfer) {
    return `${t("wallet.proposalsKindTransfer")} ${formatUnits(transfer.amount, decimals)} → ${shortAddr(transfer.to)}`;
  }
  return `${t("wallet.proposalsContractCall")} ${shortAddr(p.target)}`;
}
