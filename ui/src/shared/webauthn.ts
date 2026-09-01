import { encodeWebAuthnSignature } from "../../../commerce/shared/webauthn-signature.js";
import { listWalletRegistry } from "./wallet-session.js";

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

export async function createPasskey(
  displayName: string,
  options?: { attachment?: "platform" | "cross-platform" }
): Promise<PasskeyOwner> {
  if (!webAuthnSupported()) throw new Error("WebAuthn not supported");
  const challenge = randomChallenge();
  const authenticatorSelection: AuthenticatorSelectionCriteria = {
    residentKey: options?.attachment === "cross-platform" ? "discouraged" : "required",
    userVerification: "required",
  };
  if (options?.attachment) {
    authenticatorSelection.authenticatorAttachment = options.attachment;
  }
  const cred = (await navigator.credentials.create({
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
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey creation cancelled");
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
    credentialId: btoa(String.fromCharCode(...new Uint8Array(cred.rawId))),
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

/**
 * Discoverable WebAuthn get — returns credentialId from the assertion.
 * If a matching session is already in the local registry, returns owner coords from it.
 */
export async function authenticatePasskey(): Promise<(PasskeyOwner & { fromRegistry: boolean }) | null> {
  if (!webAuthnSupported()) throw new Error("WebAuthn not supported");
  const challenge = randomChallenge();
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: rpId(),
      userVerification: "required",
    },
  })) as PublicKeyCredential | null;
  if (!cred) return null;
  const credentialId = btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
  const rawId = bufferToHex(cred.rawId);
  const match = listWalletRegistry().find((w) => w.credentialId === credentialId);
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

/** Sign an ERC-4337 userOpHash with the passkey (OZ WebAuthnAuth encoding). */
export async function signUserOpHash(
  userOpHashHex: string,
  credentialId?: string,
  options?: { requireUv?: boolean }
): Promise<string> {
  if (!webAuthnSupported()) throw new Error("WebAuthn not supported");
  const hashBytes = hexToBytes(userOpHashHex);
  const allowCredentials = credentialId
    ? [{ id: base64ToBytes(credentialId), type: "public-key" as const }]
    : undefined;
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge: hashBytes,
      rpId: rpId(),
      userVerification: "required",
      allowCredentials,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey signing cancelled");
  const response = cred.response as AuthenticatorAssertionResponse;
  if (options?.requireUv) {
    assertAuthenticatorUvSet(response.authenticatorData);
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
  if (!webAuthnSupported()) throw new Error("WebAuthn not supported");
  const challenge = base64UrlToBytes(input.challengeBase64Url);
  const allowCredentials = input.credentialId
    ? [{ id: base64ToBytes(input.credentialId), type: "public-key" as const }]
    : undefined;
  const cred = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: rpId(),
      userVerification: "required",
      allowCredentials,
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey assertion cancelled");
  const response = cred.response as AuthenticatorAssertionResponse;
  return {
    credentialId: btoa(String.fromCharCode(...new Uint8Array(cred.rawId))),
    assertion: {
      authenticatorData: bufferToBase64(response.authenticatorData),
      clientDataJSON: bufferToBase64(response.clientDataJSON),
      signature: bufferToBase64(response.signature),
    },
  };
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
