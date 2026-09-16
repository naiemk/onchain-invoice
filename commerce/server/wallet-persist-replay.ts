import type { CommerceDb } from "./db.js";
import {
  collectPersistEvents,
  WALLET_PERSIST_STREAM,
  type PersistLogEvent,
} from "./persist-log.js";
import { deriveWalletSalt } from "../shared/wallet-address.js";
import type { IdentityMethodKind } from "../shared/identity.js";

export { WALLET_PERSIST_STREAM };

export type WalletPersistState = {
  identities: Map<
    string,
    { identityId: string; email: string; googleSub: string | null; createdAt: string | null }
  >;
  methods: Map<
    string,
    {
      id: string;
      identityId: string;
      kind: IdentityMethodKind;
      credentialId: string | null;
      qx: string | null;
      qy: string | null;
      eoa: string | null;
    }
  >;
  accounts: Map<
    string,
    {
      address: string;
      salt: string;
      ownerQx: string;
      ownerQy: string;
      credentialId: string | null;
      identityId: string | null;
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
    identities: new Map(),
    methods: new Map(),
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

function asMethodKind(value: unknown): IdentityMethodKind {
  return value === "yubikey" || value === "eoa" ? value : "webauthn";
}

export function applyWalletPersistEvent(state: WalletPersistState, evt: PersistLogEvent): WalletPersistState {
  const p = evt.payload;
  switch (evt.type) {
    case "identity.created": {
      const identityId = String(p.identityId ?? "");
      const email = String(p.email ?? "").trim().toLowerCase();
      if (!identityId || !email) break;
      state.identities.set(identityId, {
        identityId,
        email,
        googleSub: p.googleSub != null ? String(p.googleSub) : null,
        createdAt: p.createdAt != null ? String(p.createdAt) : null,
      });
      break;
    }
    case "identity.google_sub": {
      const identityId = String(p.identityId ?? "");
      const identity = state.identities.get(identityId);
      if (identity && p.googleSub != null) identity.googleSub = String(p.googleSub);
      break;
    }
    case "identity.method_added": {
      const id = String(p.id ?? "");
      const identityId = String(p.identityId ?? "");
      if (!id || !identityId) break;
      state.methods.set(id, {
        id,
        identityId,
        kind: asMethodKind(p.kind),
        credentialId: p.credentialId != null ? String(p.credentialId) : null,
        qx: p.qx != null ? String(p.qx) : null,
        qy: p.qy != null ? String(p.qy) : null,
        eoa: p.eoa != null ? String(p.eoa) : null,
      });
      break;
    }
    case "identity.method_removed": {
      const id = String(p.id ?? "");
      if (id) state.methods.delete(id);
      break;
    }
    case "account.created": {
      const address = String(p.address ?? "").toLowerCase();
      if (!address) break;
      state.accounts.set(address, {
        address,
        salt: String(p.salt ?? ""),
        ownerQx: String(p.ownerQx ?? ""),
        ownerQy: String(p.ownerQy ?? ""),
        credentialId: p.credentialId != null ? String(p.credentialId) : null,
        identityId: p.identityId != null && String(p.identityId) ? String(p.identityId) : null,
        deployedChains: [],
      });
      break;
    }
    case "account.identity_updated": {
      const address = String(p.address ?? "").toLowerCase();
      const account = state.accounts.get(address);
      if (account && p.identityId != null) account.identityId = String(p.identityId);
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
    for (const identity of state.identities.values()) {
      db.upsertIdentity({
        identityId: identity.identityId,
        email: identity.email,
        googleSub: identity.googleSub,
        createdAt: identity.createdAt ?? undefined,
      });
    }
    for (const method of state.methods.values()) {
      db.insertIdentityMethod({
        id: method.id,
        identityId: method.identityId,
        kind: method.kind,
        credentialId: method.credentialId,
        qx: method.qx,
        qy: method.qy,
        eoa: method.eoa,
      });
    }
    for (const account of state.accounts.values()) {
      db.upsertWalletAccount({
        address: account.address,
        salt: account.salt || deriveWalletSalt(account.ownerQx, account.ownerQy),
        ownerQx: account.ownerQx,
        ownerQy: account.ownerQy,
        credentialId: account.credentialId,
        webauthnAttestation: null,
        identityId: account.identityId,
      });
      for (const chainId of account.deployedChains) {
        db.markWalletDeployed(account.address, chainId);
      }
      db.touchWalletActivation(account.address, false);
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
