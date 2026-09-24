import { Contract, JsonRpcProvider, Wallet, ZeroAddress, getAddress } from "ethers";
import type { IdentityConfig } from "./config.js";

const STORE_ABI = [
  "function register(bytes32 identityId, bytes32 qx, bytes32 qy)",
  "function addMethod(bytes32 identityId, uint8 kind, bytes32 qx, bytes32 qy, address eoa, bytes authorization)",
  "function removeMethod(bytes32 identityId, bytes32 methodId, bytes authorization)",
  "function restoreAddMethod(bytes32 identityId, uint8 kind, bytes32 qx, bytes32 qy, address eoa)",
  "function initiateRestore(bytes32 identityId, uint8 kind, bytes32 qx, bytes32 qy, address eoa)",
  "function executeRestore(bytes32 identityId)",
  "function cancelRestore(bytes32 identityId, bytes authorization)",
  "function pendingRestores(bytes32 identityId) view returns (uint8 kind, bytes32 qx, bytes32 qy, address eoa, uint64 executeAfter, bool active)",
  "function restoreDelay() view returns (uint64)",
  "function recoveryOperator() view returns (address)",
  "function identityExists(bytes32 identityId) view returns (bool)",
  "function getIdentity(bytes32 identityId) view returns (tuple(bool exists, bool restoreEnabled, uint8 methodCount, uint8 eoaCount, uint8 webauthnCount, uint8 yubikeyCount))",
  "function getMethod(bytes32 methodId) view returns (tuple(bytes32 identityId, uint8 kind, bytes32 qx, bytes32 qy, address eoa, bool exists))",
];

const FACTORY_ABI = [
  "function createAccount(bytes32 identityId, bytes32 salt) returns (address)",
  "function predictAddress(bytes32 salt) view returns (address)",
  "function store() view returns (address)",
];

const STORE_VIEW_ABI = ["function store() view returns (address)"];

let discoveredStore: string | null | undefined;

/** Env store, or IdentityWalletFactory.store() when the factory is the identity factory. */
export async function discoverIdentityStoreAddress(config: IdentityConfig): Promise<string | null> {
  if (config.storeAddress) return config.storeAddress;
  if (discoveredStore !== undefined) return discoveredStore;
  if (!config.rpcUrl || !config.walletFactoryAddress) {
    discoveredStore = null;
    return null;
  }
  try {
    const provider = new JsonRpcProvider(config.rpcUrl);
    const factory = new Contract(config.walletFactoryAddress, STORE_VIEW_ABI, provider);
    const store = (await factory.store()) as string;
    discoveredStore = store && store !== ZeroAddress ? getAddress(store) : null;
  } catch {
    discoveredStore = null;
  }
  return discoveredStore;
}

function providerFor(config: IdentityConfig): JsonRpcProvider | null {
  if (!config.rpcUrl || !config.storeAddress) return null;
  return new JsonRpcProvider(config.rpcUrl);
}

export async function readIdentityRestoreEnabled(
  config: IdentityConfig,
  identityId: string
): Promise<boolean> {
  if (config.restoreEnabledOverride === false) return false;
  if (config.restoreEnabledOverride === true) return true;
  const provider = providerFor(config);
  if (!provider || !config.storeAddress) return true;
  try {
    const store = new Contract(config.storeAddress, STORE_ABI, provider);
    const rec = (await store.getIdentity(identityId)) as {
      exists: boolean;
      restoreEnabled: boolean;
    };
    if (!rec.exists) return true;
    return Boolean(rec.restoreEnabled);
  } catch {
    return true;
  }
}

export async function identityMethodExistsOnChain(
  config: IdentityConfig,
  methodId: string
): Promise<boolean> {
  const provider = providerFor(config);
  if (!provider || !config.storeAddress) return true;
  try {
    const store = new Contract(config.storeAddress, STORE_ABI, provider);
    const rec = (await store.getMethod(methodId)) as { exists: boolean };
    return Boolean(rec.exists);
  } catch {
    return false;
  }
}

function signerFor(config: IdentityConfig): { provider: JsonRpcProvider; wallet: Wallet } | null {
  if (!config.rpcUrl || !config.deployerPrivateKey || !config.storeAddress) return null;
  const provider = new JsonRpcProvider(config.rpcUrl);
  return { provider, wallet: new Wallet(config.deployerPrivateKey, provider) };
}

export async function registerIdentityOnChain(
  config: IdentityConfig,
  identityId: string,
  qx: string,
  qy: string
): Promise<boolean> {
  const ctx = signerFor(config);
  if (!ctx) return false;
  const store = new Contract(config.storeAddress!, STORE_ABI, ctx.wallet);
  const exists = (await store.identityExists(identityId)) as boolean;
  if (exists) return true;
  const tx = await store.register(identityId, qx, qy);
  await tx.wait();
  return true;
}

