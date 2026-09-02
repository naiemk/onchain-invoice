import { encodeWebAuthnSignature } from "../../../commerce/shared/webauthn-signature.js";
import { credentialIdToBytes, credentialIdsMatch } from "./credential-id.js";
import {
  listWalletRegistry,
  upsertWalletSession,
  type WalletSession,
} from "./wallet-session.js";
import { t } from "../i18n/t.js";

export type { WalletSession } from "./wallet-session.js";
export {
  clearWalletSession,
  loadWalletSession,
  saveWalletSession,
  listWalletRegistry,
  upsertWalletSession,
  setActiveWallet,
  clearActiveWallet,
  removeFromRegistry,
  shortAddress,
  migrateWalletSessionStorage,
} from "./wallet-session.js";

export interface PasskeyOwner {
  qx: string;
  qy: string;
  credentialId: string;
  rawId: string;
  attestation?: {
    clientDataJSON: string;
    attestationObject: string;
  };
}

/** Thrown when a cross-platform (YubiKey) ceremony completes without user verification (UV). */
export class YubiKeyPinRequiredError extends Error {
  constructor() {
    super("yubikey_pin_required");
    this.name = "YubiKeyPinRequiredError";
  }
}

export function isYubiKeyPinRequiredError(error: unknown): boolean {
  return error instanceof YubiKeyPinRequiredError || (error instanceof Error && error.message === "yubikey_pin_required");
}

export type WebAuthnErrorCode =
  | "cancelled"
  | "busy"
  | "not_supported"
  | "security_blocked"
  | "timeout"
  | "unknown";

/** Structured WebAuthn failure with a stable machine-readable code. */
export class WebAuthnError extends Error {
  readonly code: WebAuthnErrorCode;

  constructor(code: WebAuthnErrorCode, cause?: unknown) {
    super(messageForWebAuthnCode(code));
    this.name = "WebAuthnError";
    this.code = code;
    if (cause !== undefined) this.cause = cause;
  }
}

export function isWebAuthnError(error: unknown, code?: WebAuthnErrorCode): boolean {
  if (!(error instanceof WebAuthnError)) return false;
  return code ? error.code === code : true;
}

export function isWebAuthnCancelled(error: unknown): boolean {
  return isWebAuthnError(error, "cancelled");
}

function messageForWebAuthnCode(code: WebAuthnErrorCode): string {
  switch (code) {
    case "cancelled":
      return t("wallet.passkeyCancelled");
    case "busy":
      return t("wallet.passkeyAuthenticatorBusy");
    case "not_supported":
      return t("wallet.passkeyNotSupported");
    case "security_blocked":
      return t("wallet.passkeySecurityBlocked");
    case "timeout":
      return t("wallet.passkeyTimeout");
    default:
      return t("wallet.signInFailed");
  }
}

/** Map unknown errors to user-facing passkey copy (preserves local_recovery and API errors). */
export function formatPasskeyError(error: unknown): string {
  if (error instanceof WebAuthnError) return error.message;
  if (error instanceof YubiKeyPinRequiredError) return t("wallet.yubikeyPinRequiredTitle");
  if (error instanceof Error) return error.message;
  return String(error);
}

/** WebAuthn authenticatorData flags byte — bit 2 is user verified (UV). */
export function authenticatorUvSet(authenticatorData: ArrayBuffer | Uint8Array): boolean {
  const bytes = authenticatorData instanceof Uint8Array ? authenticatorData : new Uint8Array(authenticatorData);
  if (bytes.length < 33) return false;
  return (bytes[32]! & 0x04) !== 0;
}

export function assertAuthenticatorUvSet(authenticatorData: ArrayBuffer | Uint8Array): void {
  if (!authenticatorUvSet(authenticatorData)) throw new YubiKeyPinRequiredError();
}

function rpId(): string {
  return window.location.hostname;
}

function randomChallenge(): Uint8Array {
  const buf = new Uint8Array(32);
  crypto.getRandomValues(buf);
  return buf;
}

