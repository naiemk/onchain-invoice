import {
  TypedDataEncoder,
  Wallet,
  getAddress,
  keccak256,
  toUtf8Bytes,
  verifyTypedData,
  zeroPadValue,
  type TypedDataField,
} from "ethers";

export const WALLET_EIP712_NAME = "Trustless Commerce Wallet";
export const WALLET_EIP712_VERSION = "1";

/** Sentinel `qy` for simple-wallet EOA owners (`qx` is the padded address). */
export const EOA_OWNER_QY = keccak256(toUtf8Bytes("TrustlessCommerce.EOAOwner"));

export const EIP712_DOMAIN_FIELDS = [
  { name: "name", type: "string" },
  { name: "version", type: "string" },
  { name: "chainId", type: "uint256" },
  { name: "verifyingContract", type: "address" },
] as const;

export const ADD_OWNER_TYPES = {
  AddOwner: [
    { name: "wallet", type: "address" },
    { name: "owner", type: "address" },
  ],
} as const;

export const ADD_KEY_TYPES = {
  AddKey: [
    { name: "wallet", type: "address" },
    { name: "entityId", type: "bytes32" },
    { name: "owner", type: "address" },
  ],
} as const;

export const USER_OP_TYPES = {
  UserOp: [{ name: "userOpHash", type: "bytes32" }],
} as const;

/** Off-chain recover-without-email proof. Same domain as AddOwner / AddKey; not verified on-chain. */
export const RECOVER_TYPES = {
  Recover: [
    { name: "wallet", type: "address" },
    { name: "challenge", type: "string" },
    { name: "signer", type: "address" },
  ],
} as const;

function eip712Types(types: object): Record<string, TypedDataField[]> {
  return types as unknown as Record<string, TypedDataField[]>;
}

export function walletEip712Domain(wallet: string, chainId: number | bigint) {
  return {
    name: WALLET_EIP712_NAME,
    version: WALLET_EIP712_VERSION,
    chainId,
    verifyingContract: getAddress(wallet),
  };
}

export function eoaOwnerQx(owner: string): string {
  return zeroPadValue(getAddress(owner), 32);
}

export function eoaOwnerCoords(owner: string): { qx: string; qy: string } {
  return { qx: eoaOwnerQx(owner), qy: EOA_OWNER_QY };
}

export function isEoaOwnerQy(qy: string | null | undefined): boolean {
  if (!qy) return false;
  return qy.toLowerCase() === EOA_OWNER_QY.toLowerCase();
}

export function eoaFromOwnerQx(qx: string): string {
  return getAddress(`0x${qx.slice(-40)}`);
}

export function eoaCredentialId(owner: string): string {
  return `eoa:${getAddress(owner)}`;
}

export function parseEoaCredentialId(credentialId: string | null | undefined): string | null {
  if (!credentialId?.startsWith("eoa:")) return null;
  try {
    return getAddress(credentialId.slice(4));
  } catch {
    return null;
  }
}

export type AddOwnerTypedData = {
  domain: ReturnType<typeof walletEip712Domain>;
  types: typeof ADD_OWNER_TYPES;
  primaryType: "AddOwner";
  message: { wallet: string; owner: string };
};

export type AddKeyTypedData = {
  domain: ReturnType<typeof walletEip712Domain>;
  types: typeof ADD_KEY_TYPES;
  primaryType: "AddKey";
  message: { wallet: string; entityId: string; owner: string };
};

export type UserOpTypedData = {
  domain: ReturnType<typeof walletEip712Domain>;
  types: typeof USER_OP_TYPES;
  primaryType: "UserOp";
  message: { userOpHash: string };
};

export type RecoverTypedData = {
  domain: ReturnType<typeof walletEip712Domain>;
  types: typeof RECOVER_TYPES;
  primaryType: "Recover";
  message: { wallet: string; challenge: string; signer: string };
};

export function addOwnerTypedData(
  wallet: string,
  owner: string,
  chainId: number | bigint
): AddOwnerTypedData {
  return {
    domain: walletEip712Domain(wallet, chainId),
    types: ADD_OWNER_TYPES,
    primaryType: "AddOwner",
    message: { wallet: getAddress(wallet), owner: getAddress(owner) },
  };
}

