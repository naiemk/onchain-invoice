import { AbiCoder, getBytes, keccak256, Wallet } from "ethers";

/** Magic prefix for advanced wallet UserOp signatures ("AWD1"). */
export const ADVANCED_SIG_MAGIC = "0x41574431";

export const KEY_WEBAUTHN = 0;
export const KEY_YUBIKEY = 1;
export const KEY_EOA = 2;

export interface EntitySigInput {
  keyId: string;
  sig: string;
}

export interface AdvancedKeyInput {
  entityId: string;
  keyType: number;
  qx: string;
  qy: string;
  eoa: string;
}

export function computeKeyId(
  entityId: string,
  keyType: number,
  qx: string,
  qy: string,
  eoa: string
): string {
  const coder = AbiCoder.defaultAbiCoder();
  return keccak256(
    coder.encode(["bytes32", "uint8", "bytes32", "bytes32", "address"], [entityId, keyType, qx, qy, eoa])
  );
}

export function encodeAdvancedSignature(sigs: EntitySigInput[]): string {
  const coder = AbiCoder.defaultAbiCoder();
  const payload = coder.encode(
    ["tuple(bytes32 keyId, bytes sig)[]"],
    [sigs.map((s) => [s.keyId, s.sig])]
  );
  return ADVANCED_SIG_MAGIC + payload.slice(2);
}

export function decodeAdvancedSignature(data: string): EntitySigInput[] {
  if (!data.startsWith(ADVANCED_SIG_MAGIC)) {
    throw new Error("Not an advanced wallet signature");
  }
  const coder = AbiCoder.defaultAbiCoder();
  const decoded = coder.decode(["tuple(bytes32 keyId, bytes sig)[]"], "0x" + data.slice(10));
  return (decoded[0] as Array<[string, string]>).map(([keyId, sig]) => ({ keyId, sig }));
}

/** Sign a UserOp digest with personal_sign (EIP-191) for EOA advanced keys. */
export async function signEoaPersonalDigest(
  privateKey: string,
  digest: string
): Promise<string> {
  const wallet = new Wallet(privateKey);
  return wallet.signMessage(getBytes(digest));
}

export async function signEoaPersonalDigestWithSigner(
  signer: { signMessage: (msg: Uint8Array | string) => Promise<string> },
  digest: string
): Promise<string> {
  return signer.signMessage(getBytes(digest));
}

export const WALLET_ADVANCED_ABI = [
  "function advanced() view returns (bool)",
  "function threshold() view returns (uint8)",
  "function entityCount() view returns (uint8)",
  "function vetoCount() view returns (uint8)",
  "function entityBitmap() view returns (uint256)",
  "function vetoBitmap() view returns (uint256)",
  "function getEntityBit(bytes32 entityId) view returns (uint8)",
  "function getEntityKeyCount(bytes32 entityId) view returns (uint8)",
  "function getKeyRecord(bytes32 keyId) view returns (tuple(bytes32 entityId, uint8 keyType, bytes32 qx, bytes32 qy, address eoa))",
  "function enableAdvanced(bytes32 adminEntityId)",
  "function configureMultisig(bytes32[] removeKeyIds, bytes32[] entityIds, bytes32[] entityIdsForKeys, uint8[] keyTypes, bytes32[] qx, bytes32[] qy, address[] eoa, uint8 threshold, bytes32[] vetoEntityIds)",
  "function addEntity(bytes32 entityId)",
  "function removeEntity(bytes32 entityId)",
  "function addKey(bytes32 entityId, uint8 keyType, bytes32 qx, bytes32 qy, address eoa)",
  "function removeKey(bytes32 keyId)",
  "function setThreshold(uint8 m)",
  "function setVeto(bytes32 entityId, bool isVeto)",
] as const;

export function hashEntityEmail(email: string): string {
  const normalized = email.trim().toLowerCase();
  return keccak256(getBytes(new TextEncoder().encode(normalized)));
}
