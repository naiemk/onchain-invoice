import { credentialIdsMatch } from "./credential-id.js";

export type PasskeyCoords = { qx: string; qy: string };

export type PasskeyBindAccount = {
  ownerQx: string;
  ownerQy: string;
  credentialId: string | null;
};

export type PasskeyBindDevice = {
  credentialId: string | null;
  ownerQx: string;
  ownerQy: string;
};

export type PasskeyBindKey = {
  credentialId: string | null;
  qx: string | null;
  qy: string | null;
};

export type PubkeyBindInput = {
  credentialId: string;
  account?: PasskeyBindAccount | null;
  rosterKeys?: PasskeyBindKey[];
  registry?: { credentialId: string; qx: string; qy: string } | null;
  session?: { credentialId?: string; qx?: string; qy?: string } | null;
  devices?: PasskeyBindDevice[];
};

function sameHex(a: string | undefined | null, b: string | undefined | null): boolean {
  if (!a || !b) return false;
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * Device row reused the wallet's first-owner P-256 coords for a different
 * credentialId. Unlock used to upsert by (qx, qy), which overwrote the
 * original device's credential_id. Packing that qx and signing with this
 * passkey is AA24.
 */
export function isPoisonedDeviceRow(
  device: PasskeyBindDevice,
  account?: PasskeyBindAccount | null
): boolean {
  if (!device.credentialId?.trim() || !account?.ownerQx || !account.ownerQy) return false;
  if (!sameHex(device.ownerQx, account.ownerQx) || !sameHex(device.ownerQy, account.ownerQy)) {
    return false;
  }
  if (!account.credentialId?.trim()) return false;
  return !credentialIdsMatch(device.credentialId, account.credentialId);
}

function sessionReusesFirstOwner(
  session: { credentialId?: string; qx?: string; qy?: string },
  credentialId: string,
  account?: PasskeyBindAccount | null
): boolean {
  if (!account?.ownerQx || !account.ownerQy || !session.qx || !session.qy) return false;
  if (!sameHex(session.qx, account.ownerQx) || !sameHex(session.qy, account.ownerQy)) return false;
  if (!account.credentialId?.trim()) return false;
  return !credentialIdsMatch(credentialId, account.credentialId);
}

/** Pick P-256 coords that were stored with this credential, not the first owner fallback. */
export function selectPubkeyForCredential(input: PubkeyBindInput): {
  qx: string;
  qy: string;
  source: string;
} {
  const cred = input.credentialId;

  const roster = input.rosterKeys?.find(
    (k) => k.credentialId && k.qx && k.qy && credentialIdsMatch(k.credentialId, cred)
  );
  if (roster?.qx && roster.qy) {
    return { qx: roster.qx, qy: roster.qy, source: "roster" };
  }

  if (
    input.registry &&
    credentialIdsMatch(input.registry.credentialId, cred) &&
    input.registry.qx &&
    input.registry.qy
  ) {
    return { qx: input.registry.qx, qy: input.registry.qy, source: "registry" };
  }

  if (
    input.session &&
    credentialIdsMatch(input.session.credentialId, cred) &&
    input.session.qx &&
    input.session.qy &&
    !sessionReusesFirstOwner(input.session, cred, input.account)
  ) {
    return { qx: input.session.qx, qy: input.session.qy, source: "session" };
  }

  const device = input.devices?.find(
    (d) => d.credentialId && credentialIdsMatch(d.credentialId, cred)
  );
  if (device?.ownerQx && device.ownerQy && !isPoisonedDeviceRow(device, input.account)) {
    return { qx: device.ownerQx, qy: device.ownerQy, source: "device" };
  }

  if (
    input.account?.credentialId &&
    credentialIdsMatch(input.account.credentialId, cred) &&
    input.account.ownerQx &&
    input.account.ownerQy
  ) {
    return { qx: input.account.ownerQx, qy: input.account.ownerQy, source: "account" };
  }

  return { qx: "", qy: "", source: device ? "poisoned_device_row" : "none" };
}
