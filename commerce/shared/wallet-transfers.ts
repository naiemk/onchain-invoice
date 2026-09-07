import { getAddress } from "ethers";
import {
  decodeErc20TransferCall,
  decodeExecuteCalls,
  type PackedUserOperationJson,
} from "./userop.js";
import type { WalletStableToken, WalletTransferRecord, WalletTransferSource } from "./wallet.js";

export type TransferDraft = Omit<WalletTransferRecord, "id" | "createdAt">;

export function isBundlerFeeTransfer(
  tokenAddress: string,
  recipient: string,
  feeTokenAddress: string | null | undefined,
  bundlerBeneficiary: string | null | undefined
): boolean {
  if (!feeTokenAddress || !bundlerBeneficiary) return false;
  return (
    tokenAddress.toLowerCase() === feeTokenAddress.toLowerCase() &&
    recipient.toLowerCase() === bundlerBeneficiary.toLowerCase()
  );
}

export function outgoingTransfersFromUserOp(input: {
  walletAddress: string;
  chainId: string;
  txHash: string;
  userOpHash: string;
  userOp: PackedUserOperationJson;
  stables: WalletStableToken[];
  feeTokenAddress?: string | null;
  bundlerBeneficiary?: string | null;
}): TransferDraft[] {
  const stables = tokenMap(input.stables);
  const calls = decodeExecuteCalls(input.userOp.callData);
  const out: TransferDraft[] = [];
  let logIndex = 0;
  for (const call of calls) {
    const token = stables.get(call.target.toLowerCase());
    if (!token) continue;
    const xfer = decodeErc20TransferCall(call.data);
    if (!xfer) continue;
    if (isBundlerFeeTransfer(call.target, xfer.to, input.feeTokenAddress, input.bundlerBeneficiary)) {
      continue;
    }
    out.push(
      draftOut({
        walletAddress: input.walletAddress,
        chainId: input.chainId,
        token,
        counterparty: xfer.to,
        amount: xfer.amount.toString(),
        txHash: input.txHash,
        logIndex: logIndex++,
        source: "userop",
        userOpHash: input.userOpHash,
        proposalId: null,
      })
    );
  }
  return out;
}

export function outgoingTransferFromProposal(input: {
  walletAddress: string;
  chainId: string;
  txHash: string;
  proposalId: string;
  target: string;
  data: string;
  stables: WalletStableToken[];
  feeTokenAddress?: string | null;
  bundlerBeneficiary?: string | null;
}): TransferDraft | null {
  const token = tokenMap(input.stables).get(input.target.toLowerCase());
  if (!token) return null;
  const xfer = decodeErc20TransferCall(input.data);
  if (!xfer) return null;
  if (isBundlerFeeTransfer(input.target, xfer.to, input.feeTokenAddress, input.bundlerBeneficiary)) {
    return null;
  }
  return draftOut({
    walletAddress: input.walletAddress,
    chainId: input.chainId,
    token,
    counterparty: xfer.to,
    amount: xfer.amount.toString(),
    txHash: input.txHash,
    logIndex: 0,
    source: "proposal",
    userOpHash: null,
    proposalId: input.proposalId,
  });
}

function tokenMap(stables: WalletStableToken[]): Map<string, WalletStableToken> {
  return new Map(stables.map((t) => [t.address.toLowerCase(), t]));
}

function draftOut(input: {
  walletAddress: string;
  chainId: string;
  token: WalletStableToken;
  counterparty: string;
  amount: string;
  txHash: string;
  logIndex: number;
  source: WalletTransferSource;
  userOpHash: string | null;
  proposalId: string | null;
}): TransferDraft {
  return {
    walletAddress: getAddress(input.walletAddress).toLowerCase(),
    chainId: input.chainId,
    direction: "out",
    tokenAddress: getAddress(input.token.address).toLowerCase(),
    tokenSymbol: input.token.symbol,
    tokenDecimals: input.token.decimals,
    amount: input.amount,
    counterparty: getAddress(input.counterparty).toLowerCase(),
    txHash: input.txHash.toLowerCase(),
    logIndex: input.logIndex,
    blockNumber: 0,
    source: input.source,
    userOpHash: input.userOpHash?.toLowerCase() ?? null,
    proposalId: input.proposalId,
  };
}