export function addKeyTypedData(
  wallet: string,
  entityId: string,
  owner: string,
  chainId: number | bigint
): AddKeyTypedData {
  return {
    domain: walletEip712Domain(wallet, chainId),
    types: ADD_KEY_TYPES,
    primaryType: "AddKey",
    message: { wallet: getAddress(wallet), entityId, owner: getAddress(owner) },
  };
}

export function userOpTypedData(
  wallet: string,
  userOpHash: string,
  chainId: number | bigint
): UserOpTypedData {
  return {
    domain: walletEip712Domain(wallet, chainId),
    types: USER_OP_TYPES,
    primaryType: "UserOp",
    message: { userOpHash },
  };
}

export function recoverTypedData(
  wallet: string,
  challenge: string,
  signer: string,
  chainId: number | bigint
): RecoverTypedData {
  return {
    domain: walletEip712Domain(wallet, chainId),
    types: RECOVER_TYPES,
    primaryType: "Recover",
    message: { wallet: getAddress(wallet), challenge, signer: getAddress(signer) },
  };
}

export function hashAddOwnerTypedData(wallet: string, owner: string, chainId: number | bigint): string {
  const td = addOwnerTypedData(wallet, owner, chainId);
  return TypedDataEncoder.hash(td.domain, eip712Types(td.types), td.message);
}

export function hashAddKeyTypedData(
  wallet: string,
  entityId: string,
  owner: string,
  chainId: number | bigint
): string {
  const td = addKeyTypedData(wallet, entityId, owner, chainId);
  return TypedDataEncoder.hash(td.domain, eip712Types(td.types), td.message);
}

export function hashUserOpTypedData(wallet: string, userOpHash: string, chainId: number | bigint): string {
  const td = userOpTypedData(wallet, userOpHash, chainId);
  return TypedDataEncoder.hash(td.domain, eip712Types(td.types), td.message);
}

export function hashRecoverTypedData(
  wallet: string,
  challenge: string,
  signer: string,
  chainId: number | bigint
): string {
  const td = recoverTypedData(wallet, challenge, signer, chainId);
  return TypedDataEncoder.hash(td.domain, eip712Types(td.types), td.message);
}

export async function signEoaAddOwner(
  privateKey: string,
  wallet: string,
  owner: string,
  chainId: number | bigint
): Promise<string> {
  const td = addOwnerTypedData(wallet, owner, chainId);
  return new Wallet(privateKey).signTypedData(td.domain, eip712Types(td.types), td.message);
}

export async function signEoaAddKey(
  privateKey: string,
  wallet: string,
  entityId: string,
  owner: string,
  chainId: number | bigint
): Promise<string> {
  const td = addKeyTypedData(wallet, entityId, owner, chainId);
  return new Wallet(privateKey).signTypedData(td.domain, eip712Types(td.types), td.message);
}

/** Sign a UserOp digest with EIP-712 for EOA owners / advanced keys. */
export async function signEoaUserOpTypedData(
  privateKey: string,
  wallet: string,
  userOpHash: string,
  chainId: number | bigint
): Promise<string> {
  const td = userOpTypedData(wallet, userOpHash, chainId);
  return new Wallet(privateKey).signTypedData(td.domain, eip712Types(td.types), td.message);
}

export async function signEoaRecover(
  privateKey: string,
  wallet: string,
  challenge: string,
  signer: string,
  chainId: number | bigint
): Promise<string> {
  const td = recoverTypedData(wallet, challenge, signer, chainId);
  return new Wallet(privateKey).signTypedData(td.domain, eip712Types(td.types), td.message);
}

export function verifyRecoverTypedData(
  wallet: string,
  challenge: string,
  signer: string,
  chainId: number | bigint,
  signature: string
): string {
  const td = recoverTypedData(wallet, challenge, signer, chainId);
  return getAddress(verifyTypedData(td.domain, eip712Types(td.types), td.message, signature));
}

export async function signEoaTypedDataWithSigner(
  signer: {
    signTypedData: (
      domain: AddOwnerTypedData["domain"],
      types: Record<string, readonly { name: string; type: string }[]>,
      value: Record<string, unknown>
    ) => Promise<string>;
  },
  typed: AddOwnerTypedData | AddKeyTypedData | UserOpTypedData | RecoverTypedData
): Promise<string> {
  return signer.signTypedData(typed.domain, typed.types, typed.message);
}
