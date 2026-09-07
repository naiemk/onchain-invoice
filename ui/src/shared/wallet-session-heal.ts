import { hashEntityEmail, computeKeyId, KEY_WEBAUTHN } from "../../../commerce/shared/advanced-wallet.js";
import { zeroPadValue } from "ethers";
import { getWalletAccount } from "./wallet-api.js";
import { fetchAdvancedPolicy } from "./wallet-advanced-api.js";
import { resolveCurrentWalletPasskey } from "./current-wallet-passkey.js";
import { ensureSessionCredential } from "./webauthn.js";
import {
  listWalletRegistry,
  saveWalletSession,
  type WalletSession,
} from "./wallet-session.js";

export type HealWalletSessionResult = {
  session: WalletSession;
  /** On-chain Super Wallet is active but this browser lacks entity signing metadata. */
  needsSuperWalletEmail?: boolean;
};

/** Refresh salt/label; identity (qx/credentialId) only via CurrentWalletPasskey. */
export async function healWalletSession(
  session: WalletSession,
  options?: { persist?: boolean }
): Promise<HealWalletSessionResult> {
  let next = await ensureSessionCredential(session);

  try {
    const account = await getWalletAccount(next.address);
    if (account) {
      next = {
        ...next,
        salt: account.salt || next.salt,
      };
    }
  } catch {
    /* offline */
  }

  let needsSuperWalletEmail = false;
  try {
    const passkey = await resolveCurrentWalletPasskey(next, "heal", { persist: options?.persist !== false });
    next = {
      ...next,
      qx: passkey.qx,
      qy: passkey.qy,
      credentialId: passkey.credentialId,
      entityId: passkey.entityId ?? next.entityId,
      keyId: passkey.keyId ?? next.keyId,
      keyType: passkey.keyType ?? next.keyType,
      eoa: passkey.eoa ?? next.eoa,
    };
  } catch {
    const policy = await fetchAdvancedPolicy(next.address).catch(() => null);
    needsSuperWalletEmail = Boolean(policy?.advanced && !next.entityId);
  }

  const changed =
    next.credentialId !== session.credentialId ||
    next.entityId !== session.entityId ||
    next.keyId !== session.keyId ||
    next.qx !== session.qx ||
    next.qy !== session.qy;

  if (changed && options?.persist !== false) saveWalletSession(next);

  return { session: next, needsSuperWalletEmail: Boolean(needsSuperWalletEmail && !next.entityId) };
}

/** Restore Super Wallet signing after upgrade when API roster is missing entityId. */
export function healSuperWalletFromEmail(session: WalletSession, email: string): WalletSession {
  const adminEntityId = hashEntityEmail(email.trim());
  const keyId = computeKeyId(adminEntityId, KEY_WEBAUTHN, session.qx, session.qy, zeroPadValue("0x00", 20));
  const next: WalletSession = {
    ...session,
    entityId: adminEntityId,
    keyId,
    keyType: KEY_WEBAUTHN,
  };
  saveWalletSession(next);
  return next;
}

export function findRegistryEntry(address: string): WalletSession | undefined {
  return listWalletRegistry().find((w) => w.address.toLowerCase() === address.toLowerCase());
}
