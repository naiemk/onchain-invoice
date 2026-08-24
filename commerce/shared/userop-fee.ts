import { AbiCoder, Interface, getAddress } from "ethers";
import {
  ERC20_ABI,
  WALLET_EXECUTE_ABI,
  type BatchCall,
  type BundlerFeeConfig,
  type PackedUserOperationJson,
} from "./userop.js";

const TRANSFER_SELECTOR = "0xa9059cbb";
const walletIface = new Interface(WALLET_EXECUTE_ABI);
const erc20Iface = new Interface(ERC20_ABI);

export type FeeValidationReason =
  | "fee_missing"
  | "fee_too_low"
  | "invalid_call_data"
  | "invalid_batch"
  | "wrong_beneficiary"
  | "wrong_fee_token";

export interface DecodedFeeBatch {
  feeAmount: bigint;
  feeToken: string;
  beneficiary: string;
  mainCalls: BatchCall[];
}

export interface FeeValidationResult {
  ok: boolean;
  reason?: FeeValidationReason;
  message?: string;
  decoded?: DecodedFeeBatch;
}

export interface SendValidationResult extends FeeValidationResult {
  sendAmount?: bigint;
  recipient?: string;
}

/** Decode wallet.execute(batch) callData into batch calls. */
export function decodeExecuteBatch(callData: string): BatchCall[] | null {
  if (!callData || callData === "0x") return null;
  try {
    const parsed = walletIface.parseTransaction({ data: callData });
    if (!parsed || parsed.name !== "execute") return null;
    const executionData = parsed.args[1] as string;
    return decodeBatchFromExecutionData(executionData);
  } catch {
    return null;
  }
}

export function decodeBatchFromExecutionData(executionData: string): BatchCall[] | null {
  try {
    const abiCoder = AbiCoder.defaultAbiCoder();
    const raw = abiCoder.decode(["tuple(address target, uint256 value, bytes data)[]"], executionData)[0] as Array<{
      target: string;
      value: bigint;
      data: string;
    }>;
    return raw.map((row) => ({
      target: getAddress(row.target),
      value: BigInt(row.value),
      data: row.data,
    }));
  } catch {
    return null;
  }
}

function decodeTransfer(data: string): { to: string; amount: bigint } | null {
  if (!data.toLowerCase().startsWith(TRANSFER_SELECTOR)) return null;
  try {
    const parsed = erc20Iface.parseTransaction({ data });
    if (!parsed || parsed.name !== "transfer") return null;
    return { to: getAddress(String(parsed.args[0])), amount: BigInt(parsed.args[1]) };
  } catch {
    return null;
  }
}

export function validateFeeBatch(calls: BatchCall[] | null, config: BundlerFeeConfig): FeeValidationResult {
  if (!calls || calls.length < 1) {
    return { ok: false, reason: "invalid_batch", message: "Empty or undecodable batch" };
  }
  const first = calls[0];
  if (getAddress(first.target) !== getAddress(config.feeTokenAddress)) {
    return { ok: false, reason: "wrong_fee_token", message: "First call must pay bundler fee token" };
  }
  const transfer = decodeTransfer(first.data);
  if (!transfer) {
    return { ok: false, reason: "fee_missing", message: "First batch call must be ERC20 transfer" };
  }
  if (getAddress(transfer.to) !== getAddress(config.bundlerBeneficiary)) {
    return { ok: false, reason: "wrong_beneficiary", message: "Fee must be sent to bundler beneficiary" };
  }
  if (transfer.amount < config.minFeeUsdc) {
    return {
      ok: false,
      reason: "fee_too_low",
      message: `Fee ${transfer.amount} below minimum ${config.minFeeUsdc}`,
    };
  }
  return {
    ok: true,
    decoded: {
      feeAmount: transfer.amount,
      feeToken: getAddress(first.target),
      beneficiary: transfer.to,
      mainCalls: calls.slice(1),
    },
  };
}

export function validateUserOpFee(
  userOp: PackedUserOperationJson,
  config: BundlerFeeConfig
): FeeValidationResult {
  const calls = decodeExecuteBatch(userOp.callData);
  if (!calls) {
    return { ok: false, reason: "invalid_call_data", message: "callData must be execute(batch)" };
  }
  return validateFeeBatch(calls, config);
}

export function validateSendUserOp(
  userOp: PackedUserOperationJson,
  config: BundlerFeeConfig
): SendValidationResult {
  const base = validateUserOpFee(userOp, config);
  if (!base.ok || !base.decoded) return base;
  if (base.decoded.mainCalls.length !== 1) {
    return { ok: false, reason: "invalid_batch", message: "Send userOp expects one transfer after fee" };
  }
  const main = base.decoded.mainCalls[0];
  if (getAddress(main.target) !== getAddress(config.feeTokenAddress)) {
    return { ok: false, reason: "wrong_fee_token", message: "Send must use configured fee token" };
  }
  const send = decodeTransfer(main.data);
  if (!send) {
    return { ok: false, reason: "invalid_batch", message: "Second call must be ERC20 transfer" };
  }
  return {
    ok: true,
    decoded: base.decoded,
    sendAmount: send.amount,
    recipient: send.to,
  };
}
