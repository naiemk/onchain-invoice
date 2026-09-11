import { Contract, JsonRpcProvider, ZeroAddress, ZeroHash } from "ethers";
import { t } from "../i18n/t.js";
import {
  WALLET_ADVANCED_ABI,
  computeKeyId,
  encodeAdvancedSignature,
  KEY_EOA,
  KEY_WEBAUTHN,
  KEY_YUBIKEY,
} from "../../../commerce/shared/advanced-wallet.js";
import type { WalletEntityKeyRecord } from "../../../commerce/shared/wallet.js";
import { credentialIdsMatch } from "./credential-id.js";
import { signUserOpTypedData } from "./eoa-connector.js";
import { fetchWalletConfig, getWalletAccount, listDevices, primaryChain } from "./wallet-api.js";
import { fetchAdvancedPolicy, listWalletEntities } from "./wallet-advanced-api.js";
import {
  loadWalletSession,
  saveWalletSessionIfActive,
  listWalletRegistry,
  type WalletSession,
} from "./wallet-session.js";
import { signUserOpHash } from "./webauthn.js";
import { encodedWebAuthnMatchResult } from "./webauthn-p256.js";
import { selectPubkeyForCredential, collectRosterEntityIds, passkeyKeyIdCandidates } from "./wallet-passkey-bind.js";

const SIMPLE_OWNER_ABI = [
  "function isOwner(bytes32 qx, bytes32 qy) view returns (bool)",
  "function ownerCount() view returns (uint256)",
  "function ownerAt(uint256 index) view returns (bytes32 qx, bytes32 qy)",
];
const PASSKEY_LOG_KEY = "tc-wallet-passkey-log";
const PASSKEY_LOG_LIMIT = 20;

export type WalletPasskeyPath =
  | "unlock"
  | "heal"
  | "send"
  | "pairing-confirm"
  | "add-key"
  | "remove-key"
  | "proposal-sign"
  | "enable-advanced"
  | "configure"
  | "add-entity"
  | "remove-entity"
  | "unknown";

export type CurrentWalletPasskey = {
  address: string;
  chainId?: string;
  credentialId: string;
  qx: string;
  qy: string;
  advanced: boolean;
  entityId?: string;
  keyId?: string;
  keyType?: number;
  eoa?: string;
};

function fp(hex: string | undefined | null): string {
  if (!hex) return "";
  const raw = hex.replace(/^0x/i, "");
  if (raw.length <= 14) return hex;
  return `0x${raw.slice(0, 8)}…${raw.slice(-4)}`;
}

function credFp(id: string | undefined | null): string {
  if (!id) return "";
  if (id.length <= 14) return id;
  return `${id.slice(0, 8)}…${id.slice(-4)}`;
}

