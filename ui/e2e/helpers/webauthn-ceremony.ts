import { createHash, createPrivateKey, generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { challengeToBase64Url } from "../../../commerce/shared/webauthn-verify.js";

/** Face ID / iCloud passkey assertion: UP, UV, backup-eligible, and backed up. */
export const FACE_ID_ASSERTION_FLAGS = 0x1d;
/** Registration adds the attested-credential bit. */
export const FACE_ID_REGISTRATION_FLAGS = 0x5d;
/** Security key with PIN: UP and UV, not synced. */
export const SECURITY_KEY_ASSERTION_FLAGS = 0x05;
export const SECURITY_KEY_REGISTRATION_FLAGS = 0x45;
/** Security key when the page discourages user verification: UP only. */
export const SECURITY_KEY_NO_UV_ASSERTION_FLAGS = 0x01;
export const SECURITY_KEY_NO_UV_REGISTRATION_FLAGS = 0x41;

const PLATFORM_TRANSPORTS = ["internal", "hybrid"];
const SECURITY_KEY_TRANSPORTS = ["usb", "nfc", "ble"];
const SPKI_PREFIX = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex");
const COSE_PREFIX = Buffer.from("a5010203262001215820", "hex");
const COSE_Y = Buffer.from("225820", "hex");

export type AuthenticatorKind = "platform" | "cross-platform";

export type StoredCredential = {
  rawId: Buffer;
  credentialId: string;
  attachment: AuthenticatorKind;
  rpId: string;
  privateKeyPem: string;
  qx: string;
  qy: string;
  x: Buffer;
  y: Buffer;
  userHandle: Buffer;
  /** Authenticator signature counter. Face ID stays at 0. */
  signCount: number;
  discoverable: boolean;
};

export type CeremonyStore = {
  credentials: StoredCredential[];
  createCount: number;
  signCount: number;
  authenticateCount: number;
};

export type CeremonyRequest = {
  op: "create" | "get";
  origin: string;
  hostname: string;
  rpId?: string;
  challengeB64: string;
  attachment?: "" | AuthenticatorKind;
  userVerification?: "" | "required" | "preferred" | "discouraged";
  residentKey?: "" | "required" | "preferred" | "discouraged";
  requireResidentKey?: boolean;
  hints?: string[];
  params?: { alg: number; type: string }[];
  userHandleB64?: string;
  allow?: { idB64: string; transports?: string[] }[];
  exclude?: { idB64: string }[];
};

export type CeremonySuccess = {
  ok: true;
  op: "create" | "get";
  attachment: AuthenticatorKind;
  rawIdB64: string;
  credentialId: string;
  qx: string;
  qy: string;
  authenticatorDataB64: string;
  clientDataJSON: string;
  signatureB64: string;
  userHandleB64: string;
  spkiB64: string;
  attestationObjectB64: string;
};

export type CeremonyFailure = {
  ok: false;
  name: "NotAllowedError" | "SecurityError" | "InvalidStateError" | "NotSupportedError";
  message: string;
};

export type CeremonyResult = CeremonySuccess | CeremonyFailure;

export function emptyCeremonyStore(): CeremonyStore {
  return { credentials: [], createCount: 0, signCount: 0, authenticateCount: 0 };
}

/** OpenZeppelin accepts BE+BS, BE only, or neither, and rejects BS without BE. */
export function backupFlagsConsistent(flags: number): boolean {
  const backupEligible = (flags & 0x08) === 0x08;
  const backedUp = (flags & 0x10) !== 0;
  return backupEligible || !backedUp;
}

export function performWebAuthnCeremony(store: CeremonyStore, request: CeremonyRequest): CeremonyResult {
  const rpId = (request.rpId?.trim() || request.hostname).toLowerCase();
  const hostname = request.hostname.toLowerCase();
  if (!rpIdAllowed(rpId, hostname)) {
    return fail(
      "SecurityError",
      "The relying party ID is not a registrable domain suffix of the current domain."
    );
  }
  const challenge = Buffer.from(request.challengeB64, "base64");
  if (request.op === "create") return createCredential(store, request, rpId, challenge);
  return getAssertion(store, request, rpId, challenge);
}

function createCredential(
  store: CeremonyStore,
  request: CeremonyRequest,
  rpId: string,
  challenge: Buffer
): CeremonyResult {
  const params = request.params ?? [];
  const supportsEs256 = params.some((param) => param.alg === -7 && param.type === "public-key");
  if (!supportsEs256) {
    return fail("NotSupportedError", "No supported public key algorithm.");
  }
  const attachment: AuthenticatorKind = request.attachment === "cross-platform" ? "cross-platform" : "platform";
  for (const excluded of request.exclude ?? []) {
    const rawId = Buffer.from(excluded.idB64, "base64");
    const onThisAuthenticator = store.credentials.some(
      (credential) => credential.attachment === attachment && credential.rawId.equals(rawId)
    );
    if (onThisAuthenticator) {
      return fail("InvalidStateError", "The authenticator was previously registered.");
    }
  }

  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const point = spki.subarray(spki.length - 65);
  if (point[0] !== 0x04) return fail("NotAllowedError", "Could not read the passkey public key.");
  const x = Buffer.from(point.subarray(1, 33));
  const y = Buffer.from(point.subarray(33, 65));
  const rawId = randomBytes(16);
  const userHandle = request.userHandleB64 ? Buffer.from(request.userHandleB64, "base64") : randomBytes(16);
  const uv = userVerified(attachment, request.userVerification);
  const flags = assertionFlags(attachment, uv) | 0x40;
  const credential: StoredCredential = {
    rawId,
    credentialId: rawId.toString("base64"),
    attachment,
    rpId,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    qx: "0x" + x.toString("hex"),
    qy: "0x" + y.toString("hex"),
    x,
    y,
    userHandle,
    signCount: 0,
    discoverable:
      request.residentKey === "required" ||
      request.residentKey === "preferred" ||
      request.requireResidentKey === true,
  };
  store.credentials.push(credential);
  store.createCount += 1;
  const authenticatorData = buildAuthenticatorData(rpId, flags, 0, credential);
  const clientDataJSON = clientData("webauthn.create", challenge, request.origin);
  return success(credential, "create", authenticatorData, clientDataJSON, Buffer.alloc(0));
}

function getAssertion(
  store: CeremonyStore,
  request: CeremonyRequest,
  rpId: string,
  challenge: Buffer
): CeremonyResult {
  const allow = request.allow ?? [];
  const matches =
    allow.length > 0
      ? store.credentials.filter(
          (credential) =>
            credential.rpId === rpId &&
            allow.some((entry) => {
              const rawId = Buffer.from(entry.idB64, "base64");
              return credential.rawId.equals(rawId) && transportAllows(credential.attachment, entry.transports);
            })
        )
      : store.credentials.filter(
          (credential) =>
            credential.rpId === rpId &&
            credential.discoverable &&
            credential.attachment === ((request.hints ?? []).includes("security-key") ? "cross-platform" : "platform")
        );
  const credential = matches[matches.length - 1];
  if (!credential) return fail("NotAllowedError", "The operation either timed out or was not allowed.");

  if (credential.attachment === "cross-platform") credential.signCount += 1;
  const uv = userVerified(credential.attachment, request.userVerification);
  const authenticatorData = buildAuthenticatorData(
    rpId,
    assertionFlags(credential.attachment, uv),
    credential.signCount
  );
  const clientDataJSON = clientData("webauthn.get", challenge, request.origin);
  const clientHash = createHash("sha256").update(clientDataJSON, "utf8").digest();
  const signature = sign("sha256", Buffer.concat([authenticatorData, clientHash]), {
    key: createPrivateKey(credential.privateKeyPem),
    dsaEncoding: "der",
  });
  store.signCount += 1;
  store.authenticateCount += 1;
  return success(credential, "get", authenticatorData, clientDataJSON, signature);
}

function success(
  credential: StoredCredential,
  op: "create" | "get",
  authenticatorData: Buffer,
  clientDataJSON: string,
  signature: Buffer
): CeremonySuccess {
  const attested = op === "create";
  return {
    ok: true,
    op,
    attachment: credential.attachment,
    rawIdB64: credential.rawId.toString("base64"),
    credentialId: credential.credentialId,
    qx: credential.qx,
    qy: credential.qy,
    authenticatorDataB64: authenticatorData.toString("base64"),
    clientDataJSON,
    signatureB64: signature.toString("base64"),
    userHandleB64: credential.userHandle.toString("base64"),
    spkiB64: Buffer.concat([SPKI_PREFIX, Buffer.from([0x04]), credential.x, credential.y]).toString("base64"),
    attestationObjectB64: attested ? encodeNoneAttestation(authenticatorData).toString("base64") : "",
  };
}

function userVerified(kind: AuthenticatorKind, userVerification: CeremonyRequest["userVerification"]): boolean {
  if (kind === "platform") return true;
  return userVerification !== "discouraged";
}

function assertionFlags(kind: AuthenticatorKind, uv: boolean): number {
  let flags = 0x01;
  if (uv) flags |= 0x04;
  if (kind === "platform") flags |= 0x08 | 0x10;
  return flags;
}

function transportAllows(kind: AuthenticatorKind, transports: string[] | undefined): boolean {
  if (!transports || transports.length === 0) return true;
  const mine = kind === "platform" ? PLATFORM_TRANSPORTS : SECURITY_KEY_TRANSPORTS;
  return transports.some((transport) => mine.includes(transport.toLowerCase()));
}

function rpIdAllowed(rpId: string, hostname: string): boolean {
  if (!rpId || !hostname) return false;
  if (hostname === rpId) return true;
  return hostname.endsWith(`.${rpId}`);
}

function clientData(type: "webauthn.create" | "webauthn.get", challenge: Buffer, origin: string): string {
  return JSON.stringify({
    type,
    challenge: challengeToBase64Url(challenge),
    origin,
    crossOrigin: false,
  });
}

function buildAuthenticatorData(rpId: string, flags: number, signCount: number, attested?: StoredCredential): Buffer {
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(signCount >>> 0, 0);
  const head = Buffer.concat([createHash("sha256").update(rpId).digest(), Buffer.from([flags]), counter]);
  if (!attested) return head;
  const credLen = Buffer.alloc(2);
  credLen.writeUInt16BE(attested.rawId.length, 0);
  return Buffer.concat([
    head,
    Buffer.alloc(16),
    credLen,
    attested.rawId,
    COSE_PREFIX,
    attested.x,
    COSE_Y,
    attested.y,
  ]);
}

function encodeNoneAttestation(authData: Buffer): Buffer {
  const length =
    authData.length < 256
      ? Buffer.from([0x58, authData.length])
      : Buffer.from([0x59, (authData.length >> 8) & 0xff, authData.length & 0xff]);
  return Buffer.concat([
    Buffer.from("a363666d74646e6f6e656761747453746d74a0686175746844617461", "hex"),
    length,
    authData,
  ]);
}

function fail(name: CeremonyFailure["name"], message: string): CeremonyFailure {
  return { ok: false, name, message };
}