function bufferToHex32(bytes: Uint8Array, offset: number): string {
  const slice = bytes.slice(offset, offset + 32);
  return "0x" + [...slice].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Parse SPKI DER for P-256 uncompressed point (last 65 bytes 0x04||x||y). */
export function spkiToP256Coordinates(spki: ArrayBuffer): { qx: string; qy: string } {
  const bytes = new Uint8Array(spki);
  if (bytes.length < 65) throw new Error("Invalid SPKI");
  const start = bytes.length - 65;
  if (bytes[start] !== 0x04) throw new Error("Expected uncompressed P-256 point");
  return {
    qx: bufferToHex32(bytes, start + 1),
    qy: bufferToHex32(bytes, start + 33),
  };
}

export function webAuthnSupported(): boolean {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

function credentialIdFromRawId(rawId: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(rawId)));
}

function platformRequestOptions(
  challenge: BufferSource,
  allowCredentials?: PublicKeyCredentialDescriptor[]
): PublicKeyCredentialRequestOptions {
  return {
    challenge,
    rpId: rpId(),
    userVerification: "required",
    ...(allowCredentials ? { allowCredentials } : { hints: ["client-device"] as PublicKeyCredentialRequestOptions["hints"] }),
  };
}

/** Serialize every WebAuthn ceremony so the platform never sees overlapping get/create calls. */
let webAuthnTail: Promise<void> = Promise.resolve();

async function withWebAuthnLock<T>(fn: () => Promise<T>): Promise<T> {
  const previous = webAuthnTail;
  let release!: () => void;
  webAuthnTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await fn();
  } finally {
    release();
  }
}

export function mapWebAuthnDomException(error: unknown): WebAuthnError {
  if (error instanceof WebAuthnError) return error;
  if (error instanceof DOMException) {
    switch (error.name) {
      case "NotAllowedError":
        return new WebAuthnError("cancelled", error);
      case "InvalidStateError":
        return new WebAuthnError("busy", error);
      case "AbortError":
        return new WebAuthnError("cancelled", error);
      case "SecurityError":
        return new WebAuthnError("security_blocked", error);
      case "TimeoutError":
        return new WebAuthnError("timeout", error);
      default:
        return new WebAuthnError("unknown", error);
    }
  }
  return new WebAuthnError("unknown", error);
}

function assertWebAuthnSupported(): void {
  if (!webAuthnSupported()) throw new WebAuthnError("not_supported");
}

async function webAuthnGet(
  options: PublicKeyCredentialRequestOptions
): Promise<PublicKeyCredential | null> {
  return withWebAuthnLock(async () => {
    try {
      return (await navigator.credentials.get({ publicKey: options })) as PublicKeyCredential | null;
    } catch (error) {
      throw mapWebAuthnDomException(error);
    }
  });
}

async function webAuthnCreate(options: CredentialCreationOptions): Promise<PublicKeyCredential | null> {
  return withWebAuthnLock(async () => {
    try {
      return (await navigator.credentials.create(options)) as PublicKeyCredential | null;
    } catch (error) {
      throw mapWebAuthnDomException(error);
    }
  });
}

export async function createPasskey(
  displayName: string,
  options?: { attachment?: "platform" | "cross-platform" }
): Promise<PasskeyOwner> {
  assertWebAuthnSupported();
  const challenge = randomChallenge();
  const authenticatorSelection: AuthenticatorSelectionCriteria = {
    residentKey: options?.attachment === "cross-platform" ? "discouraged" : "required",
    userVerification: "required",
  };
  if (options?.attachment) {
    authenticatorSelection.authenticatorAttachment = options.attachment;
  }
  let cred: PublicKeyCredential | null;
  try {
    cred = await webAuthnCreate({
      publicKey: {
        challenge,
        rp: { name: "Trustless Commerce Wallet", id: rpId() },
        user: {
          id: crypto.getRandomValues(new Uint8Array(16)),
          name: displayName,
          displayName,
        },
        pubKeyCredParams: [{ alg: -7, type: "public-key" }],
        authenticatorSelection,
      },
    });
  } catch (error) {
    if (isWebAuthnCancelled(error)) {
      throw new Error(t("wallet.passkeyCreationCancelled"));
    }
    throw error;
  }
  if (!cred) throw new Error(t("wallet.passkeyCreationCancelled"));
  const response = cred.response as AuthenticatorAttestationResponse;
  if (options?.attachment === "cross-platform") {
    assertAuthenticatorUvSet(response.getAuthenticatorData());
  }
  const pk = response.getPublicKey?.();
  if (!pk) throw new Error("Could not read passkey public key");
  const { qx, qy } = spkiToP256Coordinates(pk);
  const attObj = response.attestationObject;
  const clientData = response.clientDataJSON;
  return {
    qx,
    qy,
    credentialId: credentialIdFromRawId(cred.rawId),
    rawId: bufferToHex(cred.rawId),
    attestation: {
      clientDataJSON: bufferToBase64(clientData),
      attestationObject: bufferToBase64(attObj),
    },
  };
}

