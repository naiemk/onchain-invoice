import {
  AbiCoder,
  TypedDataEncoder,
  Wallet,
  ZeroAddress,
  concat,
  getAddress,
  hexlify,
  keccak256,
  randomBytes,
} from "ethers";

/** Identity method signature ("IDS1"). */
export const IDENTITY_SIG_MAGIC = "0x49445331";
/** Super-wallet multi-identity signature ("SUP1"). */
export const IDENTITY_SUPER_MAGIC = "0x53555031";

export const METHOD_WEBAUTHN = 0;
export const METHOD_YUBIKEY = 1;
export const METHOD_EOA = 2;

export const IDENTITY_EIP712_NAME = "Trustless Commerce Identity";
export const IDENTITY_EIP712_VERSION = "1";

export const IDENTITY_VERIFY_TYPES = {
  Verify: [{ name: "message", type: "bytes32" }],
};

export const IDENTITY_ADD_METHOD_TYPES = {
  AddMethod: [
    { name: "identityId", type: "bytes32" },
    { name: "kind", type: "uint8" },
    { name: "qx", type: "bytes32" },
    { name: "qy", type: "bytes32" },
    { name: "eoa", type: "address" },
  ],
};

export const IDENTITY_REMOVE_METHOD_TYPES = {
  RemoveMethod: [
    { name: "identityId", type: "bytes32" },
    { name: "methodId", type: "bytes32" },
  ],
};

export const IDENTITY_CANCEL_RESTORE_TYPES = {
  CancelRestore: [{ name: "identityId", type: "bytes32" }],
};

export function identityEip712Domain(store: string, chainId: number | bigint) {
  return {
    name: IDENTITY_EIP712_NAME,
    version: IDENTITY_EIP712_VERSION,
    chainId,
    verifyingContract: getAddress(store),
  };
}

export function computeIdentityMethodId(
  identityId: string,
  kind: number,
  qx: string,
  qy: string,
  eoa: string
): string {
  const coder = AbiCoder.defaultAbiCoder();
  return keccak256(
    coder.encode(
      ["bytes32", "uint8", "bytes32", "bytes32", "address"],
      [identityId, kind, qx, qy, getAddress(eoa)]
    )
  );
}

export function encodeIdentityBlob(input: {
  kind: number;
  identityId: string;
  methodId: string;
  inner: string;
}): string {
  const coder = AbiCoder.defaultAbiCoder();
  const payload = coder.encode(
    ["uint8", "bytes32", "bytes32", "bytes"],
    [input.kind, input.identityId, input.methodId, input.inner]
  );
  return concat([IDENTITY_SIG_MAGIC, payload]);
}

export function encodeSuperIdentityBlobs(blobs: string[]): string {
  const coder = AbiCoder.defaultAbiCoder();
  return concat([IDENTITY_SUPER_MAGIC, coder.encode(["bytes[]"], [blobs])]);
}

export async function signIdentityVerifyEoa(
  privateKey: string,
  store: string,
  chainId: number | bigint,
  message: string
): Promise<string> {
  const signer = new Wallet(privateKey);
  return signer.signTypedData(identityEip712Domain(store, chainId), IDENTITY_VERIFY_TYPES, { message });
}

export async function signIdentityAddMethodEoa(
  privateKey: string,
  store: string,
  chainId: number | bigint,
  input: { identityId: string; kind: number; qx: string; qy: string; eoa: string }
): Promise<string> {
  const signer = new Wallet(privateKey);
  return signer.signTypedData(identityEip712Domain(store, chainId), IDENTITY_ADD_METHOD_TYPES, {
    identityId: input.identityId,
    kind: input.kind,
    qx: input.qx,
    qy: input.qy,
    eoa: getAddress(input.eoa),
  });
}

export function hashIdentityVerify(store: string, chainId: number | bigint, message: string): string {
  return TypedDataEncoder.hash(identityEip712Domain(store, chainId), IDENTITY_VERIFY_TYPES, { message });
}

export type LoginMethodFlags = {
  tryWebAuthn: boolean;
  pair: boolean;
  yubikey: boolean;
  cryptoWallet: boolean;
};

/** Empty-home CTAs after email when platform get() failed. Pair is always offered if the identity exists. */
export function loginOptionsAfterFailedGet(input: {
  identityExists: boolean;
  webauthnCount: number;
  yubikeyCount: number;
  eoaCount: number;
}): LoginMethodFlags {
  if (!input.identityExists) {
    return { tryWebAuthn: false, pair: false, yubikey: false, cryptoWallet: false };
  }
  return {
    tryWebAuthn: input.webauthnCount > 0,
    pair: input.webauthnCount > 0,
    yubikey: input.yubikeyCount > 0,
    cryptoWallet: input.eoaCount > 0,
  };
}

export function randomIdentityId(): string {
  return hexlify(randomBytes(32));
}

export function hashIdentityAddMethod(
  store: string,
  chainId: number | bigint,
  input: { identityId: string; kind: number; qx: string; qy: string; eoa: string }
): string {
  return TypedDataEncoder.hash(identityEip712Domain(store, chainId), IDENTITY_ADD_METHOD_TYPES, {
    identityId: input.identityId,
    kind: input.kind,
    qx: input.qx,
    qy: input.qy,
    eoa: getAddress(input.eoa),
  });
}

export function hashIdentityRemoveMethod(
  store: string,
  chainId: number | bigint,
  identityId: string,
  methodId: string
): string {
  return TypedDataEncoder.hash(identityEip712Domain(store, chainId), IDENTITY_REMOVE_METHOD_TYPES, {
    identityId,
    methodId,
  });
}

export function hashIdentityCancelRestore(store: string, chainId: number | bigint, identityId: string): string {
  return TypedDataEncoder.hash(identityEip712Domain(store, chainId), IDENTITY_CANCEL_RESTORE_TYPES, {
    identityId,
  });
}

/** Wrap a WebAuthn or EOA inner sig as an IDS1 blob for IdentityStore / IdentityWallet. */
export function wrapIdentityMethodSignature(input: {
  kind: number;
  identityId: string;
  qx: string;
  qy: string;
  eoa?: string;
  inner: string;
}): string {
  const eoa = input.eoa && input.eoa !== ZeroAddress ? getAddress(input.eoa) : ZeroAddress;
  return encodeIdentityBlob({
    kind: input.kind,
    identityId: input.identityId,
    methodId: computeIdentityMethodId(input.identityId, input.kind, input.qx, input.qy, eoa),
    inner: input.inner,
  });
}
