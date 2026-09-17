import { fetchWalletConfig, registerDevice } from "./wallet-api.js";
import {
  createPasskey,
  listWalletRegistry,
  loadWalletSession,
  saveWalletSession,
  clearPendingPasskey,
  type WalletSession,
} from "./webauthn.js";
import {
  createIdentityWallet,
  fetchIdentityMe,
  loginIdentityPasskey,
  registerIdentityPasskey,
} from "./identity-api.js";
import { inferDeviceLabel } from "./passkey-name.js";
import { t } from "../i18n/t.js";

export interface WalletCreateResult {
  address: string;
  salt: string;
  session: WalletSession;
}

function localPasskeyCredentialId(): string | undefined {
  const fromSession = loadWalletSession()?.credentialId?.trim();
  if (fromSession) return fromSession;
  return listWalletRegistry().find((w) => w.credentialId?.trim())?.credentialId?.trim();
}

function sessionFromAccount(
  label: string,
  chainId: string,
  identityId: string,
  account: { address: string; salt: string; ownerQx: string; ownerQy: string; credentialId: string | null }
): WalletSession {
  const current = loadWalletSession() ?? listWalletRegistry()[0];
  return {
    address: account.address,
    chainId,
    salt: account.salt,
    qx: current?.qx || account.ownerQx,
    qy: current?.qy || account.ownerQy,
    credentialId: current?.credentialId || account.credentialId || "",
    rawId: current?.rawId || account.credentialId || "",
    label,
    identityId,
  };
}

/** Extra identity wallet: same passkey, new CREATE2 salt. */
export async function createAnotherIdentityWallet(label: string): Promise<WalletCreateResult> {
  const config = await fetchWalletConfig();
  if (!config.factoryAddress || !config.implementationAddress) {
    throw new Error(t("wallet.noFactory"));
  }
  const credentialId = localPasskeyCredentialId();
  if (credentialId) {
    await loginIdentityPasskey(credentialId).catch(() => undefined);
  }
  const me = await fetchIdentityMe();
  if (!me && !credentialId) throw new Error(t("wallet.createNeedSignIn"));
  if (me && me.methods.webauthn < 1) throw new Error(t("wallet.createNeedPasskey"));
  const account = await createIdentityWallet(credentialId, label);
  const identityId = me?.identityId || account.identityId;
  if (!identityId) throw new Error(t("wallet.createNeedSignIn"));
  const session = sessionFromAccount(label, config.chainId, identityId, account);
  saveWalletSession(session);
  await registerDevice({
    walletAddress: account.address,
    chainId: config.chainId,
    ownerQx: session.qx,
    ownerQy: session.qy,
    label: inferDeviceLabel(),
    credentialId: session.credentialId,
  }).catch(() => undefined);
  return { address: account.address, salt: account.salt, session };
}

/** First identity wallet: session + passkey → IdentityWalletFactory salt. */
export async function createCounterfactualWallet(
  label: string,
  _opts?: { captchaToken?: string | null }
): Promise<WalletCreateResult> {
  const config = await fetchWalletConfig();
  if (!config.factoryAddress || !config.implementationAddress) {
    throw new Error(t("wallet.noFactory"));
  }
  const me = await fetchIdentityMe();
  if (!me) {
    throw new Error(t("wallet.recoverNeedSession"));
  }
  if (me.methods.webauthn >= 1) {
    return createAnotherIdentityWallet(label);
  }
  const owner = await createPasskey(label, { purpose: "enroll", email: me.email, identityId: me.identityId });
  const registered = await registerIdentityPasskey({
    qx: owner.qx,
    qy: owner.qy,
    credentialId: owner.credentialId,
    webauthnAttestation: owner.attestation,
  });
  const account = registered.wallets[0];
  if (!account) throw new Error(t("wallet.noFactory"));
  const session: WalletSession = {
    address: account.address,
    chainId: config.chainId,
    salt: account.salt,
    qx: owner.qx,
    qy: owner.qy,
    credentialId: owner.credentialId,
    rawId: owner.rawId,
    label,
    identityId: registered.identityId,
  };
  saveWalletSession(session);
  clearPendingPasskey(owner.credentialId);
  await registerDevice({
    walletAddress: account.address,
    chainId: config.chainId,
    ownerQx: owner.qx,
    ownerQy: owner.qy,
    label,
    credentialId: owner.credentialId,
  });
  return { address: account.address, salt: account.salt, session };
}
