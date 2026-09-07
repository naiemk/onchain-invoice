import { zeroPadValue } from "ethers";
import { t } from "../i18n/t.js";
import { computeKeyId, KEY_WEBAUTHN, KEY_YUBIKEY } from "../../../commerce/shared/advanced-wallet.js";
import { fetchAdvancedPolicy, registerWalletEntityKey } from "./wallet-advanced-api.js";
import { asAdvancedKeyType, resolveSessionSigningKey } from "./advanced-signing-key.js";
import { buildSignedAddKeyUserOp } from "./advanced-userop-client.js";
import { formatSendRejectReason } from "./userop-errors.js";
import { buildSignedAddOwnerUserOp, submitSignedUserOp } from "./userop-client.js";
import { fetchWalletConfig, registerDevice, waitForUserOp } from "./wallet-api.js";
import type { WalletSession } from "./wallet-session.js";

export async function addPasskeySigner(input: {
  session: WalletSession;
  advanced: boolean;
  qx: string;
  qy: string;
  credentialId: string | null;
  label: string;
  keyType: typeof KEY_WEBAUTHN | typeof KEY_YUBIKEY;
}): Promise<void> {
  const cfg = await fetchWalletConfig();
  const fee = BigInt(cfg.bundlerFeeUsdc || "0");
  if (input.advanced) {
    const resolved = await resolveSessionSigningKey(input.session, { connectEoa: false });
    if (!resolved) throw new Error(t("wallet.superWalletNoSigningKey"));
    const policy = await fetchAdvancedPolicy(resolved.session.address).catch(() => null);
    if ((policy?.threshold ?? 1) > 1) throw new Error(t("wallet.superWalletPairNeedsOneSigner"));
    const entityId = resolved.key.entityId;
    const eoa = zeroPadValue("0x00", 20);
    const { userOp, userOpHash } = await buildSignedAddKeyUserOp({
      config: cfg,
      walletAddress: resolved.session.address,
      adminEntityId: entityId,
      adminKeyType: asAdvancedKeyType(resolved.key.keyType),
      adminQx: resolved.key.qx || resolved.session.qx,
      adminQy: resolved.key.qy || resolved.session.qy,
      adminEoa: resolved.key.eoa ?? undefined,
      adminCredentialId: resolved.key.credentialId ?? resolved.session.credentialId,
      targetEntityId: entityId,
      keyType: input.keyType,
      qx: input.qx,
      qy: input.qy,
      eoa,
      feeAmount: fee,
    });
    await submitSignedUserOp({ config: cfg, userOp, userOpHash, walletAddress: resolved.session.address });
    const result = await waitForUserOp(userOpHash);
    if (result.status !== "included") {
      throw new Error(formatSendRejectReason(result.rejectReason, (key, vars) => t(key as Parameters<typeof t>[0], vars)));
    }
    await registerWalletEntityKey({
      walletAddress: resolved.session.address,
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
      walletAddress: input.session.address,
      qx: input.qx,
      qy: input.qy,
      feeAmount: fee,
      credentialId: input.session.credentialId,
    });
    await submitSignedUserOp({ config: cfg, userOp, userOpHash, walletAddress: input.session.address });
    const result = await waitForUserOp(userOpHash);
    if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
  }
  await registerDevice({
    walletAddress: input.session.address,
    chainId: input.session.chainId,
    ownerQx: input.qx,
    ownerQy: input.qy,
    label: input.label,
    credentialId: input.credentialId,
  });
}
