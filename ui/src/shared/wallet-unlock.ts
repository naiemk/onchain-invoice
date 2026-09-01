import {
  fetchWalletAccountByCredentialId,
  fetchWalletConfig,
  getWalletAccount,
  listDevices,
  registerDevice,
  registerWalletAccount,
} from "./wallet-api.js";
import { credentialIdsMatch } from "./credential-id.js";
import {
  authenticatePasskey,
  listWalletRegistry,
  saveWalletSession,
  type WalletSession,
} from "./webauthn.js";
import { healWalletSession, findRegistryEntry } from "./wallet-session-heal.js";
import { t } from "../i18n/t.js";

function findRegistryByCredential(credentialId: string): WalletSession | undefined {
  return listWalletRegistry().find((w) => credentialIdsMatch(w.credentialId, credentialId));
}

async function rebindDeviceCredential(input: {
  session: WalletSession;
  credentialId: string;
  chainId: string;
}): Promise<void> {
  await registerDevice({
    walletAddress: input.session.address,
    chainId: input.chainId,
    ownerQx: input.session.qx,
    ownerQy: input.session.qy,
    label: input.session.label,
    credentialId: input.credentialId,
  });
  const account = await getWalletAccount(input.session.address);
  if (
    account &&
    account.ownerQx === input.session.qx &&
    account.ownerQy === input.session.qy
  ) {
    await registerWalletAccount({
      address: input.session.address,
      salt: account.salt,
      ownerQx: account.ownerQx,
      ownerQy: account.ownerQy,
      credentialId: input.credentialId,
    });
  }
}

async function isCredentialAuthorizedForWallet(
  walletAddress: string,
  chainId: string,
  credentialId: string,
  ownerQx: string,
  ownerQy: string
): Promise<boolean> {
  const account = await getWalletAccount(walletAddress);
  if (!account) return false;
  if (credentialIdsMatch(account.credentialId, credentialId)) return true;
  if (account.ownerQx === ownerQx && account.ownerQy === ownerQy) {
    if (!account.credentialId?.trim()) return true;
  }
  try {
    const devices = await listDevices(walletAddress, chainId);
    if (devices.some((d) => credentialIdsMatch(d.credentialId, credentialId))) return true;
  } catch {
    /* ignore */
  }
  return false;
}

async function finalizeSession(session: WalletSession): Promise<WalletSession> {
  saveWalletSession(session);
  const healed = await healWalletSession(session);
  return healed.session;
}

async function sessionFromAuth(
  auth: NonNullable<Awaited<ReturnType<typeof authenticatePasskey>>>,
  preferred?: WalletSession
): Promise<WalletSession> {
  const registryMatch = findRegistryByCredential(auth.credentialId);

  if (preferred) {
    const entry = findRegistryEntry(preferred.address) ?? preferred;
    const config = await fetchWalletConfig();
    const account = await getWalletAccount(entry.address);

    if (!account) {
      throw new Error(t("wallet.unlockNotFound"));
    }

    const ownerMatch =
      account.ownerQx === entry.qx &&
      account.ownerQy === entry.qy;

    const credKnown =
      credentialIdsMatch(auth.credentialId, account.credentialId) ||
      credentialIdsMatch(auth.credentialId, entry.credentialId) ||
      (await isCredentialAuthorizedForWallet(
        entry.address,
        config.chainId,
        auth.credentialId,
        entry.qx,
        entry.qy
      ));

    if (!credKnown && !ownerMatch) {
      throw new Error(t("wallet.unlockWrongWallet"));
    }

    const session: WalletSession = {
      ...entry,
      address: account.address,
      chainId: config.chainId,
      salt: account.salt,
      qx: account.ownerQx,
      qy: account.ownerQy,
      credentialId: auth.credentialId,
      rawId: auth.rawId || entry.rawId,
      label: entry.label || t("wallet.defaultDevice"),
    };

    if (
      !credentialIdsMatch(auth.credentialId, account.credentialId) ||
      !credentialIdsMatch(auth.credentialId, entry.credentialId)
    ) {
      await rebindDeviceCredential({
        session,
        credentialId: auth.credentialId,
        chainId: config.chainId,
      });
    }

    return finalizeSession(session);
  }

  if (registryMatch) {
    const merged: WalletSession = {
      ...registryMatch,
      credentialId: auth.credentialId,
      rawId: auth.rawId || registryMatch.rawId,
      qx: auth.qx || registryMatch.qx,
      qy: auth.qy || registryMatch.qy,
    };
    return finalizeSession(merged);
  }

  const found = await fetchWalletAccountByCredentialId(auth.credentialId);
  if (!found) {
    throw new Error(t("wallet.unlockNotFound"));
  }

  const { account, device } = found;
  const config = await fetchWalletConfig();
  const qx = device?.ownerQx || account.ownerQx;
  const qy = device?.ownerQy || account.ownerQy;
  let label = device?.label || t("wallet.defaultDevice");
  try {
    const devices = await listDevices(account.address, config.chainId);
    const match = devices.find((d) => credentialIdsMatch(d.credentialId, auth.credentialId));
    if (match?.label) label = match.label;
  } catch {
    /* ignore */
  }

  const session: WalletSession = {
    address: account.address,
    chainId: config.chainId,
    salt: account.salt,
    qx,
    qy,
    credentialId: auth.credentialId,
    rawId: auth.rawId,
    label,
  };
  return finalizeSession(session);
}

/**
 * Unlock an existing wallet on this device via discoverable passkey,
 * then restore session from API (credentialId → account).
 */
export async function unlockWalletWithPasskey(): Promise<WalletSession> {
  const auth = await authenticatePasskey();
  if (!auth) throw new Error(t("wallet.signInFailed"));
  return sessionFromAuth(auth);
}

/** Open a saved wallet after verifying the passkey on this device. */
export async function unlockRegistryWallet(entry: WalletSession): Promise<WalletSession> {
  const auth = await authenticatePasskey();
  if (!auth) throw new Error(t("wallet.signInFailed"));
  return sessionFromAuth(auth, entry);
}