/** Enroll a cross-platform security key (YubiKey) with UV/PIN required. */
export async function createSecurityKey(displayName: string): Promise<PasskeyOwner> {
  return createPasskey(displayName, { attachment: "cross-platform" });
}

async function getPasskeyAssertion(
  options: PublicKeyCredentialRequestOptions
): Promise<PublicKeyCredential | null> {
  try {
    return await webAuthnGet(options);
  } catch (error) {
    if (isWebAuthnCancelled(error)) return null;
    throw error;
  }
}

function assertCredentialMatchesRequest(expectedCredentialId: string | undefined, rawId: ArrayBuffer): void {
  if (!expectedCredentialId?.trim()) return;
  const actualCredentialId = credentialIdFromRawId(rawId);
  if (!credentialIdsMatch(expectedCredentialId, actualCredentialId)) {
    throw Object.assign(new Error(t("wallet.unlockWrongWallet")), { code: "wrong_wallet" });
  }
}

function requireWalletBoundCredentialId(credentialId: string | undefined): string {
  const trimmed = credentialId?.trim();
  if (!trimmed) {
    throw Object.assign(new Error(t("wallet.passkeyMissingOnDevice")), { code: "missing_credential_id" });
  }
  return trimmed;
}

/**
 * Discoverable WebAuthn get — returns credentialId from the assertion.
 * When credentialId is provided, pins allowCredentials to that passkey.
 */
export async function authenticatePasskey(input?: {
  credentialId?: string;
}): Promise<(PasskeyOwner & { fromRegistry: boolean }) | null> {
  assertWebAuthnSupported();
  const allowCredentials = input?.credentialId?.trim()
    ? [{ id: credentialIdToBytesLocal(input.credentialId), type: "public-key" as const }]
    : undefined;
  const cred = await getPasskeyAssertion(platformRequestOptions(randomChallenge(), allowCredentials));
  if (!cred) return null;
  assertCredentialMatchesRequest(input?.credentialId, cred.rawId);
  const credentialId = credentialIdFromRawId(cred.rawId);
  const rawId = bufferToHex(cred.rawId);
  const match = listWalletRegistry().find((w) => credentialIdsMatch(w.credentialId, credentialId));
  if (match) {
    return {
      qx: match.qx,
      qy: match.qy,
      credentialId: match.credentialId,
      rawId: match.rawId || rawId,
      fromRegistry: true,
    };
  }
  return {
    qx: "",
    qy: "",
    credentialId,
    rawId,
    fromRegistry: false,
  };
}

/** Restore credentialId from local registry or server before a pinned-credential ceremony. */
export async function ensureSessionCredential(session: WalletSession): Promise<WalletSession> {
  if (session.credentialId?.trim()) return session;

  const reg = listWalletRegistry().find(
    (w) => w.address.toLowerCase() === session.address.toLowerCase() && w.credentialId?.trim()
  );
  if (reg?.credentialId) {
    const next = { ...session, credentialId: reg.credentialId, rawId: reg.rawId || session.rawId };
    upsertWalletSession(next);
    return next;
  }

  const { listDevices } = await import("./wallet-api.js");
  const devices = await listDevices(session.address, session.chainId);
  const match = devices.find(
    (d) => d.credentialId && d.ownerQx === session.qx && d.ownerQy === session.qy
  );
  if (match?.credentialId) {
    const next = { ...session, credentialId: match.credentialId };
    upsertWalletSession(next);
    return next;
  }

  return session;
}

