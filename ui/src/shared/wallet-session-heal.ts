import { hashEntityEmail, computeKeyId, KEY_WEBAUTHN } from "../../../commerce/shared/advanced-wallet.js";
import { zeroPadValue } from "ethers";
import { getWalletAccount } from "./wallet-api.js";
import { resolveWalletLabel } from "./wallet-label.js";
import { resolveCurrentWalletPasskey } from "./current-wallet-passkey.js";
import { ensureSessionCredential } from "./webauthn.js";
import {
  isActiveWalletAddress,
  listWalletRegistry,
  saveWalletSession,
  saveWalletSessionIfActive,
  type WalletSession,
} from "./wallet-session.js";

export type HealWalletSessionResult = {
  session: WalletSession;
  needsSuperWalletEmail?: boolean;
};

/** Refresh label/salt and bind this passkey to the identity method. */
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
        label: resolveWalletLabel({ saved: next.label, server: account.label }),
        identityId: account.identityId || next.identityId,
      };
    }
  } catch {
    /* offline */
  }

  if (!next.identityId) {
    return { session: next };
  }

  try {
    const persist = options?.persist !== false && isActiveWalletAddress(next.address);
    const passkey = await resolveCurrentWalletPasskey(next, "heal", { persist });
    next = {
      ...next,
      qx: passkey.qx,
      qy: passkey.qy,
      credentialId: passkey.credentialId,
      identityId: passkey.identityId,
    };
  } catch {
    /* keep session coords */
  }

  const changed =
    next.credentialId !== session.credentialId ||
    next.qx !== session.qx ||
    next.qy !== session.qy ||
    next.label !== session.label ||
    next.identityId !== session.identityId;

  if (changed && options?.persist !== false) saveWalletSessionIfActive(next);

  return { session: next };
}

/** Leftover entity Super Wallet helper. Identity wallets do not use this. */
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
