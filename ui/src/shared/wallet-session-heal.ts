import { hashEntityEmail, computeKeyId, KEY_WEBAUTHN } from "../../../commerce/shared/advanced-wallet.js";
import { zeroPadValue } from "ethers";
import { fetchWalletBalance, fetchWalletConfig, getWalletAccount, listDevices } from "./wallet-api.js";
import { listWalletEntities, resolveAdvancedPolicy } from "./wallet-advanced-api.js";
import { credentialIdsMatch } from "./credential-id.js";
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

/** Merge server + roster data so signing works after a partial Super Wallet upgrade. */
export async function healWalletSession(session: WalletSession): Promise<HealWalletSessionResult> {
  let next = await ensureSessionCredential(session);

  try {
    const account = await getWalletAccount(next.address);
    if (account) {
      next = {
        ...next,
        salt: account.salt || next.salt,
        qx: account.ownerQx || next.qx,
        qy: account.ownerQy || next.qy,
        ...(account.credentialId && !next.credentialId?.trim()
          ? { credentialId: account.credentialId }
          : {}),
      };
    }
  } catch {
    /* offline */
  }

  try {
    const config = await fetchWalletConfig();
    const devices = await listDevices(next.address, config.chainId);
    const device = devices.find(
      (d) =>
        Boolean(d.credentialId) &&
        ((d.ownerQx === next.qx && d.ownerQy === next.qy) ||
          (d.credentialId === next.credentialId && Boolean(next.credentialId?.trim())) ||
          credentialIdsMatch(d.credentialId, next.credentialId))
    );
    if (device?.credentialId && device.credentialId !== next.credentialId) {
      next = { ...next, credentialId: device.credentialId };
    }
  } catch {
    /* ignore */
  }

  let needsSuperWalletEmail = false;
  try {
    const balance = await fetchWalletBalance(next.address).catch(() => null);
    const deployed = balance?.chains.some((c) => c.deployed) ?? false;
    const policy = await resolveAdvancedPolicy(next.address, deployed);

    if (policy.advanced) {
      const roster = await listWalletEntities(next.address).catch(() => ({ entities: [], keys: [] }));
      const mine =
        roster.keys.find((k) => k.credentialId && credentialIdsMatch(k.credentialId, next.credentialId)) ??
        roster.keys.find((k) => k.qx === next.qx && k.qy === next.qy);

      if (mine) {
        next = {
          ...next,
          entityId: mine.entityId,
          keyId: mine.keyId,
          keyType: mine.keyType,
          ...(mine.credentialId ? { credentialId: mine.credentialId } : {}),
        };
      } else if (!next.entityId) {
        needsSuperWalletEmail = true;
      }
    }
  } catch {
    /* ignore */
  }

  const changed =
    next.credentialId !== session.credentialId ||
    next.entityId !== session.entityId ||
    next.keyId !== session.keyId ||
    next.qx !== session.qx ||
    next.qy !== session.qy;

  if (changed) saveWalletSession(next);

  return { session: next, needsSuperWalletEmail };
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
