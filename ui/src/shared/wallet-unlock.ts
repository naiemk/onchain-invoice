import { fetchWalletConfig, getWalletAccount } from "./wallet-api.js";
import { authenticatePasskey, ensureSessionCredential, type WalletSession } from "./webauthn.js";
import { saveWalletSession } from "./wallet-session.js";
import { fetchIdentityWallets, joinIdentitySuperWallet, loginIdentityPasskey } from "./identity-api.js";
import { resolveWalletLabel } from "./wallet-label.js";
import { t } from "../i18n/t.js";

async function sessionFromIdentityLogin(input: {
  credentialId: string;
  rawId: string;
  qx?: string;
  qy?: string;
  preferred?: WalletSession;
}): Promise<WalletSession> {
  const login = await loginIdentityPasskey(input.credentialId, {
    qx: input.qx,
    qy: input.qy,
  });
  const wallets = login.wallets.length ? login.wallets : await fetchIdentityWallets().catch(() => []);
  if (!wallets.length) {
    throw Object.assign(new Error(t("wallet.unlockNotFound")), { code: "local_recovery" });
  }
  const preferredAddr = input.preferred?.address.toLowerCase();
  const account =
    (preferredAddr ? wallets.find((w) => w.address.toLowerCase() === preferredAddr) : undefined) ?? wallets[0]!;
  if (preferredAddr && account.address.toLowerCase() !== preferredAddr) {
    throw Object.assign(new Error(t("wallet.unlockWrongWallet")), { code: "wrong_wallet" });
  }
  const config = await fetchWalletConfig();
  for (const [index, w] of wallets.entries()) {
    if (w.identityId && w.identityId.toLowerCase() !== login.identityId.toLowerCase()) {
      await joinIdentitySuperWallet(w.address).catch(() => undefined);
    }
    const existingLabel = input.preferred?.address.toLowerCase() === w.address.toLowerCase() ? input.preferred?.label : undefined;
    const server = await getWalletAccount(w.address).catch(() => w);
    saveWalletSession({
      address: w.address,
      chainId: config.chainId,
      salt: w.salt,
      qx: input.qx || w.ownerQx,
      qy: input.qy || w.ownerQy,
      credentialId: input.credentialId,
      rawId: input.rawId || input.credentialId,
      label: resolveWalletLabel({
        saved: existingLabel,
        server: server?.label ?? w.label,
        fallback: t("wallet.defaultWalletName"),
        index,
      }),
      identityId: login.identityId,
    });
  }
  const server = await getWalletAccount(account.address).catch(() => account);
  return {
    address: account.address,
    chainId: config.chainId,
    salt: account.salt,
    qx: input.qx || account.ownerQx,
    qy: input.qy || account.ownerQy,
    credentialId: input.credentialId,
    rawId: input.rawId || input.credentialId,
    label: resolveWalletLabel({
      saved: input.preferred?.label,
      server: server?.label ?? account.label,
      fallback: t("wallet.defaultWalletName"),
    }),
    identityId: login.identityId,
  };
}

/**
 * Unlock via discoverable passkey → identity method → identity wallets.
 */
export async function unlockWalletWithPasskey(): Promise<WalletSession> {
  const auth = await authenticatePasskey();
  if (!auth) throw new Error(t("wallet.passkeyCancelled"));
  const session = await sessionFromIdentityLogin({
    credentialId: auth.credentialId,
    rawId: auth.rawId,
    qx: auth.qx,
    qy: auth.qy,
  });
  saveWalletSession(session);
  return session;
}

/** Open a saved identity wallet after verifying this device's passkey. */
export async function unlockRegistryWallet(entry: WalletSession): Promise<WalletSession> {
  const prepared = await ensureSessionCredential(entry);
  if (!prepared.credentialId?.trim()) {
    throw Object.assign(new Error(t("wallet.passkeyMissingOnDevice")), { code: "missing_credential_id" });
  }
  const auth = await authenticatePasskey({ credentialId: prepared.credentialId });
  if (!auth) throw new Error(t("wallet.passkeyCancelled"));
  const session = await sessionFromIdentityLogin({
    credentialId: auth.credentialId,
    rawId: auth.rawId || prepared.rawId,
    qx: auth.qx || prepared.qx,
    qy: auth.qy || prepared.qy,
    preferred: prepared,
  });
  saveWalletSession(session);
  return session;
}
