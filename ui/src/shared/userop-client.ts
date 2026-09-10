import { Contract, JsonRpcProvider } from "ethers";
import type { WalletPublicConfig } from "../../../commerce/shared/wallet.js";
import type { PackedUserOperationJson } from "../../../commerce/shared/userop.js";
import {
  ENTRYPOINT_ABI,
  buildAddOwnerBatchCalls,
  buildAddOwnerEoaBatchCalls,
  buildPackedUserOperation,
  buildRemoveOwnerBatchCalls,
  buildSendBatchCalls,
  encodeExecuteCallData,
  userOpToTuple,
} from "../../../commerce/shared/userop.js";
import { encodeWebAuthnSignature } from "../../../commerce/shared/webauthn-signature.js";
import { signWithCurrentWalletPasskey, type CurrentWalletPasskey } from "./current-wallet-passkey.js";
import { primaryChain, submitUserOp } from "./wallet-api.js";

export async function buildSignedSendUserOp(input: {
  config: WalletPublicConfig;
  passkey: CurrentWalletPasskey;
  recipient: string;
  sendAmount: bigint;
  feeAmount: bigint;
  /** Override primary chain (e.g. BNB for USDT cashout). */
  chainId?: string;
  /** ERC-20 to send; defaults to chain fee token. */
  sendTokenAddress?: string;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  const { config, passkey, recipient, sendAmount, feeAmount } = input;
  const walletAddress = passkey.address;
  const chain =
    input.chainId != null
      ? config.chains.find((c) => c.chainId === input.chainId) ?? primaryChain(config)
      : primaryChain(config);
  if (!chain.feeTokenAddress || !config.bundlerBeneficiary) {
    throw new Error("Bundler fee not configured");
  }
  if (!chain.rpcUrl) throw new Error("RPC not configured");
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const entryPoint = new Contract(config.entryPointAddress, ENTRYPOINT_ABI, provider);
  const nonce = BigInt(await entryPoint.getNonce(walletAddress, 0));
  const callData = encodeExecuteCallData(
    buildSendBatchCalls({
      feeToken: chain.feeTokenAddress,
      beneficiary: config.bundlerBeneficiary,
      feeAmount,
      recipient,
      sendAmount,
      sendToken: input.sendTokenAddress ?? chain.feeTokenAddress,
    })
  );
  const unsigned = buildPackedUserOperation({ sender: walletAddress, nonce, callData });
  const userOpHash = await entryPoint.getUserOpHash(userOpToTuple(unsigned));
  const signature = await signWithCurrentWalletPasskey(userOpHash, passkey, { path: "send" });
  const userOp = { ...unsigned, signature };
  return { userOp, userOpHash };
}

export async function buildSignedAddOwnerUserOp(input: {
  config: WalletPublicConfig;
  passkey: CurrentWalletPasskey;
  qx: string;
  qy: string;
  feeAmount: bigint;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  const chain = primaryChain(input.config);
  if (!chain.feeTokenAddress || !input.config.bundlerBeneficiary) {
    throw new Error("Bundler fee not configured");
  }
  if (!chain.rpcUrl) throw new Error("RPC not configured");
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const entryPoint = new Contract(input.config.entryPointAddress, ENTRYPOINT_ABI, provider);
  const nonce = BigInt(await entryPoint.getNonce(input.passkey.address, 0));
  const callData = encodeExecuteCallData(
    buildAddOwnerBatchCalls({
      feeToken: chain.feeTokenAddress,
      beneficiary: input.config.bundlerBeneficiary,
      feeAmount: input.feeAmount,
      wallet: input.passkey.address,
      qx: input.qx,
      qy: input.qy,
    })
  );
  const unsigned = buildPackedUserOperation({ sender: input.passkey.address, nonce, callData });
  const userOpHash = await entryPoint.getUserOpHash(userOpToTuple(unsigned));
  const signature = await signWithCurrentWalletPasskey(userOpHash, input.passkey, { path: "pairing-confirm" });
  return { userOp: { ...unsigned, signature }, userOpHash };
}

export async function buildSignedAddOwnerEoaUserOp(input: {
  config: WalletPublicConfig;
  passkey: CurrentWalletPasskey;
  owner: string;
  bindSignature: string;
  feeAmount: bigint;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  const chain = primaryChain(input.config);
  if (!chain.feeTokenAddress || !input.config.bundlerBeneficiary) {
    throw new Error("Bundler fee not configured");
  }
  if (!chain.rpcUrl) throw new Error("RPC not configured");
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const entryPoint = new Contract(input.config.entryPointAddress, ENTRYPOINT_ABI, provider);
  const nonce = BigInt(await entryPoint.getNonce(input.passkey.address, 0));
  const callData = encodeExecuteCallData(
    buildAddOwnerEoaBatchCalls({
      feeToken: chain.feeTokenAddress,
      beneficiary: input.config.bundlerBeneficiary,
      feeAmount: input.feeAmount,
      wallet: input.passkey.address,
      owner: input.owner,
      signature: input.bindSignature,
    })
  );
  const unsigned = buildPackedUserOperation({ sender: input.passkey.address, nonce, callData });
  const userOpHash = await entryPoint.getUserOpHash(userOpToTuple(unsigned));
  const signature = await signWithCurrentWalletPasskey(userOpHash, input.passkey, { path: "add-key" });
  return { userOp: { ...unsigned, signature }, userOpHash };
}

export async function buildSignedRemoveOwnerUserOp(input: {
  config: WalletPublicConfig;
  passkey: CurrentWalletPasskey;
  qx: string;
  qy: string;
  feeAmount: bigint;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  const chain = primaryChain(input.config);
  if (!chain.feeTokenAddress || !input.config.bundlerBeneficiary) {
    throw new Error("Bundler fee not configured");
  }
  if (!chain.rpcUrl) throw new Error("RPC not configured");
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const entryPoint = new Contract(input.config.entryPointAddress, ENTRYPOINT_ABI, provider);
  const nonce = BigInt(await entryPoint.getNonce(input.passkey.address, 0));
  const callData = encodeExecuteCallData(
    buildRemoveOwnerBatchCalls({
      feeToken: chain.feeTokenAddress,
      beneficiary: input.config.bundlerBeneficiary,
      feeAmount: input.feeAmount,
      wallet: input.passkey.address,
      qx: input.qx,
      qy: input.qy,
    })
  );
  const unsigned = buildPackedUserOperation({ sender: input.passkey.address, nonce, callData });
  const userOpHash = await entryPoint.getUserOpHash(userOpToTuple(unsigned));
  const signature = await signWithCurrentWalletPasskey(userOpHash, input.passkey, { path: "remove-key" });
  return { userOp: { ...unsigned, signature }, userOpHash };
}

export async function submitSignedUserOp(input: {
  config: WalletPublicConfig;
  userOp: PackedUserOperationJson;
  userOpHash: string;
  walletAddress: string;
  chainId?: string;
}): Promise<void> {
  await submitUserOp({
    chainId: input.chainId ?? input.config.chainId,
    walletAddress: input.walletAddress,
    userOp: input.userOp,
    userOpHash: input.userOpHash,
  });
}

export { encodeWebAuthnSignature };
