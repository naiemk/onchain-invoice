import { Contract, JsonRpcProvider, ZeroAddress, ZeroHash, zeroPadValue } from "ethers";
import type { IdentityMethodKind } from "../../../commerce/shared/identity.js";
import {
  METHOD_EOA,
  METHOD_WEBAUTHN,
  METHOD_YUBIKEY,
  computeIdentityMethodId,
  encodeIdentityBlob,
  hashIdentityAddMethod,
  hashIdentityRemoveMethod,
  wrapIdentityMethodSignature,
} from "../../../commerce/shared/identity-store.js";
import { t } from "../i18n/t.js";
import { KEY_YUBIKEY } from "../../../commerce/shared/advanced-wallet.js";
import { fetchWalletConfig, primaryChain } from "./wallet-api.js";
import { signUserOpHash } from "./webauthn.js";
import type { WalletSession } from "./wallet-session.js";
import { signIdentityAddMethodTypedData, signIdentityVerifyTypedData } from "./eoa-connector.js";
import { fetchIdentityMe } from "./identity-api.js";
import { credentialIdsMatch } from "./credential-id.js";

function kindNum(kind: IdentityMethodKind): number {
  if (kind === "yubikey") return METHOD_YUBIKEY;
  if (kind === "eoa") return METHOD_EOA;
  return METHOD_WEBAUTHN;
}

function paddedCoord(value: string | undefined | null): string {
  if (!value) return ZeroHash;
  try {
    return zeroPadValue(value, 32);
  } catch {
    return ZeroHash;
  }
}