function sameHex(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

function isZeroBytes32(value: string | undefined | null): boolean {
  if (!value) return true;
  return /^0x0+$/i.test(value);
}

/** Resolve threw because Super Wallet metadata (entityId) is missing, not because the passkey is gone. */
export const SUPER_WALLET_NO_ENTITY = "super_wallet_no_entity";

function candidatePasskeyKeyIds(input: {
  preferredKeyId?: string;
  entityId?: string;
  entityIds: string[];
  keyType?: number;
  qx: string;
  qy: string;
}): string[] {
  const ids: string[] = [];
  if (input.preferredKeyId) ids.push(input.preferredKeyId);
  const entityIds = input.entityId
    ? [input.entityId, ...input.entityIds.filter((id) => !sameHex(id, input.entityId))]
    : input.entityIds;
  for (const c of passkeyKeyIdCandidates(entityIds, input.qx, input.qy, input.keyType ?? KEY_WEBAUTHN)) {
    ids.push(c.keyId);
  }
  return ids;
}

function noEntityError(): Error {
  return Object.assign(new Error(t("wallet.superWalletNoSigningKey")), { code: SUPER_WALLET_NO_ENTITY });
}

export function logWalletPasskey(event: Record<string, unknown>): void {
  const line = { t: Date.now(), ...event };
  console.info("[wallet-passkey]", line);
  try {
    const prev = JSON.parse(sessionStorage.getItem(PASSKEY_LOG_KEY) || "[]") as unknown[];
    const next = [...prev, line].slice(-PASSKEY_LOG_LIMIT);
    sessionStorage.setItem(PASSKEY_LOG_KEY, JSON.stringify(next));
  } catch {
    /* ignore quota / private mode */
  }
}

async function readKeyRecord(
  walletAddress: string,
  keyId: string
): Promise<{ entityId: string; keyType: number; qx: string; qy: string; eoa: string } | null> {
  const cfg = await fetchWalletConfig();
  const chain = primaryChain(cfg);
  if (!chain.rpcUrl) throw new Error("RPC not configured");
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const code = await provider.getCode(walletAddress);
  if (!code || code === "0x") return null;
  const wallet = new Contract(walletAddress, WALLET_ADVANCED_ABI, provider);
  const rec = await wallet.getKeyRecord(keyId);
  const entityId = String(rec.entityId ?? rec[0] ?? "");
  if (isZeroBytes32(entityId)) return null;
  return {
    entityId,
    keyType: Number(rec.keyType ?? rec[1] ?? 0),
    qx: String(rec.qx ?? rec[2] ?? ""),
    qy: String(rec.qy ?? rec[3] ?? ""),
    eoa: String(rec.eoa ?? rec[4] ?? ZeroAddress),
  };
}

async function readFirstKeyRecord(
  walletAddress: string,
  keyIds: string[]
): Promise<{ keyId: string; rec: NonNullable<Awaited<ReturnType<typeof readKeyRecord>>> } | null> {
  const seen = new Set<string>();
  for (const keyId of keyIds) {
    if (!keyId || seen.has(keyId.toLowerCase())) continue;
    seen.add(keyId.toLowerCase());
    try {
      const rec = await readKeyRecord(walletAddress, keyId);
      if (rec) return { keyId, rec };
    } catch {
      /* try the next candidate */
    }
  }
  return null;
}

async function readIsOwner(walletAddress: string, qx: string, qy: string): Promise<boolean | null> {
  const cfg = await fetchWalletConfig();
  const chain = primaryChain(cfg);
  if (!chain.rpcUrl) return null;
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const code = await provider.getCode(walletAddress);
  if (!code || code === "0x") return null;
  const wallet = new Contract(walletAddress, SIMPLE_OWNER_ABI, provider);
  return Boolean(await wallet.isOwner(qx, qy));
}

async function listOnChainOwnerCoords(walletAddress: string): Promise<{ qx: string; qy: string }[]> {
  const cfg = await fetchWalletConfig();
  const chain = primaryChain(cfg);
  if (!chain.rpcUrl) return [];
  const provider = new JsonRpcProvider(chain.rpcUrl);
  const code = await provider.getCode(walletAddress);
  if (!code || code === "0x") return [];
  const wallet = new Contract(walletAddress, SIMPLE_OWNER_ABI, provider);
  const count = Number(await wallet.ownerCount());
  const out: { qx: string; qy: string }[] = [];
  for (let i = 0; i < count; i++) {
    const rec = await wallet.ownerAt(i);
    out.push({ qx: String(rec.qx ?? rec[0] ?? ""), qy: String(rec.qy ?? rec[1] ?? "") });
  }
  return out;
}

function credentialIdForSession(session: WalletSession): string {
  const fromSession = session.credentialId?.trim() ?? "";
  if (fromSession) return fromSession;
  const addr = session.address.toLowerCase();
  const fromRegistry =
    listWalletRegistry().find((w) => w.address.toLowerCase() === addr && w.credentialId?.trim())?.credentialId?.trim() ??
    "";
  return fromRegistry;
}

async function pubkeyForCredential(
  session: WalletSession,
  credentialId: string,
  rosterKeys: WalletEntityKeyRecord[]
): Promise<{
  qx: string;
  qy: string;
  source: string;
  rosterCred: boolean;
  registryCred: boolean;
  sessionCred: boolean;
  accountCredFp: string;
  deviceFirstOwner: boolean;
}> {
  const registry = listWalletRegistry().find((w) => credentialIdsMatch(w.credentialId, credentialId));
  const account = await getWalletAccount(session.address).catch(() => null);
  let devices: Awaited<ReturnType<typeof listDevices>> = [];
  try {
    const cfg = await fetchWalletConfig();
    devices = await listDevices(session.address, cfg.chainId);
  } catch {
    /* offline */
  }
  const pub = selectPubkeyForCredential({
    credentialId,
    account,
    rosterKeys,
    registry: registry ? { credentialId: registry.credentialId, qx: registry.qx, qy: registry.qy } : null,
    session,
    devices,
  });
  const device = devices.find((d) => d.credentialId && credentialIdsMatch(d.credentialId, credentialId));
  return {
    ...pub,
    rosterCred: Boolean(
      rosterKeys.find((k) => k.credentialId && credentialIdsMatch(k.credentialId, credentialId))
    ),
    registryCred: Boolean(registry),
    sessionCred: Boolean(credentialIdsMatch(session.credentialId, credentialId)),
    accountCredFp: credFp(account?.credentialId),
    deviceFirstOwner: Boolean(
      device && account && sameHex(device.ownerQx, account.ownerQx) && sameHex(device.ownerQy, account.ownerQy)
    ),
  };
}

export function persistCurrentWalletPasskey(
  passkey: CurrentWalletPasskey,
  session?: WalletSession | null
): WalletSession {
  const base = session ?? loadWalletSession();
  if (!base) {
    throw new Error(t("wallet.passkeyMissingOnDevice"));
  }
  const next: WalletSession = {
    ...base,
    address: passkey.address,
    qx: passkey.qx,
    qy: passkey.qy,
    credentialId: passkey.credentialId,
    entityId: passkey.entityId ?? base.entityId,
    keyId: passkey.keyId ?? base.keyId,
    keyType: passkey.keyType ?? base.keyType,
    eoa: passkey.eoa ?? base.eoa,
  };
  saveWalletSessionIfActive(next);
  return next;
}

export function passkeyToEntityKey(passkey: CurrentWalletPasskey): WalletEntityKeyRecord {
  return {
    walletAddress: passkey.address,
    entityId: passkey.entityId ?? ZeroHash,
    keyId: passkey.keyId ?? ZeroHash,
    keyType: passkey.keyType ?? KEY_WEBAUTHN,
    qx: passkey.qx,
    qy: passkey.qy,
    eoa: passkey.eoa ?? null,
    credentialId: passkey.credentialId,
    createdAt: "",
  };
}

function webAuthnRosterKey(
  roster: WalletEntityKeyRecord[],
  credentialId: string,
  pub: { qx: string; qy: string }
): WalletEntityKeyRecord | undefined {
  return (
    roster.find(
      (k) =>
        k.keyType !== KEY_EOA && k.credentialId && credentialIdsMatch(k.credentialId, credentialId)
    ) ?? roster.find((k) => k.keyType !== KEY_EOA && sameHex(k.qx, pub.qx) && sameHex(k.qy, pub.qy))
  );
}

/** Bind this browser's passkey to the on-chain key the contract will accept. */
export async function resolveCurrentWalletPasskey(
  session: WalletSession,
  path: WalletPasskeyPath = "unknown",
  options?: { persist?: boolean }
): Promise<CurrentWalletPasskey> {
  const credentialId = credentialIdForSession(session);
  const address = session.address;
  if (!credentialId) {
    logWalletPasskey({
      phase: "resolve",
      path,
      ok: false,
      rejectReason: "missing_credential",
      address: fp(address),
    });
    throw new Error(t("wallet.passkeyMissingOnDevice"));
  }

  const policy = await fetchAdvancedPolicy(address).catch(() => null);
  const advanced = policy?.advanced === true;
  const roster = await listWalletEntities(address).catch(() => ({
    entities: [],
    keys: [] as WalletEntityKeyRecord[],
  }));
  const pub = await pubkeyForCredential(session, credentialId, roster.keys);

  if (!advanced) {
    if (!pub.qx || !pub.qy) {
      logWalletPasskey({
        phase: "resolve",
        path,
        ok: false,
        rejectReason: pub.source === "poisoned_device_row" ? "poisoned_device_row" : "no_pubkey",
        address: fp(address),
        credentialFp: credFp(credentialId),
        pubSource: pub.source,
      });
      throw new Error(t("wallet.passkeyNotOnChain"));
    }
    let onChainOwner: boolean | null = null;
    try {
      onChainOwner = await readIsOwner(address, pub.qx, pub.qy);
    } catch (error) {
      logWalletPasskey({
        phase: "resolve",
        path,
        advanced: false,
        rejectReason: "isOwner_rpc",
        address: fp(address),
        credentialFp: credFp(credentialId),
        qxFp: fp(pub.qx),
        message: error instanceof Error ? error.message : String(error),
      });
    }
    if (onChainOwner === false) {
      logWalletPasskey({
        phase: "resolve",
        path,
        ok: false,
        advanced: false,
        rejectReason: "not_on_chain_owner",
        address: fp(address),
        credentialFp: credFp(credentialId),
        qxFp: fp(pub.qx),
        qyFp: fp(pub.qy),
        onChainKeyFound: false,
      });
      throw new Error(t("wallet.passkeyNotOnChain"));
    }
    const passkey: CurrentWalletPasskey = {
      address,
      chainId: session.chainId,
      credentialId,
      qx: pub.qx,
      qy: pub.qy,
      advanced: false,
    };
    logWalletPasskey({
      phase: "resolve",
      path,
      ok: true,
      advanced: false,
      address: fp(address),
      credentialFp: credFp(credentialId),
      qxFp: fp(pub.qx),
      qyFp: fp(pub.qy),
      pubSource: pub.source,
      rosterCred: pub.rosterCred,
      registryCred: pub.registryCred,
      sessionCred: pub.sessionCred,
      accountCredFp: pub.accountCredFp,
      deviceFirstOwner: pub.deviceFirstOwner,
      onChainKeyFound: onChainOwner === true,
    });
    if (options?.persist !== false) persistCurrentWalletPasskey(passkey, session);
    return passkey;
  }

  const coords = {
    qx: pub.qx || session.qx || "",
    qy: pub.qy || session.qy || "",
  };
  const mine =
    webAuthnRosterKey(roster.keys, credentialId, coords) ??
    (session.keyId ? roster.keys.find((k) => sameHex(k.keyId, session.keyId)) : undefined);
  const qx = mine?.qx && !isZeroBytes32(mine.qx) ? mine.qx : coords.qx;
  const qy = mine?.qy && !isZeroBytes32(mine.qy) ? mine.qy : coords.qy;
  if (!qx || !qy) {
    logWalletPasskey({
      phase: "resolve",
      path,
      ok: false,
      advanced: true,
      rejectReason: pub.source === "poisoned_device_row" ? "poisoned_device_row" : "no_pubkey",
      address: fp(address),
      credentialFp: credFp(credentialId),
      pubSource: pub.source,
    });
    throw new Error(t("wallet.passkeyNotOnChain"));
  }

  const rosterEntityIds = collectRosterEntityIds(roster.entities, roster.keys);
  const entityId = mine?.entityId || session.entityId;
  const keyType = mine?.keyType ?? session.keyType ?? KEY_WEBAUTHN;
  const keyIds = candidatePasskeyKeyIds({
    preferredKeyId: mine?.keyId && mine.keyType !== KEY_EOA ? mine.keyId : undefined,
    entityId,
    entityIds: rosterEntityIds,
    keyType,
    qx,
    qy,
  });
  const found = await readFirstKeyRecord(address, keyIds);
  const onChain = found?.rec ?? null;
  const keyId = found?.keyId;
  const localQx = (onChain?.qx && !isZeroBytes32(onChain.qx) ? onChain.qx : qx) ?? qx;
  const localQy = (onChain?.qy && !isZeroBytes32(onChain.qy) ? onChain.qy : qy) ?? qy;
  const qxEqual = sameHex(qx, localQx);
  const rejectReason = onChain
    ? qxEqual || onChain.keyType === KEY_EOA
      ? undefined
      : "pubkey_mismatch"
    : entityId || rosterEntityIds.length
      ? "empty_key_record"
      : "no_entity";

  logWalletPasskey({
    phase: "resolve",
    path,
    ok: Boolean(onChain),
    advanced: true,
    address: fp(address),
    credentialFp: credFp(credentialId),
    qxFp: fp(qx),
    qyFp: fp(qy),
    entityFp: fp(onChain?.entityId ?? entityId),
    keyFp: fp(keyId),
    keyType: onChain?.keyType ?? keyType,
    pubSource: pub.source,
    rosterCred: pub.rosterCred,
    registryCred: pub.registryCred,
    sessionCred: pub.sessionCred,
    accountCredFp: pub.accountCredFp,
    deviceFirstOwner: pub.deviceFirstOwner,
    onChainKeyFound: Boolean(onChain),
    localVsOnChainQxEqual: qxEqual,
    rejectReason,
  });

  if (!onChain || !keyId) {
    if (rejectReason === "no_entity") throw noEntityError();
    throw new Error(t("wallet.passkeyNotOnChain"));
  }
  if (!qxEqual && onChain.keyType !== KEY_EOA) {
    throw new Error(t("wallet.passkeyNotOnChain"));
  }

  const passkey: CurrentWalletPasskey = {
    address,
    chainId: session.chainId,
    credentialId,
    qx: localQx,
    qy: localQy,
    advanced: true,
    entityId: onChain.entityId,
    keyId,
    keyType: onChain.keyType,
    eoa: onChain.eoa && onChain.eoa !== ZeroAddress ? onChain.eoa : undefined,
  };
  if (options?.persist !== false) persistCurrentWalletPasskey(passkey, session);
  return passkey;
}

type PasskeyCandidate = {
  qx: string;
  qy: string;
  keyId?: string;
  entityId?: string;
  keyType?: number;
  source: string;
};

async function assertionCandidates(
  passkey: CurrentWalletPasskey
): Promise<PasskeyCandidate[]> {
  const out: PasskeyCandidate[] = [
    {
      qx: passkey.qx,
      qy: passkey.qy,
      keyId: passkey.keyId,
      entityId: passkey.entityId,
      keyType: passkey.keyType,
      source: "resolved",
    },
  ];
  const roster = await listWalletEntities(passkey.address).catch(() => ({
    entities: [] as { entityId: string }[],
    keys: [] as WalletEntityKeyRecord[],
  }));
  for (const k of roster.keys) {
    if (k.keyType === KEY_EOA || !k.qx || !k.qy || isZeroBytes32(k.qx)) continue;
    out.push({
      qx: k.qx,
      qy: k.qy,
      keyId: k.keyId,
      entityId: k.entityId,
      keyType: k.keyType,
      source: "roster",
    });
  }
  if (passkey.entityId) {
    const owners = await listOnChainOwnerCoords(passkey.address).catch(() => []);
    for (const owner of owners) {
      if (!owner.qx || isZeroBytes32(owner.qx)) continue;
      out.push({
        qx: owner.qx,
        qy: owner.qy,
        keyId: computeKeyId(passkey.entityId, KEY_WEBAUTHN, owner.qx, owner.qy, ZeroAddress),
        entityId: passkey.entityId,
        keyType: KEY_WEBAUTHN,
        source: "ownerAt",
      });
    }
  }
  const seen = new Set<string>();
  return out.filter((c) => {
    const id = `${c.qx.toLowerCase()}:${c.qy.toLowerCase()}:${(c.keyId ?? "").toLowerCase()}`;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

async function matchPasskeyToAssertion(
  inner: string,
  passkey: CurrentWalletPasskey,
  userOpHash: string,
  path: WalletPasskeyPath
): Promise<CurrentWalletPasskey> {
  const candidates = await assertionCandidates(passkey);
  let sawVerify = false;
  for (const c of candidates) {
    const result = await encodedWebAuthnMatchResult(inner, c.qx, c.qy, userOpHash);
    if (result === "unavailable") continue;
    sawVerify = true;
    if (result !== "yes") continue;
    const next: CurrentWalletPasskey = {
      ...passkey,
      qx: c.qx,
      qy: c.qy,
      keyId: c.keyId ?? passkey.keyId,
      entityId: c.entityId ?? passkey.entityId,
      keyType: c.keyType ?? passkey.keyType,
    };
    logWalletPasskey({
      phase: "assert-match",
      path,
      ok: true,
      source: c.source,
      qxFp: fp(c.qx),
      keyFp: fp(next.keyId),
      recovered: !sameHex(c.qx, passkey.qx),
    });
    if (!sameHex(c.qx, passkey.qx) || (next.keyId && !sameHex(next.keyId, passkey.keyId))) {
      persistCurrentWalletPasskey(next);
    }
    return next;
  }
  if (!sawVerify) {
    logWalletPasskey({
      phase: "assert-match",
      path,
      ok: false,
      source: "unverified",
      qxFp: fp(passkey.qx),
      keyFp: fp(passkey.keyId),
      rejectReason: "p256_verify_unavailable",
      candidateCount: candidates.length,
    });
    throw new Error(t("wallet.passkeyNotOnChain"));
  }
  logWalletPasskey({
    phase: "assert-match",
    path,
    ok: false,
    rejectReason: "assertion_pubkey_mismatch",
    address: fp(passkey.address),
    credentialFp: credFp(passkey.credentialId),
    qxFp: fp(passkey.qx),
    keyFp: fp(passkey.keyId),
    candidateCount: candidates.length,
  });
  throw new Error(t("wallet.passkeyNotOnChain"));
}

export async function signWithCurrentWalletPasskey(
  userOpHash: string,
  passkey: CurrentWalletPasskey,
  opts?: { innerOnly?: boolean; path?: WalletPasskeyPath }
): Promise<string> {
  const path = opts?.path ?? "unknown";
  logWalletPasskey({
    phase: "sign",
    path,
    advanced: passkey.advanced,
    address: fp(passkey.address),
    credentialFp: credFp(passkey.credentialId),
    qxFp: fp(passkey.qx),
    entityFp: fp(passkey.entityId),
    keyFp: fp(passkey.keyId),
    keyType: passkey.keyType,
    innerOnly: Boolean(opts?.innerOnly),
  });

  if (passkey.keyType === KEY_EOA && passkey.eoa) {
    const chainId = BigInt(passkey.chainId || "0");
    if (!chainId) throw new Error(t("wallet.superWalletNoSigningKey"));
    const inner = await signUserOpTypedData({
      wallet: passkey.address,
      userOpHash,
      chainId,
    });
    if (!passkey.advanced || opts?.innerOnly) return inner;
    if (!passkey.keyId) throw new Error(t("wallet.superWalletNoSigningKey"));
    return encodeAdvancedSignature([{ keyId: passkey.keyId, sig: inner }]);
  }

  const inner = await signUserOpHash(userOpHash, passkey.credentialId, {
    requireUv: passkey.keyType === KEY_YUBIKEY,
  });
  const matched =
    passkey.advanced
      ? await matchPasskeyToAssertion(inner, passkey, userOpHash, path)
      : passkey;
  if (!matched.advanced || opts?.innerOnly) return inner;
  if (!matched.keyId) throw new Error(t("wallet.superWalletNoSigningKey"));
  return encodeAdvancedSignature([{ keyId: matched.keyId, sig: inner }]);
}
