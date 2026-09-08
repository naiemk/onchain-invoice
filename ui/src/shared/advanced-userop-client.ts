import { Contract, JsonRpcProvider, getAddress, zeroPadValue } from "ethers";
import type { WalletPublicConfig } from "../../../commerce/shared/wallet.js";
import type { PackedUserOperationJson } from "../../../commerce/shared/userop.js";
import {
  ENTRYPOINT_ABI,
  buildFeeTransferCall,
  buildPackedUserOperation,
  buildSendBatchCalls,
  encodeAddEntity,
  encodeAddKey,
  encodeConfigureMultisig,
  encodeEnableAdvanced,
  encodeExecuteCallData,
  encodeRemoveEntity,
  encodeRemoveKey,
  encodeSetThreshold,
  userOpToTuple,
} from "../../../commerce/shared/userop.js";
import {
  computeKeyId,
  encodeAdvancedSignature,
  KEY_EOA,
  KEY_WEBAUTHN,
  KEY_YUBIKEY,
  signEoaPersonalDigestWithSigner,
} from "../../../commerce/shared/advanced-wallet.js";
import { signUserOpHash, type PasskeyOwner } from "./webauthn.js";
import { primaryChain } from "./wallet-api.js";
import { signUserOpHashPersonal } from "./eoa-connector.js";
import {
  signWithCurrentWalletPasskey,
  type CurrentWalletPasskey,
  type WalletPasskeyPath,
} from "./current-wallet-passkey.js";

export type AdvancedKeyType = typeof KEY_WEBAUTHN | typeof KEY_YUBIKEY | typeof KEY_EOA;