function sameHex(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

export type IdentitySigningSession = {
  identityId: string;
  credentialId: string;
  qx: string;
  qy: string;
  keyType?: number;
};

/**
 * This browser's identity method. Credential id is the source of truth — not
 * wallet_devices or Super Wallet roster coords, which can drift after adding a
 * YubiKey or pairing.
 */
export async function identitySignerFromSession(session: IdentitySigningSession): Promise<{
  kind: number;
  methodId: string;
  qx: string;
  qy: string;
  credentialId: string;
}> {
  const identityId = session.identityId;
  const keys = (await fetchIdentityMe().catch(() => null))?.keys ?? [];
  const row =
    keys.find((k) => k.credentialId && credentialIdsMatch(k.credentialId, session.credentialId)) ??
    keys.find(
      (k) =>
        k.kind !== "eoa" &&
        k.qx &&
        k.qy &&
        sameHex(paddedCoord(k.qx), paddedCoord(session.qx)) &&
        sameHex(paddedCoord(k.qy), paddedCoord(session.qy))
    );
  const existingKind = row
    ? kindNum(row.kind)
    : session.keyType === KEY_YUBIKEY
      ? METHOD_YUBIKEY
      : METHOD_WEBAUTHN;
  const kind = row?.kind === "eoa" ? METHOD_EOA : existingKind;
  const qx = row?.kind === "eoa" ? ZeroHash : paddedCoord(row?.qx ?? session.qx);
  const qy = row?.kind === "eoa" ? ZeroHash : paddedCoord(row?.qy ?? session.qy);
  const eoa = row?.kind === "eoa" && row.eoa ? row.eoa : ZeroAddress;
  const methodId =
    row?.id ?? computeIdentityMethodId(identityId, kind, qx, qy, eoa);
  return {
    kind: row?.kind === "eoa" ? METHOD_EOA : kind,
    methodId,
    qx,
    qy,
    credentialId: session.credentialId,
  };
}

async function signIdentityDigest(session: IdentitySigningSession, digest: string): Promise<string> {
  const signer = await identitySignerFromSession(session);
  const inner = await signUserOpHash(digest, signer.credentialId, {
    requireUv: signer.kind === METHOD_YUBIKEY,
  });
  return encodeIdentityBlob({
    kind: signer.kind,
    identityId: session.identityId,
    methodId: signer.methodId,
    inner,
  });
}

/** IDS1 authorization from the current session passkey over hashAddMethod. */
export async function signAddMethodAuthorization(input: {
  session: WalletSession;
  kind: IdentityMethodKind;
  qx?: string;
  qy?: string;
  eoa?: string;
  storeAddress?: string;
}): Promise<string> {
  const identityId = input.session.identityId;
  if (!identityId) throw new Error(t("wallet.recoverNeedSession"));
  const config = await fetchWalletConfig();
  const store = input.storeAddress ?? config.identityStoreAddress;
  if (!store) throw new Error(t("wallet.noFactory"));
  const chainId = BigInt(input.session.chainId || config.chainId || "0");
  if (!chainId) throw new Error(t("wallet.noFactory"));
  const qx = input.kind === "eoa" ? ZeroHash : paddedCoord(input.qx);
  const qy = input.kind === "eoa" ? ZeroHash : paddedCoord(input.qy);
  const eoa = input.eoa ?? ZeroAddress;
  const digest = hashIdentityAddMethod(store, chainId, {
    identityId,
    kind: kindNum(input.kind),
    qx,
    qy,
    eoa,
  });
  return signIdentityDigest(
    {
      identityId,
      credentialId: input.session.credentialId,
      qx: input.session.qx,
      qy: input.session.qy,
      keyType: input.session.keyType,
    },
    digest
  );
}

/** IDS1 authorization from the current session passkey over hashRemoveMethod. */
export async function signRemoveMethodAuthorization(input: {
  session: WalletSession;
  methodId: string;
  storeAddress?: string;
  digest?: string;
}): Promise<string> {
  const identityId = input.session.identityId;
  if (!identityId) throw new Error(t("wallet.recoverNeedSession"));
  const config = await fetchWalletConfig();
  const store = input.storeAddress ?? config.identityStoreAddress;
  if (!store) throw new Error(t("wallet.removeNeedStore"));
  const chainId = BigInt(input.session.chainId || config.chainId || "0");
  if (!chainId) throw new Error(t("wallet.noFactory"));
  const digest =
    input.digest ?? hashIdentityRemoveMethod(store, chainId, identityId, input.methodId);
  return signIdentityDigest(
    {
      identityId,
      credentialId: input.session.credentialId,
      qx: input.session.qx,
      qy: input.session.qy,
      keyType: input.session.keyType,
    },
    digest
  );
}

export type RecoverProvingMethod = {
  kind: "yubikey" | "eoa";
  credentialId?: string | null;
  qx?: string | null;
  qy?: string | null;
  eoa?: string | null;
};

async function identityAuthorizationAccepted(
  digest: string,
  authorization: string,
  identityId: string
): Promise<boolean> {
  const config = await fetchWalletConfig();
  const store = config.identityStoreAddress;
  const rpc = primaryChain(config).rpcUrl;
  if (!store || !rpc) return false;
  try {
    const recovered = (await new Contract(
      store,
      ["function verify(bytes32 message, bytes blob) view returns (bytes32)"],
      new JsonRpcProvider(rpc)
    ).verify(digest, authorization)) as string;
    return recovered.toLowerCase() === identityId.toLowerCase();
  } catch {
    return false;
  }
}

export async function signRecoverAddMethodAuthorization(input: {
  identityId: string;
  proving: RecoverProvingMethod;
  kind?: IdentityMethodKind;
  qx: string;
  qy: string;
}): Promise<string> {
  const config = await fetchWalletConfig();
  const store = config.identityStoreAddress;
  if (!store) throw new Error(t("wallet.noFactory"));
  const chainId = BigInt(config.chainId || "0");
  if (!chainId) throw new Error(t("wallet.noFactory"));
  const kind = kindNum(input.kind ?? "webauthn");
  const qx = paddedCoord(input.qx);
  const qy = paddedCoord(input.qy);
  const digest = hashIdentityAddMethod(store, chainId, {
    identityId: input.identityId,
    kind,
    qx,
    qy,
    eoa: ZeroAddress,
  });
  if (input.proving.kind === "eoa") {
    const eoa = input.proving.eoa;
    if (!eoa) throw new Error(t("wallet.recoverNeedOtherKey"));
    const signed = await signIdentityAddMethodTypedData({
      store,
      chainId,
      identityId: input.identityId,
      kind,
      qx,
      qy,
      eoa: ZeroAddress,
    });
    const addMethodAuth = wrapIdentityMethodSignature({
      kind: METHOD_EOA,
      identityId: input.identityId,
      qx: ZeroHash,
      qy: ZeroHash,
      eoa,
      inner: signed.signature,
    });
    if (await identityAuthorizationAccepted(digest, addMethodAuth, input.identityId)) {
      return addMethodAuth;
    }
    const legacy = await signIdentityVerifyTypedData({ store, chainId, message: digest });
    return wrapIdentityMethodSignature({
      kind: METHOD_EOA,
      identityId: input.identityId,
      qx: ZeroHash,
      qy: ZeroHash,
      eoa,
      inner: legacy.signature,
    });
  }
  const credentialId = input.proving.credentialId;
  const provingQx = input.proving.qx;
  const provingQy = input.proving.qy;
  if (!credentialId || !provingQx || !provingQy) throw new Error(t("wallet.recoverNeedOtherKey"));
  const inner = await signUserOpHash(digest, credentialId, {
    requireUv: true,
    credentialIds: [credentialId],
  });
  return wrapIdentityMethodSignature({
    kind: METHOD_YUBIKEY,
    identityId: input.identityId,
    qx: provingQx,
    qy: provingQy,
    inner,
  });
}

export async function signRecoverUserOpAuthorization(input: {
  identityId: string;
  proving: RecoverProvingMethod;
  userOpHash: string;
}): Promise<string> {
  const config = await fetchWalletConfig();
  const store = config.identityStoreAddress;
  if (!store) throw new Error(t("wallet.noFactory"));
  const chainId = BigInt(config.chainId || "0");
  if (input.proving.kind === "eoa") {
    const eoa = input.proving.eoa;
    if (!eoa) throw new Error(t("wallet.recoverNeedOtherKey"));
    const signed = await signIdentityVerifyTypedData({ store, chainId, message: input.userOpHash });
    return wrapIdentityMethodSignature({
      kind: METHOD_EOA,
      identityId: input.identityId,
      qx: ZeroHash,
      qy: ZeroHash,
      eoa,
      inner: signed.signature,
    });
  }
  const credentialId = input.proving.credentialId;
  const qx = input.proving.qx;
  const qy = input.proving.qy;
  if (!credentialId || !qx || !qy) throw new Error(t("wallet.recoverNeedOtherKey"));
  const inner = await signUserOpHash(input.userOpHash, credentialId, { requireUv: true });
  return wrapIdentityMethodSignature({
    kind: METHOD_YUBIKEY,
    identityId: input.identityId,
    qx,
    qy,
    inner,
  });
}
