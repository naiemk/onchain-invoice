import { ZeroHash } from "ethers";
import { t } from "../i18n/t.js";
import { KEY_EOA, KEY_WEBAUTHN, KEY_YUBIKEY } from "../../../commerce/shared/advanced-wallet.js";
import type { WalletEntityKeyRecord } from "../../../commerce/shared/wallet.js";
import { signUserOpTypedData } from "./eoa-connector.js";
import {
  loadWalletSession,
  saveWalletSessionIfActive,
  listWalletRegistry,
  type WalletSession,
} from "./wallet-session.js";
import { signUserOpHash } from "./webauthn.js";
import {
  METHOD_EOA,
  METHOD_YUBIKEY,
  encodeIdentityBlob,
} from "../../../commerce/shared/identity-store.js";
import { identitySignerFromSession } from "./identity-sign.js";

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
  identityId: string;
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

/** @deprecated Entity Super Wallet is not supported. Kept so leftover UI compiles. */
export const SUPER_WALLET_NO_ENTITY = "super_wallet_no_entity";

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

function credentialIdForSession(session: WalletSession): string {
  const fromSession = session.credentialId?.trim() ?? "";
  if (fromSession) return fromSession;
  const addr = session.address.toLowerCase();
  return (
    listWalletRegistry().find((w) => w.address.toLowerCase() === addr && w.credentialId?.trim())?.credentialId?.trim() ??
    ""
  );
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
    qx: passkey.qx || base.qx,
    qy: passkey.qy || base.qy,
    credentialId: passkey.credentialId,
    identityId: passkey.identityId,
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

/** This browser's IdentityStore method. No P256-owner / entity-roster lookup. */
export async function resolveCurrentWalletPasskey(
  session: WalletSession,
  path: WalletPasskeyPath = "unknown",
  options?: { persist?: boolean }
): Promise<CurrentWalletPasskey> {
  const identityId = session.identityId;
  if (!identityId) {
    throw new Error(t("wallet.recoverNeedSession"));
  }
  const credentialId = credentialIdForSession(session);
  if (!credentialId) {
    logWalletPasskey({
      phase: "resolve",
      path,
      ok: false,
      rejectReason: "missing_credential",
      address: fp(session.address),
    });
    throw new Error(t("wallet.passkeyMissingOnDevice"));
  }
  const signer = await identitySignerFromSession({
    identityId,
    credentialId,
    qx: session.qx,
    qy: session.qy,
    keyType: session.keyType,
  });
  const passkey: CurrentWalletPasskey = {
    address: session.address,
    chainId: session.chainId,
    credentialId,
    qx: signer.qx,
    qy: signer.qy,
    advanced: false,
    identityId,
    keyType:
      signer.kind === METHOD_YUBIKEY
        ? KEY_YUBIKEY
        : signer.kind === METHOD_EOA
          ? KEY_EOA
          : KEY_WEBAUTHN,
  };
  logWalletPasskey({
    phase: "resolve",
    path,
    ok: true,
    identity: true,
    address: fp(session.address),
    credentialFp: credFp(credentialId),
    qxFp: fp(signer.qx),
    qyFp: fp(signer.qy),
    keyType: passkey.keyType,
  });
  if (options?.persist !== false) persistCurrentWalletPasskey(passkey, session);
  return passkey;
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
    identity: true,
    address: fp(passkey.address),
    credentialFp: credFp(passkey.credentialId),
    qxFp: fp(passkey.qx),
    keyType: passkey.keyType,
  });

  if (passkey.keyType === KEY_EOA && passkey.eoa) {
    const chainId = BigInt(passkey.chainId || "0");
    if (!chainId) throw new Error(t("wallet.superWalletNoSigningKey"));
    const inner = await signUserOpTypedData({
      wallet: passkey.address,
      userOpHash,
      chainId,
    });
    const signer = await identitySignerFromSession({
      identityId: passkey.identityId,
      credentialId: passkey.credentialId,
      qx: passkey.qx,
      qy: passkey.qy,
      keyType: KEY_EOA,
    });
    return encodeIdentityBlob({
      kind: METHOD_EOA,
      identityId: passkey.identityId,
      methodId: signer.methodId,
      inner,
    });
  }

  const inner = await signUserOpHash(userOpHash, passkey.credentialId, {
    requireUv: passkey.keyType === KEY_YUBIKEY,
  });
  const signer = await identitySignerFromSession({
    identityId: passkey.identityId,
    credentialId: passkey.credentialId,
    qx: passkey.qx,
    qy: passkey.qy,
    keyType: passkey.keyType,
  });
  return encodeIdentityBlob({
    kind: signer.kind,
    identityId: passkey.identityId,
    methodId: signer.methodId,
    inner,
  });
}
