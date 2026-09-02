import { AbiCoder } from "ethers";

export interface WebAuthnAssertionParts {
  r: string;
  s: string;
  challengeIndex: number;
  typeIndex: number;
  authenticatorData: string;
  clientDataJSON: string;
}

/** Parse ES256 WebAuthn assertion and ABI-encode for OZ WebAuthn.verify. */
export function encodeWebAuthnSignature(assertion: AuthenticatorAssertionResponse): string {
  const parts = parseWebAuthnAssertion(assertion);
  return encodeWebAuthnParts(parts);
}

/** Encode assertion fields already as base64/hex/JSON strings (API / worker). */
export function encodeWebAuthnSignatureFromJson(input: {
  authenticatorData: string;
  clientDataJSON: string;
  signature: string;
}): string {
  const clientDataJSON = decodeClientData(input.clientDataJSON);
  const authenticatorData = decodeToHex(input.authenticatorData);
  const sigBuf = decodeToBytes(input.signature);
  const { r, s } = parseEs256Signature(
    sigBuf.buffer.slice(sigBuf.byteOffset, sigBuf.byteOffset + sigBuf.byteLength) as ArrayBuffer
  );
  const typeIndex = clientDataJSON.indexOf('"type":"webauthn.get"');
  const challengeIndex = clientDataJSON.indexOf('"challenge":"');
  if (typeIndex < 0 || challengeIndex < 0) {
    throw new Error("Invalid WebAuthn clientDataJSON");
  }
  return encodeWebAuthnParts({
    r,
    s,
    challengeIndex,
    typeIndex,
    authenticatorData,
    clientDataJSON,
  });
}

const P256_N = BigInt("0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551");
const P256_HALF_N = BigInt("0x7fffffff800000007fffffffffffffffde737d56d38bcf4279dce5617e3192a8");

function encodeWebAuthnParts(parts: WebAuthnAssertionParts): string {
  const coder = AbiCoder.defaultAbiCoder();
  return coder.encode(
    ["bytes32", "bytes32", "uint256", "uint256", "bytes", "string"],
    [parts.r, parts.s, parts.challengeIndex, parts.typeIndex, parts.authenticatorData, parts.clientDataJSON]
  );
}

export function parseWebAuthnAssertion(response: AuthenticatorAssertionResponse): WebAuthnAssertionParts {
  const clientDataJSON = new TextDecoder().decode(response.clientDataJSON);
  const authenticatorData = hex(response.authenticatorData);
  const { r, s } = parseEs256Signature(response.signature);
  const typeIndex = clientDataJSON.indexOf('"type":"webauthn.get"');
  const challengeIndex = clientDataJSON.indexOf('"challenge":"');
  if (typeIndex < 0 || challengeIndex < 0) {
    throw new Error("Invalid WebAuthn clientDataJSON");
  }
  return { r, s, challengeIndex, typeIndex, authenticatorData, clientDataJSON };
}

function parseEs256Signature(signature: ArrayBuffer): { r: string; s: string } {
  const bytes = new Uint8Array(signature);
  if (bytes.length === 64) {
    return normalizeP256Signature(hex(bytes.slice(0, 32)), hex(bytes.slice(32, 64)));
  }
  // DER fallback
  let offset = 0;
  if (bytes[offset++] !== 0x30) throw new Error("Invalid DER signature");
  offset++; // total length
  if (bytes[offset++] !== 0x02) throw new Error("Invalid DER r");
  const rLen = bytes[offset++];
  const rBytes = bytes.slice(offset, offset + rLen);
  offset += rLen;
  if (bytes[offset++] !== 0x02) throw new Error("Invalid DER s");
  const sLen = bytes[offset++];
  const sBytes = bytes.slice(offset, offset + sLen);
  return normalizeP256Signature(hex32(pad32(rBytes)), hex32(pad32(sBytes)));
}

function normalizeP256Signature(r: string, s: string): { r: string; s: string } {
  const sValue = BigInt(s);
  if (sValue <= P256_HALF_N) return { r, s };
  return { r, s: hex32(bigIntToBytes32(P256_N - sValue)) };
}

function bigIntToBytes32(value: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let n = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

function pad32(bytes: Uint8Array): Uint8Array {
  if (bytes.length === 32) return bytes;
  if (bytes.length === 33 && bytes[0] === 0x00) return bytes.slice(1);
  const out = new Uint8Array(32);
  out.set(bytes, 32 - bytes.length);
  return out;
}

function hex32(bytes: Uint8Array): string {
  return "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function hex(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return "0x" + [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function decodeClientData(value: string): string {
  const t = value.trim();
  if (t.startsWith("{") && t.includes("challenge")) return t;
  return new TextDecoder().decode(decodeToBytes(value));
}

function decodeToHex(value: string): string {
  if (value.startsWith("0x")) return value.toLowerCase();
  return hex(decodeToBytes(value));
}

function decodeToBytes(value: string): Uint8Array {
  if (value.startsWith("0x")) {
    const h = value.slice(2);
    const out = new Uint8Array(h.length / 2);
    for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    return out;
  }
  const b64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
  return new Uint8Array(Buffer.from(b64 + pad, "base64"));
}
