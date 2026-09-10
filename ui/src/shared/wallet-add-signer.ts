import { getAddress, zeroPadValue, ZeroAddress } from "ethers";
import { t } from "../i18n/t.js";
import { computeKeyId, KEY_EOA, KEY_WEBAUTHN, KEY_YUBIKEY } from "../../../commerce/shared/advanced-wallet.js";
import { eoaCredentialId, eoaOwnerCoords } from "../../../commerce/shared/wallet-eip712.js";
import { fetchAdvancedPolicy, registerWalletEntityKey } from "./wallet-advanced-api.js";
import { resolveCurrentWalletPasskey, type CurrentWalletPasskey } from "./current-wallet-passkey.js";
import { buildSignedAddKeyEoaUserOp, buildSignedAddKeyUserOp } from "./advanced-userop-client.js";
import { formatSendRejectReason } from "./userop-errors.js";
import { buildSignedAddOwnerEoaUserOp, buildSignedAddOwnerUserOp, submitSignedUserOp } from "./userop-client.js";
import { fetchWalletConfig, getWalletAccount, registerDevice, waitForUserOp } from "./wallet-api.js";
import { inferDeviceLabel } from "./passkey-name.js";
import { loadWalletSession, saveWalletSession, shortAddress, type WalletSession } from "./wallet-session.js";
import { createPasskey, ensureSessionCredential } from "./webauthn.js";
import { connectEoaWallet, signAddKeyTypedData, signAddOwnerTypedData } from "./eoa-connector.js";

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
  const passkey = await resolveCurrentWalletPasskey(live, "add-key");
  const chainId = BigInt(live.chainId);
  const coords = eoaOwnerCoords(eoa);
  const label = shortAddress(eoa);
  const credentialId = eoaCredentialId(eoa);

  if (!policy?.advanced) {
    const bindSignature = await signAddOwnerTypedData({
      wallet: live.address,
      owner: eoa,
      chainId,
    });
    const { userOp, userOpHash } = await buildSignedAddOwnerEoaUserOp({
      config: cfg,
      passkey,
      owner: eoa,
      bindSignature,
      feeAmount: fee,
    });
    await submitSignedUserOp({ config: cfg, userOp, userOpHash, walletAddress: passkey.address });
    const result = await waitForUserOp(userOpHash);
    if (result.status !== "included") {
      throw new Error(formatSendRejectReason(result.rejectReason, (key, vars) => t(key as Parameters<typeof t>[0], vars)));
    }
    await registerDevice({
      walletAddress: live.address,
      chainId: live.chainId,
      ownerQx: coords.qx,
      ownerQy: coords.qy,
      label,
      credentialId,
    });
    return;
  }

  if ((policy.threshold ?? 1) > 1) throw new Error(t("wallet.superWalletPairNeedsOneSigner"));
  const entityId = passkey.entityId;
  if (!entityId) throw new Error(t("wallet.superWalletNoSigningKey"));
  const zeroQx = zeroPadValue("0x00", 32);
  const bindSignature = await signAddKeyTypedData({
    wallet: live.address,
    entityId,
    owner: eoa,
    chainId,
  });
  const { userOp, userOpHash } = await buildSignedAddKeyEoaUserOp({
    config: cfg,
    passkey,
    targetEntityId: entityId,
    eoa,
    bindSignature,
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
    credentialId,
  });
  await registerDevice({
    walletAddress: live.address,
    chainId: live.chainId,
    ownerQx: coords.qx,
    ownerQy: coords.qy,
    label,
    credentialId,
  });
}

/** Existing EOA owner self-enrolls a new passkey (simple addOwner / Super Wallet addKey). */
export async function enrollPasskeyWithExistingEoa(input: {
  walletAddress: string;
  chainId: string;
  eoa: string;
  advanced: boolean;
  entityId?: string | null;
  keyId?: string | null;
}): Promise<void> {
  const cfg = await fetchWalletConfig();
  const fee = BigInt(cfg.bundlerFeeUsdc || "0");
  const eoa = getAddress(input.eoa);
  const walletAddress = getAddress(input.walletAddress);
  const chainId = input.chainId || cfg.chainId;
  const policy = await fetchAdvancedPolicy(walletAddress).catch(() => null);
  const advanced = policy?.advanced === true || input.advanced;
  if (advanced && (policy?.threshold ?? 1) > 1) {
    throw new Error(t("wallet.superWalletPairNeedsOneSigner"));
  }
  const label = inferDeviceLabel();
  const passkey = await createPasskey(label, { walletLabel: shortAddress(walletAddress), deviceLabel: label });
  const signer: CurrentWalletPasskey = {
    address: walletAddress,
    chainId,
    credentialId: eoaCredentialId(eoa),
    qx: zeroPadValue("0x00", 32),
    qy: zeroPadValue("0x00", 32),
    advanced,
    entityId: input.entityId ?? undefined,
    keyId: input.keyId ?? undefined,
    keyType: KEY_EOA,
    eoa,
  };
  const zeroEoa = ZeroAddress;
  if (advanced) {
    const entityId = input.entityId;
    if (!entityId) throw new Error(t("wallet.superWalletNoSigningKey"));
    const { userOp, userOpHash } = await buildSignedAddKeyUserOp({
      config: cfg,
      passkey: signer,
      targetEntityId: entityId,
      keyType: KEY_WEBAUTHN,
      qx: passkey.qx,
      qy: passkey.qy,
      eoa: zeroEoa,
      feeAmount: fee,
    });
    await submitSignedUserOp({ config: cfg, userOp, userOpHash, walletAddress });
    const result = await waitForUserOp(userOpHash);
    if (result.status !== "included") {
      throw new Error(formatSendRejectReason(result.rejectReason, (key, vars) => t(key as Parameters<typeof t>[0], vars)));
    }
    await registerWalletEntityKey({
      walletAddress,
      entityId,
      keyId: computeKeyId(entityId, KEY_WEBAUTHN, passkey.qx, passkey.qy, zeroEoa),
      keyType: KEY_WEBAUTHN,
      qx: passkey.qx,
      qy: passkey.qy,
      eoa: null,
      credentialId: passkey.credentialId,
    });
  } else {
    const { userOp, userOpHash } = await buildSignedAddOwnerUserOp({
      config: cfg,
      passkey: signer,
      qx: passkey.qx,
      qy: passkey.qy,
      feeAmount: fee,
    });
    await submitSignedUserOp({ config: cfg, userOp, userOpHash, walletAddress });
    const result = await waitForUserOp(userOpHash);
    if (result.status !== "included") {
      throw new Error(formatSendRejectReason(result.rejectReason, (key, vars) => t(key as Parameters<typeof t>[0], vars)));
    }
  }
  await registerDevice({
    walletAddress,
    chainId,
    ownerQx: passkey.qx,
    ownerQy: passkey.qy,
    label,
    credentialId: passkey.credentialId,
  });
  const account = await getWalletAccount(walletAddress);
  saveWalletSession({
    address: walletAddress,
    chainId,
    salt: account?.salt ?? "",
    qx: passkey.qx,
    qy: passkey.qy,
    credentialId: passkey.credentialId,
    rawId: passkey.rawId,
    label,
    role: "owner",
    entityId: advanced ? input.entityId ?? undefined : undefined,
    keyType: KEY_WEBAUTHN,
  });
}
