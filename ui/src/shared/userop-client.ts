import { Contract, JsonRpcProvider } from "ethers";
import type { WalletPublicConfig } from "../../../commerce/shared/wallet.js";
import type { PackedUserOperationJson } from "../../../commerce/shared/userop.js";
import {
  ENTRYPOINT_ABI,
  buildAddOwnerBatchCalls,
  buildPackedUserOperation,
  buildRemoveOwnerBatchCalls,
  buildSendBatchCalls,
  encodeExecuteCallData,
  userOpToTuple,
} from "../../../commerce/shared/userop.js";
import { encodeWebAuthnSignature } from "../../../commerce/shared/webauthn-signature.js";
import { signUserOpHash } from "./webauthn.js";
import { submitUserOp } from "./wallet-api.js";

export async function buildSignedSendUserOp(input: {
  config: WalletPublicConfig;
  walletAddress: string;
  recipient: string;
  sendAmount: bigint;
  feeAmount: bigint;
  credentialId?: string;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  const { config, walletAddress, recipient, sendAmount, feeAmount } = input;
  if (!config.feeTokenAddress || !config.bundlerBeneficiary) {
    throw new Error("Bundler fee not configured");
  }
  if (!config.rpcUrl) throw new Error("RPC not configured");
  const provider = new JsonRpcProvider(config.rpcUrl);
  const entryPoint = new Contract(config.entryPointAddress, ENTRYPOINT_ABI, provider);
  const nonce = BigInt(await entryPoint.getNonce(walletAddress, 0));
  const callData = encodeExecuteCallData(
    buildSendBatchCalls({
      feeToken: config.feeTokenAddress,
      beneficiary: config.bundlerBeneficiary,
      feeAmount,
      recipient,
      sendAmount,
    })
  );
  const unsigned = buildPackedUserOperation({ sender: walletAddress, nonce, callData });
  const userOpHash = await entryPoint.getUserOpHash(userOpToTuple(unsigned));
  const signature = await signUserOpHash(userOpHash, input.credentialId);
  const userOp = { ...unsigned, signature };
  return { userOp, userOpHash };
}

export async function buildSignedAddOwnerUserOp(input: {
  config: WalletPublicConfig;
  walletAddress: string;
  qx: string;
  qy: string;
  feeAmount: bigint;
  credentialId?: string;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  if (!input.config.feeTokenAddress || !input.config.bundlerBeneficiary) {
    throw new Error("Bundler fee not configured");
  }
  if (!input.config.rpcUrl) throw new Error("RPC not configured");
  const provider = new JsonRpcProvider(input.config.rpcUrl);
  const entryPoint = new Contract(input.config.entryPointAddress, ENTRYPOINT_ABI, provider);
  const nonce = BigInt(await entryPoint.getNonce(input.walletAddress, 0));
  const callData = encodeExecuteCallData(
    buildAddOwnerBatchCalls({
      feeToken: input.config.feeTokenAddress,
      beneficiary: input.config.bundlerBeneficiary,
      feeAmount: input.feeAmount,
      wallet: input.walletAddress,
      qx: input.qx,
      qy: input.qy,
    })
  );
  const unsigned = buildPackedUserOperation({ sender: input.walletAddress, nonce, callData });
  const userOpHash = await entryPoint.getUserOpHash(userOpToTuple(unsigned));
  const signature = await signUserOpHash(userOpHash, input.credentialId);
  return { userOp: { ...unsigned, signature }, userOpHash };
}

export async function buildSignedRemoveOwnerUserOp(input: {
  config: WalletPublicConfig;
  walletAddress: string;
  qx: string;
  qy: string;
  feeAmount: bigint;
  credentialId?: string;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  if (!input.config.feeTokenAddress || !input.config.bundlerBeneficiary) {
    throw new Error("Bundler fee not configured");
  }
  if (!input.config.rpcUrl) throw new Error("RPC not configured");
  const provider = new JsonRpcProvider(input.config.rpcUrl);
  const entryPoint = new Contract(input.config.entryPointAddress, ENTRYPOINT_ABI, provider);
  const nonce = BigInt(await entryPoint.getNonce(input.walletAddress, 0));
  const callData = encodeExecuteCallData(
    buildRemoveOwnerBatchCalls({
      feeToken: input.config.feeTokenAddress,
      beneficiary: input.config.bundlerBeneficiary,
      feeAmount: input.feeAmount,
      wallet: input.walletAddress,
      qx: input.qx,
      qy: input.qy,
    })
  );
  const unsigned = buildPackedUserOperation({ sender: input.walletAddress, nonce, callData });
  const userOpHash = await entryPoint.getUserOpHash(userOpToTuple(unsigned));
  const signature = await signUserOpHash(userOpHash, input.credentialId);
  return { userOp: { ...unsigned, signature }, userOpHash };
}

export async function submitSignedUserOp(input: {
  config: WalletPublicConfig;
  userOp: PackedUserOperationJson;
  userOpHash: string;
  walletAddress: string;
}): Promise<void> {
  await submitUserOp({
    chainId: input.config.chainId,
    walletAddress: input.walletAddress,
    userOp: input.userOp,
    userOpHash: input.userOpHash,
  });
}

export { encodeWebAuthnSignature };