/** Keep registry in sync when the platform passkey id differs from what we stored. */
export function syncSessionCredentialId(session: WalletSession, rawId: ArrayBuffer): WalletSession {
  const credentialId = credentialIdFromRawId(rawId);
  if (session.credentialId === credentialId) return session;
  const next = { ...session, credentialId, rawId: bufferToHex(rawId) };
  upsertWalletSession(next);
  return next;
}

/**
 * Sign an ERC-4337 userOpHash with the passkey (OZ WebAuthnAuth encoding).
 * Platform passkeys use discoverable + client-device (Touch ID). YubiKeys pin credentialId.
 */
export async function signUserOpHash(
  userOpHashHex: string,
  credentialId?: string,
  options?: { requireUv?: boolean; session?: WalletSession }
): Promise<string> {
  assertWebAuthnSupported();
  const hashBytes = hexToBytes(userOpHashHex);
  const boundCredentialId = requireWalletBoundCredentialId(credentialId);
  const publicKey = platformRequestOptions(hashBytes, [
    { id: credentialIdToBytesLocal(boundCredentialId), type: "public-key" },
  ]);

  let cred: PublicKeyCredential | null;
  try {
    cred = await webAuthnGet(publicKey);
  } catch (error) {
    if (isWebAuthnCancelled(error)) {
      throw new Error(t("wallet.passkeySigningCancelled"));
    }
    throw error;
  }
  if (!cred) throw new Error(t("wallet.passkeySigningCancelled"));
  assertCredentialMatchesRequest(boundCredentialId, cred.rawId);
  const response = cred.response as AuthenticatorAssertionResponse;
  if (options?.requireUv) {
    assertAuthenticatorUvSet(response.authenticatorData);
  }
  if (options?.session) {
    syncSessionCredentialId(options.session, cred.rawId);
  }
  return encodeWebAuthnSignature(response);
}

/** Assert over a server challenge (base64url); returns JSON fields for API posts. */
export async function assertPasskeyChallenge(input: {
  challengeBase64Url: string;
  credentialId?: string;
}): Promise<{
  assertion: {
    authenticatorData: string;
    clientDataJSON: string;
    signature: string;
  };
  credentialId: string;
}> {
  assertWebAuthnSupported();
  const challenge = base64UrlToBytes(input.challengeBase64Url);
  const allowCredentials = input.credentialId?.trim()
    ? [{ id: credentialIdToBytesLocal(input.credentialId), type: "public-key" as const }]
    : undefined;
  let cred: PublicKeyCredential | null;
  try {
    cred = await webAuthnGet(platformRequestOptions(challenge, allowCredentials));
  } catch (error) {
    if (isWebAuthnCancelled(error)) {
      throw new Error(t("wallet.passkeySigningCancelled"));
    }
    throw error;
  }
  if (!cred) throw new Error(t("wallet.passkeySigningCancelled"));
  assertCredentialMatchesRequest(input.credentialId, cred.rawId);
  const response = cred.response as AuthenticatorAssertionResponse;
  return {
    credentialId: credentialIdFromRawId(cred.rawId),
    assertion: {
      authenticatorData: bufferToBase64(response.authenticatorData),
      clientDataJSON: bufferToBase64(response.clientDataJSON),
      signature: bufferToBase64(response.signature),
    },
  };
}

function credentialIdToBytesLocal(credentialId: string): Uint8Array {
  return credentialIdToBytes(credentialId);
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const pad = "=".repeat((4 - (b64url.length % 4)) % 4);
  const b64 = (b64url + pad).replace(/-/g, "+").replace(/_/g, "/");
  return base64ToBytes(b64);
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bufferToHex(buf: ArrayBuffer): string {
  return "0x" + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bufferToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}
