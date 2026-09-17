import { Contract, Interface, JsonRpcProvider, ZeroAddress, ZeroHash, getAddress, zeroPadValue } from "ethers";
import {
  ENTRYPOINT_ABI,
  buildFeeTransferCall,
  buildPackedUserOperation,
  encodeExecuteCallData,
  userOpToTuple,
  type PackedUserOperationJson,
} from "../../../commerce/shared/userop.js";
import {
  METHOD_EOA,
  METHOD_WEBAUTHN,
  METHOD_YUBIKEY,
  computeIdentityMethodId,
} from "../../../commerce/shared/identity-store.js";
import { eoaFromOwnerQx, isEoaOwnerQy, parseEoaCredentialId } from "../../../commerce/shared/wallet-eip712.js";
import type { IdentityMethodKind } from "../../../commerce/shared/identity.js";
import type { RecoverProvingMethod } from "./identity-sign.js";
import { signRecoverUserOpAuthorization } from "./identity-sign.js";
import { signWithCurrentWalletPasskey, resolveCurrentWalletPasskey } from "./current-wallet-passkey.js";
import {
  fetchWalletBalance,
  fetchWalletConfig,
  primaryChain,
  submitUserOp,
  waitForUserOp,
} from "./wallet-api.js";
import type { WalletSession } from "./wallet-session.js";
import { formatSendRejectReason } from "./userop-errors.js";
import { t } from "../i18n/t.js";

const STORE_VIEW_ABI = ["function store() view returns (address)"];
const STORE_READ_ABI = [
  "function getMethod(bytes32 methodId) view returns (tuple(bytes32 identityId, uint8 kind, bytes32 qx, bytes32 qy, address eoa, bool exists))",
  "function getIdentity(bytes32 identityId) view returns (tuple(bool exists, bool restoreEnabled, uint8 methodCount, uint8 eoaCount, uint8 webauthnCount, uint8 yubikeyCount))",
  "function methodIdsOf(bytes32 identityId) view returns (bytes32[])",
  "function hashRemoveMethod(bytes32 identityId, bytes32 methodId) view returns (bytes32)",
];
const ADD_METHOD_IFACE = new Interface([
  "function addMethod(bytes32 identityId, uint8 kind, bytes32 qx, bytes32 qy, address eoa, bytes authorization)",
]);
const REMOVE_METHOD_IFACE = new Interface([
  "function removeMethod(bytes32 identityId, bytes32 methodId, bytes authorization)",
]);

/** Public config, then IdentityWallet.store() / factory.store() if the contracts are identity ones. */
export async function resolveIdentityStoreAddress(walletAddress?: string): Promise<string | null> {
  const config = await fetchWalletConfig();
  if (config.identityStoreAddress) return config.identityStoreAddress;
  const chain = primaryChain(config);
  if (!chain.rpcUrl) return null;
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const candidates = [walletAddress, config.factoryAddress].filter((value): value is string => Boolean(value));
  for (const address of candidates) {
    try {
      const code = await provider.getCode(address);
      if (!code || code === "0x") continue;
      const store = (await new Contract(address, STORE_VIEW_ABI, provider).store()) as string;
      if (store && store !== ZeroAddress) return getAddress(store);
    } catch {
      /* legacy factory / undeployed wallet */
    }
  }
  return null;
}

