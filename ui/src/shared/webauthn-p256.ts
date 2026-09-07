import { AbiCoder, sha256, getBytes, concat, toUtf8Bytes } from "ethers";

const WEBAUTHN_AUTH_TYPES = ["bytes32", "bytes32", "uint256", "uint256", "bytes", "string"];

export type DecodedWebAuthnAuth = {
  r: string;
  s: string;
  authenticatorData: Uint8Array;
  clientDataJSON: string;
};

export function decodeWebAuthnAuth(encoded: string): DecodedWebAuthnAuth {
  const coder = AbiCoder.defaultAbiCoder();
  const [r, s, , , authenticatorData, clientDataJSON] = coder.decode(WEBAUTHN_AUTH_TYPES, encoded);
  return {
    r: String(r),
    s: String(s),
    authenticatorData: getBytes(authenticatorData as string),
    clientDataJSON: String(clientDataJSON),
  };
}

function coordsToUncompressed(qx: string, qy: string): Uint8Array {
  const x = getBytes(qx.startsWith("0x") ? qx : `0x${qx}`);
  const y = getBytes(qy.startsWith("0x") ? qy : `0x${qy}`);
  if (x.length !== 32 || y.length !== 32) {
    throw new Error("Invalid P-256 coordinates");
  }
  const out = new Uint8Array(65);
  out[0] = 0x04;
  out.set(x, 1);
  out.set(y, 33);
  return out;
}

/** SPKI (id-ecPublicKey + prime256v1 + uncompressed point). Some browsers reject raw P-256 import. */
function coordsToSpki(qx: string, qy: string): Uint8Array {
  const uncompressed = coordsToUncompressed(qx, qy);
  const prefix = Uint8Array.from([
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce,
    0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00,
  ]);
  const out = new Uint8Array(prefix.length + uncompressed.length);
  out.set(prefix, 0);
  out.set(uncompressed, prefix.length);
  return out;
}

async function importP256VerifyKey(qx: string, qy: string): Promise<CryptoKey> {
  const params = { name: "ECDSA", namedCurve: "P-256" } as const;
  try {
    return await crypto.subtle.importKey("raw", coordsToUncompressed(qx, qy), params, false, ["verify"]);
  } catch {
    return await crypto.subtle.importKey("spki", coordsToSpki(qx, qy), params, false, ["verify"]);
  }
}

function challengeToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function challengesEqual(a: string, b: string): boolean {
  const norm = (v: string) => v.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return norm(a) === norm(b);
}

function clientDataChallenge(clientDataJSON: string): string | null {
  try {
    const parsed = JSON.parse(clientDataJSON) as { challenge?: string; type?: string };
    if (parsed.type !== "webauthn.get") return null;
    return parsed.challenge ?? null;
  } catch {
    return null;
  }
}

export type P256Match = "yes" | "no" | "unavailable";

/**
 * Whether an OZ-encoded WebAuthn assertion was produced by this P-256 key
 * (and, when `challengeHex` is set, over that challenge).
 */
export async function encodedWebAuthnMatchesPubkey(
  encodedSig: string,
  qx: string,
  qy: string,
  challengeHex?: string
): Promise<boolean> {
  return (await encodedWebAuthnMatchResult(encodedSig, qx, qy, challengeHex)) === "yes";
}

export async function encodedWebAuthnMatchResult(
  encodedSig: string,
  qx: string,
  qy: string,
  challengeHex?: string
): Promise<P256Match> {
  if (!qx || !qy || /^0x0+$/i.test(qx)) return "no";
  let auth: DecodedWebAuthnAuth;
  try {
    auth = decodeWebAuthnAuth(encodedSig);
  } catch {
    return "no";
  }
  if (auth.authenticatorData.length < 37) return "no";
  const challenge = clientDataChallenge(auth.clientDataJSON);
  if (!challenge) return "no";
  if (challengeHex) {
    const expected = challengeToBase64Url(getBytes(challengeHex));
    if (!challengesEqual(challenge, expected)) return "no";
  }

  const clientDataHash = getBytes(sha256(toUtf8Bytes(auth.clientDataJSON)));
  const signed = getBytes(concat([auth.authenticatorData, clientDataHash]));
  const sig = getBytes(concat([getBytes(auth.r), getBytes(auth.s)]));

  try {
    const key = await importP256VerifyKey(qx, qy);
    return (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sig, signed)) ? "yes" : "no";
  } catch {
    return "unavailable";
  }
}

export function userOpHashToWebAuthnChallenge(userOpHashHex: string): string {
  return challengeToBase64Url(getBytes(userOpHashHex));
}
