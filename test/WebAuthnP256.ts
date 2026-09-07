import { expect } from "chai";
import { AbiCoder, concat, getBytes, hexlify, sha256, toUtf8Bytes } from "ethers";
import {
  encodedWebAuthnMatchesPubkey,
  userOpHashToWebAuthnChallenge,
} from "../ui/src/shared/webauthn-p256.js";

const HASH = `0x${"ab".repeat(32)}`;

async function p256Pair(): Promise<{ privateKey: CryptoKey; qx: string; qy: string }> {
  const key = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key.publicKey));
  return { privateKey: key.privateKey, qx: hexlify(raw.slice(1, 33)), qy: hexlify(raw.slice(33, 65)) };
}

async function encodeAssertion(privateKey: CryptoKey, userOpHash: string): Promise<string> {
  const challenge = userOpHashToWebAuthnChallenge(userOpHash);
  const clientDataJSON = `{"type":"webauthn.get","challenge":"${challenge}","origin":"https://example.com"}`;
  const authenticatorData = new Uint8Array(37);
  authenticatorData[32] = 0x05;
  const clientDataHash = getBytes(sha256(toUtf8Bytes(clientDataJSON)));
  const signed = getBytes(concat([authenticatorData, clientDataHash]));
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, signed)
  );
  const coder = AbiCoder.defaultAbiCoder();
  return coder.encode(
    ["bytes32", "bytes32", "uint256", "uint256", "bytes", "string"],
    [hexlify(sig.slice(0, 32)), hexlify(sig.slice(32, 64)), 0, 0, hexlify(authenticatorData), clientDataJSON]
  );
}

describe("WebAuthn P-256 assertion match", function () {
  it("accepts the signing key and rejects another P-256 key", async function () {
    const a = await p256Pair();
    const b = await p256Pair();
    const encoded = await encodeAssertion(a.privateKey, HASH);
    expect(await encodedWebAuthnMatchesPubkey(encoded, a.qx, a.qy, HASH)).to.equal(true);
    expect(await encodedWebAuthnMatchesPubkey(encoded, b.qx, b.qy, HASH)).to.equal(false);
  });

  it("rejects a challenge mismatch", async function () {
    const a = await p256Pair();
    const encoded = await encodeAssertion(a.privateKey, HASH);
    const other = `0x${"cd".repeat(32)}`;
    expect(await encodedWebAuthnMatchesPubkey(encoded, a.qx, a.qy, other)).to.equal(false);
  });
});