async function submitIdentityStoreUserOp(input: {
  walletAddress: string;
  storeAddress: string;
  storeData: string;
  signUserOp: (userOpHash: string) => Promise<string>;
}): Promise<{ userOpHash: string; txHash: string | null }> {
  const config = await fetchWalletConfig();
  const chain = primaryChain(config);
  if (!chain.feeTokenAddress || !config.bundlerBeneficiary) {
    throw new Error(t("wallet.removeNeedBundler"));
  }
  if (!chain.rpcUrl) throw new Error(t("wallet.removeNeedStore"));
  const feeAmount = BigInt(config.bundlerFeeUsdc || "0");
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const entryPoint = new Contract(config.entryPointAddress, ENTRYPOINT_ABI, provider);
  const nonce = BigInt(await entryPoint.getNonce(input.walletAddress, 0));
  const callData = encodeExecuteCallData([
    buildFeeTransferCall(chain.feeTokenAddress, config.bundlerBeneficiary, feeAmount),
    { target: input.storeAddress, value: 0n, data: input.storeData },
  ]);
  const unsigned = buildPackedUserOperation({
    sender: input.walletAddress,
    nonce,
    callData,
    gas: { verificationGasLimit: 1_000_000n, callGasLimit: 800_000n },
  });
  const userOpHash = (await entryPoint.getUserOpHash(userOpToTuple(unsigned))) as string;
  const signature = await input.signUserOp(userOpHash);
  const userOp: PackedUserOperationJson = { ...unsigned, signature };
  await submitUserOp({
    walletAddress: input.walletAddress,
    chainId: chain.chainId,
    userOpHash,
    userOp,
  });
  const result = await waitForUserOp(userOpHash);
  if (result.status !== "included") {
    const reason = result.rejectReason ?? result.status;
    if (reason && /LastMethod/i.test(reason)) throw new Error("last_method");
    throw new Error(formatSendRejectReason(reason, (key, vars) => t(key as Parameters<typeof t>[0], vars)));
  }
  return { userOpHash, txHash: result.txHash };
}

function methodKindNum(kind: IdentityMethodKind | undefined): number {
  if (kind === "yubikey") return METHOD_YUBIKEY;
  if (kind === "eoa") return METHOD_EOA;
  return METHOD_WEBAUTHN;
}

async function submitAddMethodUserOp(input: {
  identityId: string;
  walletAddress: string;
  qx: string;
  qy: string;
  authorization: string;
  storeAddress?: string;
  kind?: IdentityMethodKind;
  eoa?: string;
  signUserOp: (userOpHash: string) => Promise<string>;
}): Promise<{ userOpHash: string; txHash: string | null }> {
  const config = await fetchWalletConfig();
  const store = input.storeAddress ?? config.identityStoreAddress;
  if (!store) throw new Error(t("wallet.removeNeedStore"));
  const kind = methodKindNum(input.kind);
  const eoa = kind === METHOD_EOA ? (input.eoa ?? ZeroAddress) : ZeroAddress;
  const qx = kind === METHOD_EOA ? ZeroHash : input.qx;
  const qy = kind === METHOD_EOA ? ZeroHash : input.qy;
  return submitIdentityStoreUserOp({
    walletAddress: input.walletAddress,
    storeAddress: store,
    storeData: ADD_METHOD_IFACE.encodeFunctionData("addMethod", [
      input.identityId,
      kind,
      qx,
      qy,
      eoa,
      input.authorization,
    ]),
    signUserOp: input.signUserOp,
  });
}

export async function submitRecoverAddMethodUserOp(input: {
  identityId: string;
  walletAddress: string;
  proving: RecoverProvingMethod;
  qx: string;
  qy: string;
  authorization: string;
}): Promise<void> {
  await submitAddMethodUserOp({
    identityId: input.identityId,
    walletAddress: input.walletAddress,
    qx: input.qx,
    qy: input.qy,
    authorization: input.authorization,
    signUserOp: (userOpHash) =>
      signRecoverUserOpAuthorization({
        identityId: input.identityId,
        proving: input.proving,
        userOpHash,
      }),
  });
}

/** Session passkey signs the UserOp; the open identity wallet pays the bundler fee. */
export async function submitPairAddMethodUserOp(input: {
  session: WalletSession;
  qx: string;
  qy: string;
  authorization: string;
  storeAddress?: string;
  kind?: IdentityMethodKind;
  eoa?: string;
}): Promise<{ userOpHash: string; txHash: string | null }> {
  const identityId = input.session.identityId;
  if (!identityId) throw new Error(t("wallet.recoverNeedSession"));
  const passkey = await resolveCurrentWalletPasskey(input.session, "add-key");
  return submitAddMethodUserOp({
    identityId,
    walletAddress: input.session.address,
    qx: input.qx,
    qy: input.qy,
    authorization: input.authorization,
    storeAddress: input.storeAddress,
    kind: input.kind,
    eoa: input.eoa,
    signUserOp: (userOpHash) => signWithCurrentWalletPasskey(userOpHash, passkey, { path: "add-key" }),
  });
}

