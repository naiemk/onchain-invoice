import type { CommerceDb } from "./db.js";
import {
  collectPersistEvents,
  WALLET_PERSIST_STREAM,
  type PersistLogEvent,
} from "./persist-log.js";
import { deriveWalletSalt } from "../shared/wallet-address.js";

export { WALLET_PERSIST_STREAM };

export type WalletPersistState = {
  accounts: Map<
    string,
    {
      address: string;
      salt: string;
      ownerQx: string;
      ownerQy: string;
      credentialId: string | null;
      deployedChains: string[];
    }
  >;
  devices: Map<
    string,
    {
      walletAddress: string;
      chainId: string;
      ownerQx: string;
      ownerQy: string;
      label: string;
      credentialId: string | null;
    }
  >;
  emails: Map<string, { walletAddress: string; email: string; verifiedAt: string | null }>;
  entities: Map<string, { walletAddress: string; entityId: string; label: string | null }>;
  entityKeys: Map<
    string,
    {
      walletAddress: string;
      entityId: string;
      keyId: string;
      keyType: number;
      qx: string | null;
      qy: string | null;
      eoa: string | null;
      credentialId: string | null;
    }
  >;
};

export function emptyWalletPersistState(): WalletPersistState {
  return {
    accounts: new Map(),
    devices: new Map(),
    emails: new Map(),
    entities: new Map(),
    entityKeys: new Map(),
  };
}

function deviceKey(wallet: string, chainId: string, qx: string, qy: string): string {
  return `${wallet.toLowerCase()}|${chainId}|${qx}|${qy}`;
}

function entityKey(wallet: string, entityId: string): string {
  return `${wallet.toLowerCase()}|${entityId}`;
}

function entityKeyKey(wallet: string, keyId: string): string {
  return `${wallet.toLowerCase()}|${keyId}`;
}

export function applyWalletPersistEvent(state: WalletPersistState, evt: PersistLogEvent): WalletPersistState {
  const p = evt.payload;
  switch (evt.type) {
    case "account.created": {
      const address = String(p.address ?? "").toLowerCase();
      if (!address) break;
      state.accounts.set(address, {
        address,
        salt: String(p.salt ?? ""),
        ownerQx: String(p.ownerQx ?? ""),
        ownerQy: String(p.ownerQy ?? ""),
        credentialId: p.credentialId != null ? String(p.credentialId) : null,
        deployedChains: [],
      });
      break;
    }
    case "account.credential_updated": {
      const address = String(p.address ?? "").toLowerCase();
      const account = state.accounts.get(address);
      if (account && p.credentialId != null) {
        account.credentialId = String(p.credentialId);
      }
      break;
    }
    case "account.deployed": {
      const address = String(p.address ?? "").toLowerCase();
      const chainId = String(p.chainId ?? "");
      const account = state.accounts.get(address);
      if (account && chainId && !account.deployedChains.includes(chainId)) {
        account.deployedChains.push(chainId);
      }
      break;
    }
    case "device.registered": {
      const walletAddress = String(p.walletAddress ?? "").toLowerCase();
      const chainId = String(p.chainId ?? "");
      const ownerQx = String(p.ownerQx ?? "");
      const ownerQy = String(p.ownerQy ?? "");
      if (!walletAddress || !ownerQx || !ownerQy) break;
      state.devices.set(deviceKey(walletAddress, chainId, ownerQx, ownerQy), {
        walletAddress,
        chainId,
        ownerQx,
        ownerQy,
        label: String(p.label ?? "Passkey"),
        credentialId: p.credentialId != null ? String(p.credentialId) : null,
      });
      break;
    }
    case "device.removed": {
      const walletAddress = String(p.walletAddress ?? "").toLowerCase();
      const chainId = String(p.chainId ?? "");
      const ownerQx = String(p.ownerQx ?? "");
      const ownerQy = String(p.ownerQy ?? "");
      state.devices.delete(deviceKey(walletAddress, chainId, ownerQx, ownerQy));
      break;
    }
    case "email.verified": {
      const walletAddress = String(p.walletAddress ?? "").toLowerCase();
      const email = String(p.email ?? "").trim().toLowerCase();
      if (!walletAddress || !email) break;
      state.emails.set(walletAddress, {
        walletAddress,
        email,
        verifiedAt: String(p.verifiedAt ?? evt.ts),
      });
      break;
    }
    case "entity.registered": {
      const walletAddress = String(p.walletAddress ?? "").toLowerCase();
      const entityId = String(p.entityId ?? "");
      if (!walletAddress || !entityId) break;
      state.entities.set(entityKey(walletAddress, entityId), {
        walletAddress,
        entityId,
        label: p.label != null ? String(p.label) : null,
      });
      break;
    }
    case "entity_key.registered": {
      const walletAddress = String(p.walletAddress ?? "").toLowerCase();
      const keyId = String(p.keyId ?? "");
      if (!walletAddress || !keyId) break;
      state.entityKeys.set(entityKeyKey(walletAddress, keyId), {
        walletAddress,
        entityId: String(p.entityId ?? ""),
        keyId,
        keyType: Number(p.keyType ?? 0),
        qx: p.qx != null ? String(p.qx) : null,
        qy: p.qy != null ? String(p.qy) : null,
        eoa: p.eoa != null ? String(p.eoa) : null,
        credentialId: p.credentialId != null ? String(p.credentialId) : null,
      });
      break;
    }
    default:
      break;
  }
  return state;
}

