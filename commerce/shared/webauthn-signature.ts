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
    return {
      r: hex(bytes.slice(0, 32)),
      s: hex(bytes.slice(32, 64)),
    };
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
  return {
    r: hex32(pad32(rBytes)),
    s: hex32(pad32(sBytes)),
  };
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