type IdentityDeviceRef = {
  ownerQx: string;
  ownerQy: string;
  credentialId?: string | null;
};

function padBytes32(value: string): string {
  try {
    return zeroPadValue(value, 32);
  } catch {
    return value;
  }
}

function sameHex(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

async function readOnChainMethodId(
  storeAddress: string,
  rpcUrl: string,
  identityId: string,
  device: IdentityDeviceRef
): Promise<string | null> {
  const provider = new JsonRpcProvider(rpcUrl);
  const store = new Contract(storeAddress, STORE_READ_ABI, provider);
  const candidates: { kind: number; qx: string; qy: string; eoa: string }[] = [];
  let eoa = parseEoaCredentialId(device.credentialId);
  if (!eoa && isEoaOwnerQy(device.ownerQy)) {
    try {
      eoa = eoaFromOwnerQx(device.ownerQx);
    } catch {
      eoa = null;
    }
  }
  if (eoa) {
    candidates.push({ kind: METHOD_EOA, qx: ZeroHash, qy: ZeroHash, eoa });
  }
  const qx = padBytes32(device.ownerQx);
  const qy = padBytes32(device.ownerQy);
  candidates.push({
    kind: METHOD_WEBAUTHN,
    qx,
    qy,
    eoa: ZeroAddress,
  });
  candidates.push({
    kind: METHOD_YUBIKEY,
    qx,
    qy,
    eoa: ZeroAddress,
  });
  for (const row of candidates) {
    const methodId = computeIdentityMethodId(identityId, row.kind, row.qx, row.qy, row.eoa);
    try {
      const rec = (await store.getMethod(methodId)) as { exists: boolean; identityId: string };
      if (rec.exists && rec.identityId.toLowerCase() === identityId.toLowerCase()) return methodId;
    } catch {
      /* keep probing */
    }
  }
  return null;
}

export async function identityWalletCanPay(walletAddress: string): Promise<{
  store: string | null;
  canPay: boolean;
  deployed: boolean;
}> {
  const store = await resolveIdentityStoreAddress(walletAddress);
  const config = await fetchWalletConfig();
  const chain = primaryChain(config);
  if (!store || !chain.feeTokenAddress || !config.bundlerBeneficiary) {
    return { store, canPay: false, deployed: false };
  }
  const feeAtoms = BigInt(config.bundlerFeeUsdc || "0");
  const balance = await fetchWalletBalance(walletAddress).catch(() => null);
  const primary = balance?.chains.find((c) => c.chainId === chain.chainId);
  const deployed = Boolean(primary?.deployed);
  const balanceAtoms = BigInt(primary?.balance ?? "0");
  const canPay = deployed && (feeAtoms <= 0n || balanceAtoms >= feeAtoms);
  return { store, canPay, deployed };
}

export async function findOnChainIdentityMethod(
  identityId: string,
  device: IdentityDeviceRef,
  walletAddress?: string
): Promise<{ store: string; methodId: string } | null> {
  const store = await resolveIdentityStoreAddress(walletAddress);
  if (!store) return null;
  const config = await fetchWalletConfig();
  const chain = primaryChain(config);
  if (!chain.rpcUrl) return null;
  const methodId = await readOnChainMethodId(store, chain.rpcUrl, identityId, device);
  return methodId ? { store, methodId } : null;
}

/** Session passkey as stored on IdentityStore (WebAuthn vs YubiKey). */
export async function resolveIdentitySignerMethod(
  identityId: string,
  qx: string,
  qy: string,
  storeAddress?: string
): Promise<{ kind: number; methodId: string } | null> {
  const store = storeAddress ?? (await resolveIdentityStoreAddress());
  if (!store) return null;
  const config = await fetchWalletConfig();
  const chain = primaryChain(config);
  if (!chain.rpcUrl) return null;
  const paddedQx = padBytes32(qx);
  const paddedQy = padBytes32(qy);
  try {
    const provider = new JsonRpcProvider(chain.rpcUrl);
    const contract = new Contract(store, STORE_READ_ABI, provider);
    const ids = (await contract.methodIdsOf(identityId)) as string[];
    for (const methodId of ids) {
      const rec = (await contract.getMethod(methodId)) as {
        exists?: boolean;
        identityId?: string;
        kind?: bigint | number;
        qx?: string;
        qy?: string;
        eoa?: string;
        0?: string;
        1?: bigint | number;
        2?: string;
        3?: string;
        5?: boolean;
      };
      const exists = Boolean(rec.exists ?? rec[5]);
      const recId = String(rec.identityId ?? rec[0] ?? "");
      if (!exists || recId.toLowerCase() !== identityId.toLowerCase()) continue;
      const kind = Number(rec.kind ?? rec[1]);
      if (kind === METHOD_EOA) continue;
      const recQx = String(rec.qx ?? rec[2] ?? "");
      const recQy = String(rec.qy ?? rec[3] ?? "");
      if (sameHex(recQx, paddedQx) && sameHex(recQy, paddedQy)) {
        return { kind, methodId };
      }
    }
  } catch {
    /* fall through to computed ids */
  }
  const methodId = await readOnChainMethodId(store, chain.rpcUrl, identityId, {
    ownerQx: paddedQx,
    ownerQy: paddedQy,
  });
  if (!methodId) return null;
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const rec = (await new Contract(store, STORE_READ_ABI, provider).getMethod(methodId)) as {
    kind: bigint | number;
  };
  return { kind: Number(rec.kind), methodId };
}

export async function hashRemoveMethodOnChain(
  storeAddress: string,
  identityId: string,
  methodId: string
): Promise<string> {
  const config = await fetchWalletConfig();
  const chain = primaryChain(config);
  if (!chain.rpcUrl) throw new Error(t("wallet.removeNeedStore"));
  const provider = new JsonRpcProvider(chain.rpcUrl);
  return (await new Contract(storeAddress, STORE_READ_ABI, provider).hashRemoveMethod(
    identityId,
    methodId
  )) as string;
}

export async function onChainIdentityMethodCount(
  identityId: string,
  storeAddress?: string
): Promise<number | null> {
  const store = storeAddress ?? (await resolveIdentityStoreAddress());
  if (!store) return null;
  const config = await fetchWalletConfig();
  const chain = primaryChain(config);
  if (!chain.rpcUrl) return null;
  try {
    const provider = new JsonRpcProvider(chain.rpcUrl);
    const rec = (await new Contract(store, STORE_READ_ABI, provider).getIdentity(identityId)) as {
      exists: boolean;
      methodCount: bigint | number;
    };
    if (!rec.exists) return 0;
    return Number(rec.methodCount);
  } catch {
    return null;
  }
}

/** Session passkey signs removeMethod; the open identity wallet pays the bundler fee. */
export async function submitPairRemoveMethodUserOp(input: {
  session: WalletSession;
  methodId: string;
  authorization: string;
  storeAddress: string;
}): Promise<{ userOpHash: string; txHash: string | null }> {
  const identityId = input.session.identityId;
  if (!identityId) throw new Error(t("wallet.recoverNeedSession"));
  const passkey = await resolveCurrentWalletPasskey(input.session, "remove-key");
  return submitIdentityStoreUserOp({
    walletAddress: input.session.address,
    storeAddress: input.storeAddress,
    storeData: REMOVE_METHOD_IFACE.encodeFunctionData("removeMethod", [
      identityId,
      input.methodId,
      input.authorization,
    ]),
    signUserOp: (userOpHash) => signWithCurrentWalletPasskey(userOpHash, passkey, { path: "remove-key" }),
  });
}