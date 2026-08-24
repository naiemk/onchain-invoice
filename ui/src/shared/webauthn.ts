import { encodeWebAuthnSignature } from "../../../commerce/shared/webauthn-signature.js";

export interface PasskeyOwner {
  qx: string;
  qy: string;
  credentialId: string;
  rawId: string;
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

export async function createPasskey(displayName: string): Promise<PasskeyOwner> {
  if (!webAuthnSupported()) throw new Error("WebAuthn not supported");
  const challenge = randomChallenge();
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
      authenticatorSelection: {
        residentKey: "required",
        userVerification: "required",
      },
    },
  })) as PublicKeyCredential | null;
  if (!cred) throw new Error("Passkey creation cancelled");
  const response = cred.response as AuthenticatorAttestationResponse;
  const pk = response.getPublicKey?.();
  if (!pk) throw new Error("Could not read passkey public key");
  const { qx, qy } = spkiToP256Coordinates(pk);
  return {
    qx,
    qy,
    credentialId: btoa(String.fromCharCode(...new Uint8Array(cred.rawId))),
    rawId: bufferToHex(cred.rawId),
  };
}

export async function authenticatePasskey(): Promise<PasskeyOwner | null> {
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
  const stored = loadWalletSession();
  if (!stored) return null;
  return {
    qx: stored.qx,
    qy: stored.qy,
    credentialId: stored.credentialId,
    rawId: stored.rawId,
  };
}

/** Sign an ERC-4337 userOpHash with the passkey (OZ WebAuthnAuth encoding). */
export async function signUserOpHash(userOpHashHex: string, credentialId?: string): Promise<string> {
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
  return encodeWebAuthnSignature(cred.response as AuthenticatorAssertionResponse);
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

export interface WalletSession {
  address: string;
  chainId: string;
  qx: string;
  qy: string;
  credentialId: string;
  rawId: string;
  label: string;
}

const SESSION_KEY = "tc-wallet-session";

export function saveWalletSession(session: WalletSession): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function loadWalletSession(): WalletSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as WalletSession;
  } catch {
    return null;
  }
}

export function clearWalletSession(): void {
  localStorage.removeItem(SESSION_KEY);
}
