import { getAddress, zeroPadValue } from "ethers";
import { t } from "../i18n/t.js";
import {
  computeKeyId,
  hashEntityEmail,
  KEY_EOA,
  KEY_WEBAUTHN,
  KEY_YUBIKEY,
} from "../../../commerce/shared/advanced-wallet.js";
import {
  fetchAdvancedPolicy,
  registerWalletEntity,
  registerWalletEntityKey,
  waitForAdvancedPolicy,
} from "./wallet-advanced-api.js";
import { resolveCurrentWalletPasskey } from "./current-wallet-passkey.js";
import { buildSignedAddKeyUserOp, buildSignedEnableAdvancedUserOp } from "./advanced-userop-client.js";
import { formatSendRejectReason } from "./userop-errors.js";
import { buildSignedAddOwnerUserOp, submitSignedUserOp } from "./userop-client.js";
import { fetchWalletConfig, registerDevice, waitForUserOp } from "./wallet-api.js";
import { loadWalletSession, saveWalletSession, type WalletSession } from "./wallet-session.js";
import { ensureSessionCredential } from "./webauthn.js";
import { connectEoaWallet } from "./eoa-connector.js";
import { fetchWalletEmail } from "./wallet-recovery-api.js";

export async function addPasskeySigner(input: {
  session: WalletSession;
  advanced: boolean;
  qx: string;
  qy: string;
  credentialId: string | null;
  label: string;
  keyType: typeof KEY_WEBAUTHN | typeof KEY_YUBIKEY;
}): Promise<void> {
  const live = await ensureSessionCredential(loadWalletSession() ?? input.session);
  const cfg = await fetchWalletConfig();
  const fee = BigInt(cfg.bundlerFeeUsdc || "0");
  const policy = await fetchAdvancedPolicy(live.address).catch(() => null);
  const advanced = policy?.advanced === true || input.advanced;
  const passkey = await resolveCurrentWalletPasskey(live, "pairing-confirm");
  if (advanced) {
    if ((policy?.threshold ?? 1) > 1) throw new Error(t("wallet.superWalletPairNeedsOneSigner"));
    const entityId = passkey.entityId;
    if (!entityId) throw new Error(t("wallet.superWalletNoSigningKey"));
    const eoa = zeroPadValue("0x00", 20);
    const { userOp, userOpHash } = await buildSignedAddKeyUserOp({
      config: cfg,
      passkey,
      targetEntityId: entityId,
      keyType: input.keyType,
      qx: input.qx,
      qy: input.qy,
      eoa,
      feeAmount: fee,
    });
    await submitSignedUserOp({ config: cfg, userOp, userOpHash, walletAddress: passkey.address });
    const result = await waitForUserOp(userOpHash);
    if (result.status !== "included") {
      throw new Error(formatSendRejectReason(result.rejectReason, (key, vars) => t(key as Parameters<typeof t>[0], vars)));
    }
    await registerWalletEntityKey({
      walletAddress: passkey.address,
      entityId,
      keyId: computeKeyId(entityId, input.keyType, input.qx, input.qy, eoa),
      keyType: input.keyType,
      qx: input.qx,
      qy: input.qy,
      eoa: null,
      credentialId: input.credentialId,
    });
  } else {
    const { userOp, userOpHash } = await buildSignedAddOwnerUserOp({
      config: cfg,
      passkey,
      qx: input.qx,
      qy: input.qy,
      feeAmount: fee,
    });
    await submitSignedUserOp({ config: cfg, userOp, userOpHash, walletAddress: passkey.address });
    const result = await waitForUserOp(userOpHash);
    if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
  }
  await registerDevice({
    walletAddress: live.address,
    chainId: live.chainId,
    ownerQx: input.qx,
    ownerQy: input.qy,
    label: input.label,
    credentialId: input.credentialId,
  });
}

export async function addConnectedEoaSigner(session: WalletSession): Promise<void> {
  const live = loadWalletSession() ?? session;
  const cfg = await fetchWalletConfig();
  const fee = BigInt(cfg.bundlerFeeUsdc || "0");
  const eoa = getAddress(await connectEoaWallet());
  const policy = await fetchAdvancedPolicy(live.address).catch(() => null);
  let passkey = await resolveCurrentWalletPasskey(live, "add-key");

  if (!policy?.advanced) {
    const emailRec = await fetchWalletEmail(live.address);
    if (!emailRec.verified || !emailRec.email) {
      throw new Error(t("wallet.connectWalletNeedsEmail"));
    }
    const adminEntityId = hashEntityEmail(emailRec.email);
    const { userOp, userOpHash } = await buildSignedEnableAdvancedUserOp({
      config: cfg,
      passkey,
      adminEntityId,
      feeAmount: fee,
    });
    await submitSignedUserOp({ config: cfg, userOp, userOpHash, walletAddress: passkey.address });
    const result = await waitForUserOp(userOpHash);
    if (result.status !== "included") {
      throw new Error(formatSendRejectReason(result.rejectReason, (key, vars) => t(key as Parameters<typeof t>[0], vars)));
    }
    await waitForAdvancedPolicy(live.address);
    await registerWalletEntity({ walletAddress: live.address, entityId: adminEntityId, label: emailRec.email });
    const webAuthnEoa = zeroPadValue("0x00", 20);
    await registerWalletEntityKey({
      walletAddress: live.address,
      entityId: adminEntityId,
      keyId: computeKeyId(adminEntityId, KEY_WEBAUTHN, passkey.qx, passkey.qy, webAuthnEoa),
      keyType: KEY_WEBAUTHN,
      qx: passkey.qx,
      qy: passkey.qy,
      eoa: null,
      credentialId: passkey.credentialId,
    });
    saveWalletSession({
      ...live,
      qx: passkey.qx,
      qy: passkey.qy,
      credentialId: passkey.credentialId,
      entityId: adminEntityId,
      keyId: computeKeyId(adminEntityId, KEY_WEBAUTHN, passkey.qx, passkey.qy, webAuthnEoa),
      keyType: KEY_WEBAUTHN,
      label: live.label || emailRec.email,
    });
    passkey = await resolveCurrentWalletPasskey(loadWalletSession() ?? live, "add-key");
  }

  const entityId = passkey.entityId;
  if (!entityId) throw new Error(t("wallet.superWalletNoSigningKey"));
  const zeroQx = zeroPadValue("0x00", 32);
  const { userOp, userOpHash } = await buildSignedAddKeyUserOp({
    config: cfg,
    passkey,
    targetEntityId: entityId,
    keyType: KEY_EOA,
    qx: zeroQx,
    qy: zeroQx,
    eoa,
    feeAmount: fee,
  });
  await submitSignedUserOp({ config: cfg, userOp, userOpHash, walletAddress: passkey.address });
  const addResult = await waitForUserOp(userOpHash);
  if (addResult.status !== "included") {
    throw new Error(formatSendRejectReason(addResult.rejectReason, (key, vars) => t(key as Parameters<typeof t>[0], vars)));
  }
  await registerWalletEntityKey({
    walletAddress: passkey.address,
    entityId,
    keyId: computeKeyId(entityId, KEY_EOA, zeroQx, zeroQx, eoa),
    keyType: KEY_EOA,
    qx: zeroQx,
    qy: zeroQx,
    eoa,
    credentialId: null,
  });
}