export function replayWalletPersistState(events: PersistLogEvent[]): WalletPersistState {
  let state = emptyWalletPersistState();
  for (const evt of events) {
    if (evt.stream !== WALLET_PERSIST_STREAM) continue;
    state = applyWalletPersistEvent(state, evt);
  }
  return state;
}

export function applyWalletPersistStateToDb(db: CommerceDb, state: WalletPersistState): void {
  db.runWithoutPersistLog(() => {
    for (const account of state.accounts.values()) {
      db.upsertWalletAccount({
        address: account.address,
        salt: account.salt || deriveWalletSalt(account.ownerQx, account.ownerQy),
        ownerQx: account.ownerQx,
        ownerQy: account.ownerQy,
        credentialId: account.credentialId,
        webauthnAttestation: null,
      });
      for (const chainId of account.deployedChains) {
        db.markWalletDeployed(account.address, chainId);
      }
    }
    for (const device of state.devices.values()) {
      db.upsertWalletDevice({
        walletAddress: device.walletAddress,
        chainId: device.chainId,
        ownerQx: device.ownerQx,
        ownerQy: device.ownerQy,
        label: device.label,
        credentialId: device.credentialId,
      });
    }
    for (const email of state.emails.values()) {
      db.upsertWalletEmail({
        walletAddress: email.walletAddress,
        email: email.email,
        verifiedAt: email.verifiedAt,
      });
    }
    for (const entity of state.entities.values()) {
      db.upsertWalletEntity({
        walletAddress: entity.walletAddress,
        entityId: entity.entityId,
        label: entity.label,
      });
    }
    for (const key of state.entityKeys.values()) {
      db.upsertWalletEntityKey({
        walletAddress: key.walletAddress,
        entityId: key.entityId,
        keyId: key.keyId,
        keyType: key.keyType,
        qx: key.qx,
        qy: key.qy,
        eoa: key.eoa,
        credentialId: key.credentialId,
      });
    }
  });
}

export async function replayWalletPersistLogToDb(db: CommerceDb, logDir: string): Promise<WalletPersistState> {
  const events = await collectPersistEvents(logDir, WALLET_PERSIST_STREAM);
  const state = replayWalletPersistState(events);
  applyWalletPersistStateToDb(db, state);
  return state;
}
