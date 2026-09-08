import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { zeroPadValue } from "ethers";

export type PasskeyFixture = {
  qx: string;
  qy: string;
  privateKeyPem: string;
  credentialId: string;
};

/** P-256 WebAuthn fixture used by Mocha wallet tests and Playwright local-stack e2e. */
export function createPasskeyFixture(): PasskeyFixture {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const point = spki.subarray(spki.length - 65);
  if (point[0] !== 0x04) throw new Error("expected uncompressed P-256 point");
  const qx = zeroPadValue("0x" + point.subarray(1, 33).toString("hex"), 32);
  const qy = zeroPadValue("0x" + point.subarray(33, 65).toString("hex"), 32);
  return {
    qx,
    qy,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    credentialId: Buffer.from("cred-" + qx.slice(2, 10)).toString("base64"),
  };
}

export function signPasskeyAssertion(input: {
  privateKeyPem: string;
  challengeBase64Url: string;
  origin: string;
  rpId: string;
}): { authenticatorData: string; clientDataJSON: string; signature: string } {
  const clientData = {
    type: "webauthn.get",
    challenge: input.challengeBase64Url,
    origin: input.origin,
    crossOrigin: false,
  };
  const clientDataJSON = JSON.stringify(clientData);
  const rpIdHash = createHash("sha256").update(input.rpId).digest();
  const authenticatorData = Buffer.concat([
    rpIdHash,
    Buffer.from([0x05]), // UP + UV
    Buffer.alloc(4),
  ]);
  const clientDataHash = createHash("sha256").update(clientDataJSON, "utf8").digest();
  const signed = Buffer.concat([authenticatorData, clientDataHash]);
  const signature = sign("sha256", signed, {
    key: createPrivateKey(input.privateKeyPem),
    dsaEncoding: "ieee-p1363",
  });
  return {
    authenticatorData: "0x" + authenticatorData.toString("hex"),
    clientDataJSON,
    signature: "0x" + signature.toString("hex"),
  };
}
