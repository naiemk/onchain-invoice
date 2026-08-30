import { createHash, createPublicKey, verify } from "node:crypto";
import { parseWebAuthnAssertion, type WebAuthnAssertionParts } from "./webauthn-signature.js";

export interface WebAuthnAssertionJson {
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
  /** Optional; unused for ES256 verify but accepted for client forwarding. */
  userHandle?: string | null;
}

export interface VerifyWebAuthnOptions {
  /** Expected challenge bytes as base64url (same encoding as in clientDataJSON). */
  expectedChallengeBase64Url: string;
  /** Client rpId (e.g. example.com). */
  rpId: string;
  /** Explicit allowlist; when set, origin must match one entry exactly. */
  origins?: string[] | null;
  ownerQx: string;
  ownerQy: string;
}

/**
 * Verify a WebAuthn assertion (webauthn.get) against a P-256 owner key.
 * `assertion` may be browser AuthenticatorAssertionResponse fields as base64/base64url/hex.
 */
export function verifyWebAuthnAssertion(
  assertion: WebAuthnAssertionJson | AuthenticatorAssertionResponse,
  options: VerifyWebAuthnOptions
): void {
  const parts =
    assertion instanceof Object && "clientDataJSON" in assertion && assertion.clientDataJSON instanceof ArrayBuffer
      ? parseWebAuthnAssertion(assertion as AuthenticatorAssertionResponse)
      : parseAssertionJson(assertion as WebAuthnAssertionJson);

  let clientData: { type?: string; challenge?: string; origin?: string };
  try {
    clientData = JSON.parse(parts.clientDataJSON) as {
      type?: string;
      challenge?: string;
      origin?: string;
    };
  } catch {
    throw Object.assign(new Error("Invalid clientDataJSON"), { statusCode: 400, code: "invalid_assertion" });
  }

  if (clientData.type !== "webauthn.get") {
    throw Object.assign(new Error("Expected webauthn.get assertion"), {
      statusCode: 400,
      code: "invalid_assertion",
    });
  }

  if (!clientData.challenge || !challengesEqual(clientData.challenge, options.expectedChallengeBase64Url)) {
    throw Object.assign(new Error("Challenge mismatch"), { statusCode: 400, code: "challenge_mismatch" });
  }

  if (!clientData.origin || !originAllowed(clientData.origin, options.rpId, options.origins ?? null)) {
    throw Object.assign(new Error("Origin not allowed for client rpId"), {
      statusCode: 400,
      code: "origin_mismatch",
    });
  }

  const authData = Buffer.from(strip0x(parts.authenticatorData), "hex");
  const clientDataHash = createHash("sha256").update(parts.clientDataJSON, "utf8").digest();
  const signed = Buffer.concat([authData, clientDataHash]);
  const sig = Buffer.concat([
    Buffer.from(strip0x(parts.r), "hex"),
    Buffer.from(strip0x(parts.s), "hex"),
  ]);
  const key = p256PublicKeyFromCoords(options.ownerQx, options.ownerQy);
  const ok = verify("sha256", signed, { key, dsaEncoding: "ieee-p1363" }, sig);
  if (!ok) {
    throw Object.assign(new Error("Invalid WebAuthn signature"), {
      statusCode: 400,
      code: "invalid_signature",
    });
  }
}

export function originAllowed(origin: string, rpId: string, origins: string[] | null): boolean {
  if (origins && origins.length > 0) {
    return origins.some((o) => o === origin);
  }
  let host: string;
  try {
    host = new URL(origin).hostname.toLowerCase();
  } catch {
    return false;
  }
  const rp = rpId.toLowerCase();
  return host === rp || host.endsWith(`.${rp}`);
}

export function challengeToBase64Url(bytes: Buffer | Uint8Array): string {
  return Buffer.from(bytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function p256PublicKeyFromCoords(qx: string, qy: string) {
  const x = Buffer.from(strip0x(qx), "hex");
  const y = Buffer.from(strip0x(qy), "hex");
  if (x.length !== 32 || y.length !== 32) {
    throw Object.assign(new Error("Invalid P-256 coordinates"), { statusCode: 400 });
  }
  // SPKI prefix for id-ecPublicKey + prime256v1 + uncompressed point
  const spkiPrefix = Buffer.from("3059301306072a8648ce3d020106082a8648ce3d030107034200", "hex");
  const der = Buffer.concat([spkiPrefix, Buffer.from([0x04]), x, y]);
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

function parseAssertionJson(assertion: WebAuthnAssertionJson): WebAuthnAssertionParts {
  const clientDataJSON = decodeToUtf8(assertion.clientDataJSON);
  const authenticatorData = decodeToHex(assertion.authenticatorData);
  const sigBuf = decodeToBuffer(assertion.signature);
  const { r, s } = parseEs256(sigBuf);
  const typeIndex = clientDataJSON.indexOf('"type":"webauthn.get"');
  const challengeIndex = clientDataJSON.indexOf('"challenge":"');
  if (typeIndex < 0 || challengeIndex < 0) {
    throw Object.assign(new Error("Invalid WebAuthn clientDataJSON"), {
      statusCode: 400,
      code: "invalid_assertion",
    });
  }
  return {
    r,
    s,
    challengeIndex,
    typeIndex,
    authenticatorData,
    clientDataJSON,
  };
}

function parseEs256(bytes: Buffer): { r: string; s: string } {
  if (bytes.length === 64) {
    return {
      r: "0x" + bytes.subarray(0, 32).toString("hex"),
      s: "0x" + bytes.subarray(32, 64).toString("hex"),
    };
  }
  // DER
  let offset = 0;
  if (bytes[offset++] !== 0x30) throw new Error("Invalid DER signature");
  offset++;
  if (bytes[offset++] !== 0x02) throw new Error("Invalid DER r");
  const rLen = bytes[offset++]!;
  const rBytes = bytes.subarray(offset, offset + rLen);
  offset += rLen;
  if (bytes[offset++] !== 0x02) throw new Error("Invalid DER s");
  const sLen = bytes[offset++]!;
  const sBytes = bytes.subarray(offset, offset + sLen);
  return {
    r: "0x" + pad32(rBytes).toString("hex"),
    s: "0x" + pad32(sBytes).toString("hex"),
  };
}

function pad32(bytes: Buffer): Buffer {
  if (bytes.length === 32) return bytes;
  if (bytes.length === 33 && bytes[0] === 0x00) return bytes.subarray(1);
  const out = Buffer.alloc(32);
  bytes.copy(out, 32 - bytes.length);
  return out;
}

function challengesEqual(a: string, b: string): boolean {
  return normalizeB64Url(a) === normalizeB64Url(b);
}

function normalizeB64Url(value: string): string {
  return value.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeToUtf8(value: string): string {
  if (looksLikeUtf8Json(value)) return value;
  return decodeToBuffer(value).toString("utf8");
}

function looksLikeUtf8Json(value: string): boolean {
  const t = value.trim();
  return t.startsWith("{") && t.includes("challenge");
}

function decodeToHex(value: string): string {
  if (value.startsWith("0x")) return value.toLowerCase();
  return "0x" + decodeToBuffer(value).toString("hex");
}

function decodeToBuffer(value: string): Buffer {
  if (value.startsWith("0x")) return Buffer.from(value.slice(2), "hex");
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return Buffer.from(b64 + pad, "base64");
}

function strip0x(hex: string): string {
  return hex.startsWith("0x") ? hex.slice(2) : hex;
}