async function buildPolicyUserOp(input: {
  config: WalletPublicConfig;
  walletAddress: string;
  innerCallData: string;
  feeAmount: bigint;
  sign: (userOpHash: string) => Promise<string>;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  const chain = primaryChain(input.config);
  if (!chain.feeTokenAddress || !input.config.bundlerBeneficiary) {
    throw new Error("Bundler fee not configured");
  }
  if (!chain.rpcUrl) throw new Error("RPC not configured");
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const entryPoint = new Contract(input.config.entryPointAddress, ENTRYPOINT_ABI, provider);
  const nonce = BigInt(await entryPoint.getNonce(input.walletAddress, 0));
  const callData = encodeExecuteCallData([
    buildFeeTransferCall(chain.feeTokenAddress, input.config.bundlerBeneficiary, input.feeAmount),
    { target: input.walletAddress, value: 0n, data: input.innerCallData },
  ]);
  const unsigned = buildPackedUserOperation({ sender: input.walletAddress, nonce, callData });
  const userOpHash = await entryPoint.getUserOpHash(userOpToTuple(unsigned));
  const signature = await input.sign(userOpHash);
  return { userOp: { ...unsigned, signature }, userOpHash };
}

export async function buildAdvancedKeySignature(input: {
  userOpHash: string;
  entityId: string;
  keyType: AdvancedKeyType;
  qx?: string;
  qy?: string;
  eoa?: string;
  credentialId?: string;
  eoaSigner?: { signMessage: (msg: Uint8Array | string) => Promise<string> };
}): Promise<string> {
  const { keyId, sig } = await signKeyInner(input);
  return encodeAdvancedSignature([{ keyId, sig }]);
}

async function signKeyInner(input: {
  userOpHash: string;
  entityId: string;
  keyType: AdvancedKeyType;
  qx?: string;
  qy?: string;
  eoa?: string;
  credentialId?: string;
  eoaSigner?: { signMessage: (msg: Uint8Array | string) => Promise<string> };
}): Promise<{ keyId: string; sig: string }> {
  const qx = input.qx ?? zeroPadValue("0x00", 32);
  const qy = input.qy ?? zeroPadValue("0x00", 32);
  const eoa = input.eoa ?? zeroPadValue("0x00", 20);
  const keyId = computeKeyId(input.entityId, input.keyType, qx, qy, eoa);
  let sig: string;
  if (input.keyType === KEY_EOA) {
    if (input.eoaSigner) {
      sig = await signEoaPersonalDigestWithSigner(input.eoaSigner, input.userOpHash);
    } else {
      sig = await signUserOpHashPersonal(input.userOpHash);
    }
  } else {
    sig = await signUserOpHash(input.userOpHash, input.credentialId, {
      requireUv: input.keyType === KEY_YUBIKEY,
    });
  }
  return { keyId, sig };
}

export async function buildAdvancedWebAuthnSignature(input: {
  userOpHash: string;
  entityId: string;
  keyType?: typeof KEY_WEBAUTHN | typeof KEY_YUBIKEY;
  qx: string;
  qy: string;
  credentialId?: string;
}): Promise<string> {
  return buildAdvancedKeySignature({
    ...input,
    keyType: input.keyType ?? KEY_WEBAUTHN,
  });
}

function signPasskey(passkey: CurrentWalletPasskey, path: WalletPasskeyPath) {
  return (userOpHash: string) => signWithCurrentWalletPasskey(userOpHash, passkey, { path });
}

export async function buildSignedAdvancedSendUserOp(input: {
  config: WalletPublicConfig;
  passkey: CurrentWalletPasskey;
  recipient: string;
  sendAmount: bigint;
  feeAmount: bigint;
  chainId?: string;
  sendTokenAddress?: string;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  const chain =
    input.chainId != null
      ? input.config.chains.find((c) => c.chainId === input.chainId) ?? primaryChain(input.config)
      : primaryChain(input.config);
  if (!chain.feeTokenAddress || !input.config.bundlerBeneficiary) {
    throw new Error("Bundler fee not configured");
  }
  if (!chain.rpcUrl) throw new Error("RPC not configured");
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const entryPoint = new Contract(input.config.entryPointAddress, ENTRYPOINT_ABI, provider);
  const nonce = BigInt(await entryPoint.getNonce(input.passkey.address, 0));
  const callData = encodeExecuteCallData(
    buildSendBatchCalls({
      feeToken: chain.feeTokenAddress,
      beneficiary: input.config.bundlerBeneficiary,
      feeAmount: input.feeAmount,
      recipient: getAddress(input.recipient),
      sendAmount: input.sendAmount,
      sendToken: input.sendTokenAddress ?? chain.feeTokenAddress,
    })
  );
  const unsigned = buildPackedUserOperation({ sender: input.passkey.address, nonce, callData });
  const userOpHash = await entryPoint.getUserOpHash(userOpToTuple(unsigned));
  const signature = await signWithCurrentWalletPasskey(userOpHash, input.passkey, { path: "send" });
  return { userOp: { ...unsigned, signature }, userOpHash };
}

export async function buildSignedEnableAdvancedUserOp(input: {
  config: WalletPublicConfig;
  passkey: CurrentWalletPasskey;
  adminEntityId: string;
  feeAmount: bigint;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  return buildPolicyUserOp({
    config: input.config,
    walletAddress: input.passkey.address,
    innerCallData: encodeEnableAdvanced(input.adminEntityId),
    feeAmount: input.feeAmount,
    sign: signPasskey(input.passkey, "enable-advanced"),
  });
}

export async function buildSignedAddEntityUserOp(input: {
  config: WalletPublicConfig;
  passkey: CurrentWalletPasskey;
  entityId: string;
  feeAmount: bigint;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  return buildPolicyUserOp({
    config: input.config,
    walletAddress: input.passkey.address,
    innerCallData: encodeAddEntity(input.entityId),
    feeAmount: input.feeAmount,
    sign: signPasskey(input.passkey, "add-entity"),
  });
}

export async function buildSignedSetThresholdUserOp(input: {
  config: WalletPublicConfig;
  passkey: CurrentWalletPasskey;
  threshold: number;
  feeAmount: bigint;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  return buildPolicyUserOp({
    config: input.config,
    walletAddress: input.passkey.address,
    innerCallData: encodeSetThreshold(input.threshold),
    feeAmount: input.feeAmount,
    sign: signPasskey(input.passkey, "configure"),
  });
}

export async function buildSignedRemoveEntityUserOp(input: {
  config: WalletPublicConfig;
  passkey: CurrentWalletPasskey;
  entityId: string;
  keyIds?: string[];
  feeAmount: bigint;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  return buildPolicyUserOp({
    config: input.config,
    walletAddress: input.passkey.address,
    innerCallData: encodeRemoveEntity(input.entityId, input.keyIds ?? []),
    feeAmount: input.feeAmount,
    sign: signPasskey(input.passkey, "remove-entity"),
  });
}

export async function buildSignedRemoveKeyUserOp(input: {
  config: WalletPublicConfig;
  passkey: CurrentWalletPasskey;
  keyId: string;
  feeAmount: bigint;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  return buildPolicyUserOp({
    config: input.config,
    walletAddress: input.passkey.address,
    innerCallData: encodeRemoveKey(input.keyId),
    feeAmount: input.feeAmount,
    sign: signPasskey(input.passkey, "remove-key"),
  });
}

export async function buildSignedAddKeyUserOp(input: {
  config: WalletPublicConfig;
  passkey: CurrentWalletPasskey;
  targetEntityId: string;
  keyType: AdvancedKeyType;
  qx: string;
  qy: string;
  eoa: string;
  feeAmount: bigint;
  eoaSigner?: { signMessage: (msg: Uint8Array | string) => Promise<string> };
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  return buildPolicyUserOp({
    config: input.config,
    walletAddress: input.passkey.address,
    innerCallData: encodeAddKey(
      input.targetEntityId,
      input.keyType,
      input.qx,
      input.qy,
      getAddress(input.eoa)
    ),
    feeAmount: input.feeAmount,
    sign: input.eoaSigner
      ? (userOpHash) =>
          buildAdvancedKeySignature({
            userOpHash,
            entityId: input.passkey.entityId ?? "",
            keyType: KEY_EOA,
            eoa: input.passkey.eoa,
            eoaSigner: input.eoaSigner,
          })
      : signPasskey(input.passkey, "add-key"),
  });
}

export async function buildSignedConfigureMultisigUserOp(input: {
  config: WalletPublicConfig;
  passkey: CurrentWalletPasskey;
  removeKeyIds: string[];
  entityIds: string[];
  entityIdsForKeys: string[];
  keyTypes: number[];
  qx: string[];
  qy: string[];
  eoa: string[];
  threshold: number;
  vetoEntityIds: string[];
  feeAmount: bigint;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  return buildPolicyUserOp({
    config: input.config,
    walletAddress: input.passkey.address,
    innerCallData: encodeConfigureMultisig({
      removeKeyIds: input.removeKeyIds,
      entityIds: input.entityIds,
      entityIdsForKeys: input.entityIdsForKeys,
      keyTypes: input.keyTypes,
      qx: input.qx,
      qy: input.qy,
      eoa: input.eoa,
      threshold: input.threshold,
      vetoEntityIds: input.vetoEntityIds,
    }),
    feeAmount: input.feeAmount,
    sign: signPasskey(input.passkey, "configure"),
  });
}

export async function signProposalUserOp(input: {
  userOpHash: string;
  passkey?: CurrentWalletPasskey;
  entityId?: string;
  keyType?: AdvancedKeyType;
  qx?: string;
  qy?: string;
  eoa?: string;
  credentialId?: string;
  eoaSigner?: { signMessage: (msg: Uint8Array | string) => Promise<string> };
}): Promise<string> {
  if (input.passkey) {
    return signWithCurrentWalletPasskey(input.userOpHash, input.passkey, {
      innerOnly: true,
      path: "proposal-sign",
    });
  }
  const { sig } = await signKeyInner({
    userOpHash: input.userOpHash,
    entityId: input.entityId ?? "",
    keyType: input.keyType ?? KEY_WEBAUTHN,
    qx: input.qx,
    qy: input.qy,
    eoa: input.eoa,
    credentialId: input.credentialId,
    eoaSigner: input.eoaSigner,
  });
  return sig;
}

export function passkeyToKeyFields(owner: PasskeyOwner): { qx: string; qy: string; credentialId: string } {
  return { qx: owner.qx, qy: owner.qy, credentialId: owner.credentialId };
}
