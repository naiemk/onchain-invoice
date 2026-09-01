import { Contract, JsonRpcProvider, getAddress, zeroPadValue } from "ethers";
import type { WalletPublicConfig } from "../../../commerce/shared/wallet.js";
import type { PackedUserOperationJson } from "../../../commerce/shared/userop.js";
import {
  ENTRYPOINT_ABI,
  buildFeeTransferCall,
  buildPackedUserOperation,
  encodeAddEntity,
  encodeAddKey,
  encodeConfigureMultisig,
  encodeEnableAdvanced,
  encodeExecuteCallData,
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
    sig = await signUserOpHash(input.userOpHash, input.credentialId);
  }
  return encodeAdvancedSignature([{ keyId, sig }]);
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

export async function buildSignedEnableAdvancedUserOp(input: {
  config: WalletPublicConfig;
  walletAddress: string;
  adminEntityId: string;
  qx: string;
  qy: string;
  feeAmount: bigint;
  credentialId?: string;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  return buildPolicyUserOp({
    config: input.config,
    walletAddress: input.walletAddress,
    innerCallData: encodeEnableAdvanced(input.adminEntityId),
    feeAmount: input.feeAmount,
    sign: (userOpHash) => signUserOpHash(userOpHash, input.credentialId),
  });
}

export async function buildSignedAddEntityUserOp(input: {
  config: WalletPublicConfig;
  walletAddress: string;
  adminEntityId: string;
  entityId: string;
  qx: string;
  qy: string;
  feeAmount: bigint;
  credentialId?: string;
}): Promise<{ userOp: PackedUserOperationJson; userOpHash: string }> {
  return buildPolicyUserOp({
    config: input.config,
    walletAddress: input.walletAddress,
    innerCallData: encodeAddEntity(input.entityId),
    feeAmount: input.feeAmount,
    sign: (userOpHash) =>
      buildAdvancedWebAuthnSignature({
        userOpHash,
        entityId: input.adminEntityId,
        qx: input.qx,
        qy: input.qy,
        credentialId: input.credentialId,
      }),
  });
}

export async function buildSignedAddKeyUserOp(input: {
  config: WalletPublicConfig;
  walletAddress: string;
  adminEntityId: string;
  adminQx: string;
  adminQy: string;
  adminCredentialId?: string;
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
    walletAddress: input.walletAddress,
    innerCallData: encodeAddKey(
      input.targetEntityId,
      input.keyType,
      input.qx,
      input.qy,
      getAddress(input.eoa)
    ),
    feeAmount: input.feeAmount,
    sign: (userOpHash) =>
      buildAdvancedKeySignature({
        userOpHash,
        entityId: input.adminEntityId,
        keyType: KEY_WEBAUTHN,
        qx: input.adminQx,
        qy: input.adminQy,
        credentialId: input.adminCredentialId,
      }),
  });
}

export async function buildSignedConfigureMultisigUserOp(input: {
  config: WalletPublicConfig;
  walletAddress: string;
  adminEntityId: string;
  adminQx: string;
  adminQy: string;
  adminCredentialId?: string;
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
    walletAddress: input.walletAddress,
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
    sign: (userOpHash) =>
      buildAdvancedKeySignature({
        userOpHash,
        entityId: input.adminEntityId,
        keyType: KEY_WEBAUTHN,
        qx: input.adminQx,
        qy: input.adminQy,
        credentialId: input.adminCredentialId,
      }),
  });
}

export async function signProposalUserOp(input: {
  userOpHash: string;
  entityId: string;
  keyType: AdvancedKeyType;
  qx?: string;
  qy?: string;
  eoa?: string;
  credentialId?: string;
  eoaSigner?: { signMessage: (msg: Uint8Array | string) => Promise<string> };
}): Promise<string> {
  return buildAdvancedKeySignature(input);
}

export function passkeyToKeyFields(owner: PasskeyOwner): { qx: string; qy: string; credentialId: string } {
  return { qx: owner.qx, qy: owner.qy, credentialId: owner.credentialId };
}
