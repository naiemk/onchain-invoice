import { deriveWalletSalt, predictWalletAddress } from "../../../commerce/shared/wallet-address.js";
import {
  fetchWalletConfig,
  registerDevice,
  registerWalletAccount,
} from "./wallet-api.js";
import {
  createPasskey,
  saveWalletSession,
  type WalletSession,
} from "./webauthn.js";
import { t } from "../i18n/t.js";

export interface WalletCreateResult {
  address: string;
  salt: string;
  session: WalletSession;
}

/** Counterfactual wallet create: passkey → predict address → register in API (no on-chain deploy). */
export async function createCounterfactualWallet(
  label: string,
  opts?: { captchaToken?: string | null }
): Promise<WalletCreateResult> {
  const config = await fetchWalletConfig();
  if (!config.factoryAddress || !config.implementationAddress) {
    throw new Error(t("wallet.noFactory"));
  }
  if (config.turnstileSiteKey && !opts?.captchaToken) {
    throw new Error(t("wallet.createCaptchaRequired"));
  }
  const owner = await createPasskey(label);
  const salt = deriveWalletSalt(owner.qx, owner.qy);
  const address = predictWalletAddress(config.factoryAddress, config.implementationAddress, salt);

  await registerWalletAccount({
    address,
    salt,
    ownerQx: owner.qx,
    ownerQy: owner.qy,
    credentialId: owner.credentialId,
    webauthnAttestation: owner.attestation,
    captchaToken: opts?.captchaToken ?? null,
  });

  const session: WalletSession = {
    address,
    chainId: config.chainId,
    salt,
    qx: owner.qx,
    qy: owner.qy,
    credentialId: owner.credentialId,
    rawId: owner.rawId,
    label,
  };
  saveWalletSession(session);

  await registerDevice({
    walletAddress: address,
    chainId: config.chainId,
    ownerQx: owner.qx,
    ownerQy: owner.qy,
    label,
    credentialId: owner.credentialId,
  });

  return { address, salt, session };
}
