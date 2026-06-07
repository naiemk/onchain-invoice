import { AbiCoder, getAddress, keccak256, toUtf8Bytes } from "ethers";
import type { FastSwapChainConfig, FastSwapChainType, FastSwapQuote } from "./types.js";
import { isTronBase58Address, tronAddressToEvmHex, ZERO_ADDRESS } from "./tron-address.js";

export type FastSwapIntent = {
  version: bigint;
  quoteId: string;
  sourceChainId: bigint;
  sourceToken: string;
  sourceAmount: bigint;
  targetChainId: bigint;
  targetToken: string;
  targetAmount: bigint;
  recipient: string;
  expiresAt: bigint;
  refundAddress: string;
};

const abi = AbiCoder.defaultAbiCoder();
const INTENT_TYPES = [
  "uint8",
  "bytes32",
  "uint256",
  "address",
  "uint256",
  "uint256",
  "address",
  "uint256",
  "address",
  "uint64",
  "address",
];

export function encodeFastSwapIntent(intent: FastSwapIntent): string {
  return abi.encode(INTENT_TYPES, [
    intent.version,
    intent.quoteId,
    intent.sourceChainId,
    intent.sourceToken,
    intent.sourceAmount,
    intent.targetChainId,
    intent.targetToken,
    intent.targetAmount,
    intent.recipient,
    intent.expiresAt,
    intent.refundAddress,
  ]);
}

export function getFastSwapInvoiceId(data: string | Uint8Array): string {
  return keccak256(data);
}

/**
 * Build a SwapIntent from a quote. Each address slot is encoded in the format of the
 * chain that interprets it: source-chain format for `sourceToken`/`refundAddress`, and
 * target-chain format for `targetToken`/`recipient`. TRON base58 addresses are converted
 * to their 20-byte hex body (which is what TVM `address` decoding expects).
 */
export function quoteToIntent(quote: FastSwapQuote, chains: FastSwapChainConfig[]): FastSwapIntent {
  const chainIds = chainNumericIds(chains);
  const sourceType = chainTypeFor(chains, quote.sourceChainId);
  const targetType = chainTypeFor(chains, quote.targetChainId);
  return {
    version: 1n,
    quoteId: normalizeBytes32(quote.quoteId),
    sourceChainId: chainIds[quote.sourceChainId] ?? BigInt(quote.sourceChainId),
    sourceToken: normalizeAddress(quote.sourceToken, sourceType),
    sourceAmount: BigInt(quote.sourceAmount),
    targetChainId: chainIds[quote.targetChainId] ?? BigInt(quote.targetChainId),
    targetToken: normalizeAddress(quote.targetToken, targetType),
    targetAmount: BigInt(quote.targetAmount),
    recipient: normalizeAddress(quote.recipient, targetType),
    expiresAt: BigInt(quote.expiresAt),
    refundAddress: normalizeAddress(
      "refundAddress" in quote ? String((quote as { refundAddress?: string }).refundAddress) : undefined,
      sourceType
    ),
  };
}

export function quoteIdFromString(value: string): string {
  return keccak256(toUtf8Bytes(value));
}

export function chainNumericIds(chains: FastSwapChainConfig[]): Record<string, bigint> {
  const result: Record<string, bigint> = {};
  for (let i = 0; i < chains.length; i++) {
    result[chains[i].id] = /^\d+$/.test(chains[i].id) ? BigInt(chains[i].id) : BigInt(i + 1);
  }
  return result;
}

function chainTypeFor(chains: FastSwapChainConfig[], chainId: string): FastSwapChainType {
  return chains.find((chain) => chain.id === chainId)?.type ?? "evm";
}

function normalizeBytes32(value: string): string {
  return value.startsWith("0x") && value.length === 66 ? value : keccak256(toUtf8Bytes(value));
}

function normalizeAddress(value: string | undefined, chainType: FastSwapChainType): string {
  if (!value || value === "native") return ZERO_ADDRESS;
  if (chainType === "tron" && isTronBase58Address(value)) return tronAddressToEvmHex(value);
  return getAddress(value);
}
