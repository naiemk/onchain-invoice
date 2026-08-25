import { fetchWalletAccountByCredentialId, fetchWalletConfig, listDevices } from "./wallet-api.js";
import {
  authenticatePasskey,
  listWalletRegistry,
  saveWalletSession,
  setActiveWallet,
  type WalletSession,
} from "./webauthn.js";
import { t } from "../i18n/t.js";

/**
 * Unlock an existing wallet on this device via discoverable passkey,
 * then restore session from API (credentialId → account).
 */
export async function unlockWalletWithPasskey(): Promise<WalletSession> {
  const auth = await authenticatePasskey();
  if (!auth) throw new Error(t("wallet.signInFailed"));

  if (auth.fromRegistry && auth.qx && auth.qy) {
    const match = listWalletRegistry().find((w) => w.credentialId === auth.credentialId);
    if (match) {
      setActiveWallet(match.address);
      return match;
    }
  }

  const found = await fetchWalletAccountByCredentialId(auth.credentialId);
  if (!found) throw new Error(t("wallet.unlockNotFound"));

  const { account, device } = found;
  const config = await fetchWalletConfig();
  const qx = device?.ownerQx || account.ownerQx;
  const qy = device?.ownerQy || account.ownerQy;
  let label = device?.label || t("wallet.defaultDevice");
  try {
    const devices = await listDevices(account.address, config.chainId);
    const match = devices.find((d) => d.credentialId === auth.credentialId);
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
  saveWalletSession(session);
  return session;
}
