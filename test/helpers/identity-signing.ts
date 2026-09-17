import { createHash, createPrivateKey, generateKeyPairSync, sign as nodeSign } from "node:crypto";
import { ZeroAddress, zeroPadValue } from "ethers";
import { encodeWebAuthnSignatureFromJson } from "../../commerce/shared/webauthn-signature.js";
import { userOpHashToWebAuthnChallenge } from "../../ui/src/shared/webauthn-p256.js";
import {
  METHOD_EOA,
  METHOD_WEBAUTHN,
  METHOD_YUBIKEY,
  computeIdentityMethodId,
  encodeIdentityBlob,
  encodeSuperIdentityBlobs,
  signIdentityVerifyEoa,
} from "../../commerce/shared/identity-store.js";

export type SimulatedPasskey = {
  qx: string;
  qy: string;
  pem: string;
};

export function simulatePasskey(): SimulatedPasskey {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const point = spki.subarray(spki.length - 65);
  if (point[0] !== 0x04) throw new Error("expected uncompressed P-256 point");
  return {
    qx: zeroPadValue("0x" + point.subarray(1, 33).toString("hex"), 32),
    qy: zeroPadValue("0x" + point.subarray(33, 65).toString("hex"), 32),
    pem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
  };
}

export function signWebAuthnChallenge(pem: string, message: string, rpId = "localhost"): string {
  const challenge = userOpHashToWebAuthnChallenge(message);
  const clientDataJSON = JSON.stringify({
    type: "webauthn.get",
    challenge,
    origin: "http://localhost",
    crossOrigin: false,
  });
  const authenticatorData = Buffer.concat([
    createHash("sha256").update(rpId).digest(),
    Buffer.from([0x05]),
    Buffer.alloc(4),
  ]);
  const signed = Buffer.concat([
    authenticatorData,
    createHash("sha256").update(clientDataJSON, "utf8").digest(),
  ]);
  const signature = nodeSign("sha256", signed, {
    key: createPrivateKey(pem),
    dsaEncoding: "ieee-p1363",
  });
  return encodeWebAuthnSignatureFromJson({
    authenticatorData: "0x" + authenticatorData.toString("hex"),
    clientDataJSON,
    signature: "0x" + signature.toString("hex"),
  });
}

export function identityPasskeyBlob(input: {
  identityId: string;
  kind?: number;
  key: SimulatedPasskey;
  message: string;
}): string {
  const kind = input.kind ?? METHOD_WEBAUTHN;
  const methodId = computeIdentityMethodId(input.identityId, kind, input.key.qx, input.key.qy, ZeroAddress);
  return encodeIdentityBlob({
    kind,
    identityId: input.identityId,
    methodId,
    inner: signWebAuthnChallenge(input.key.pem, input.message),
  });
}

export async function identityEoaBlob(input: {
  identityId: string;
  eoa: string;
  privateKey: string;
  store: string;
  chainId: bigint;
  message: string;
}): Promise<string> {
  const methodId = computeIdentityMethodId(input.identityId, METHOD_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), input.eoa);
  return encodeIdentityBlob({
    kind: METHOD_EOA,
    identityId: input.identityId,
    methodId,
    inner: await signIdentityVerifyEoa(input.privateKey, input.store, input.chainId, input.message),
  });
}

export function yubikeyBlob(identityId: string, key: SimulatedPasskey, message: string): string {
  return identityPasskeyBlob({ identityId, kind: METHOD_YUBIKEY, key, message });
}

export { METHOD_EOA, METHOD_WEBAUTHN, METHOD_YUBIKEY, encodeSuperIdentityBlobs };