export async function addIdentityMethodOnChain(
  config: IdentityConfig,
  input: {
    identityId: string;
    kind: number;
    qx: string;
    qy: string;
    eoa?: string;
    authorization: string;
  }
): Promise<boolean> {
  const ctx = signerFor(config);
  if (!ctx) return false;
  const store = new Contract(config.storeAddress!, STORE_ABI, ctx.wallet);
  const tx = await store.addMethod(
    input.identityId,
    input.kind,
    input.qx,
    input.qy,
    input.eoa && input.eoa !== ZeroAddress ? getAddress(input.eoa) : ZeroAddress,
    input.authorization
  );
  await tx.wait();
  return true;
}

export async function removeIdentityMethodOnChain(
  config: IdentityConfig,
  input: { identityId: string; methodId: string; authorization: string }
): Promise<boolean> {
  const ctx = signerFor(config);
  if (!ctx) return false;
  const store = new Contract(config.storeAddress!, STORE_ABI, ctx.wallet);
  const tx = await store.removeMethod(input.identityId, input.methodId, input.authorization);
  await tx.wait();
  return true;
}

export async function restoreIdentityMethodOnChain(
  config: IdentityConfig,
  input: { identityId: string; kind: number; qx: string; qy: string; eoa?: string }
): Promise<boolean> {
  const ctx = signerFor(config);
  if (!ctx) return false;
  const store = new Contract(config.storeAddress!, STORE_ABI, ctx.wallet);
  const eoa = input.eoa && input.eoa !== ZeroAddress ? getAddress(input.eoa) : ZeroAddress;
  const delay = Number(await store.restoreDelay());
  if (delay === 0) {
    const tx = await store.restoreAddMethod(input.identityId, input.kind, input.qx, input.qy, eoa);
    await tx.wait();
    return true;
  }
  const tx = await store.initiateRestore(input.identityId, input.kind, input.qx, input.qy, eoa);
  await tx.wait();
  return true;
}

export async function executeIdentityRestoreOnChain(
  config: IdentityConfig,
  identityId: string
): Promise<boolean> {
  const ctx = signerFor(config);
  if (!ctx) return false;
  const store = new Contract(config.storeAddress!, STORE_ABI, ctx.wallet);
  const tx = await store.executeRestore(identityId);
  await tx.wait();
  return true;
}

export async function cancelIdentityRestoreOnChain(
  config: IdentityConfig,
  identityId: string,
  authorization: string
): Promise<boolean> {
  const ctx = signerFor(config);
  if (!ctx) return false;
  const store = new Contract(config.storeAddress!, STORE_ABI, ctx.wallet);
  const tx = await store.cancelRestore(identityId, authorization);
  await tx.wait();
  return true;
}

export type PendingIdentityRestore = {
  kind: number;
  qx: string;
  qy: string;
  eoa: string;
  executeAfter: string;
  active: boolean;
};

export async function readPendingIdentityRestore(
  config: IdentityConfig,
  identityId: string
): Promise<PendingIdentityRestore | null> {
  const provider = providerFor(config);
  if (!provider || !config.storeAddress) return null;
  try {
    const store = new Contract(config.storeAddress, STORE_ABI, provider);
    const rec = (await store.pendingRestores(identityId)) as {
      kind: bigint | number;
      qx: string;
      qy: string;
      eoa: string;
      executeAfter: bigint;
      active: boolean;
    };
    return {
      kind: Number(rec.kind),
      qx: rec.qx,
      qy: rec.qy,
      eoa: rec.eoa,
      executeAfter: rec.executeAfter.toString(),
      active: Boolean(rec.active),
    };
  } catch {
    return null;
  }
}

export async function readIdentityRecoveryOperator(config: IdentityConfig): Promise<string | null> {
  const provider = providerFor(config);
  if (!provider || !config.storeAddress) return null;
  try {
    const store = new Contract(config.storeAddress, STORE_ABI, provider);
    const op = (await store.recoveryOperator()) as string;
    return op && op !== ZeroAddress ? getAddress(op) : null;
  } catch {
    return null;
  }
}

export async function createIdentityWalletOnChain(
  config: IdentityConfig,
  identityId: string,
  salt: string
): Promise<boolean> {
  if (!config.walletFactoryAddress) return false;
  const ctx = signerFor(config);
  if (!ctx) return false;
  const factory = new Contract(config.walletFactoryAddress, FACTORY_ABI, ctx.wallet);
  const tx = await factory.createAccount(identityId, salt);
  await tx.wait();
  return true;
}
