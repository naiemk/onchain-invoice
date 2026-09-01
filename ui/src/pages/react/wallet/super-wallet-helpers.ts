import { getAddress, zeroPadValue } from "ethers";
import {
  computeKeyId,
  KEY_EOA,
  KEY_WEBAUTHN,
  KEY_YUBIKEY,
} from "../../../../../commerce/shared/advanced-wallet.js";
import type {
  WalletEntityKeyRecord,
  WalletEntityRecord,
  WalletKeyEnrollmentRequestRecord,
} from "../../../../../commerce/shared/wallet.js";
import type { WalletPublicConfig } from "../../../../../commerce/shared/wallet.js";
import { buildSignedAddKeyUserOp } from "@/shared/advanced-userop-client.js";
import { submitSignedUserOp } from "@/shared/userop-client.js";
import { waitForUserOp } from "@/shared/wallet-api.js";
import { registerWalletEntityKey } from "@/shared/wallet-advanced-api.js";
import type { WalletSession } from "@/shared/wallet-session.js";

export function keyTypeLabel(keyType: number, t: (k: string) => string): string {
  if (keyType === KEY_YUBIKEY) return t("wallet.superWalletKeyYubiKey");
  if (keyType === KEY_EOA) return t("wallet.superWalletKeyEoa");
  return t("wallet.superWalletKeyPasskey");
}

export function shortKeyDisplay(k: Pick<WalletEntityKeyRecord, "eoa" | "qx">): string {
  if (k.eoa) return `${k.eoa.slice(0, 8)}…${k.eoa.slice(-4)}`;
  if (k.qx) return `${k.qx.slice(0, 10)}…`;
  return "key";
}

export function shortKeyDisplayFromRequest(r: WalletKeyEnrollmentRequestRecord): string {
  if (r.eoa) return `${r.eoa.slice(0, 8)}…${r.eoa.slice(-4)}`;
  if (r.qx) return `${r.qx.slice(0, 10)}…`;
  return "key";
}

export function shortEntity(entityId: string): string {
  return `${entityId.slice(0, 10)}…${entityId.slice(-6)}`;
}

export async function submitAddKey(input: {
  session: WalletSession;
  config: WalletPublicConfig;
  adminEntity: WalletEntityRecord;
  targetEntityId: string;
  keyType: number;
  qx: string;
  qy: string;
  eoa: string;
  credentialId?: string;
}): Promise<void> {
  const fee = BigInt(input.config.bundlerFeeUsdc || "0");
  const keyId = computeKeyId(input.targetEntityId, input.keyType, input.qx, input.qy, input.eoa);
  const { userOp, userOpHash } = await buildSignedAddKeyUserOp({
    config: input.config,
    walletAddress: input.session.address,
    adminEntityId: input.adminEntity.entityId,
    adminQx: input.session.qx,
    adminQy: input.session.qy,
    adminCredentialId: input.session.credentialId,
    targetEntityId: input.targetEntityId,
    keyType: input.keyType,
    qx: input.qx,
    qy: input.qy,
    eoa: input.eoa,
    feeAmount: fee,
  });
  await submitSignedUserOp({
    config: input.config,
    userOp,
    userOpHash,
    walletAddress: input.session.address,
  });
  const result = await waitForUserOp(userOpHash);
  if (result.status !== "included") throw new Error(result.rejectReason ?? result.status);
  await registerWalletEntityKey({
    walletAddress: input.session.address,
    entityId: input.targetEntityId,
    keyId,
    keyType: input.keyType,
    qx: input.qx,
    qy: input.qy,
    eoa: input.keyType === KEY_EOA ? getAddress(input.eoa) : null,
    credentialId: input.credentialId ?? null,
  });
}

export { KEY_EOA, KEY_WEBAUTHN, KEY_YUBIKEY, zeroPadValue };
