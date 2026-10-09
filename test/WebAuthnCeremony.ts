import { createHash } from "node:crypto";
import { expect } from "chai";
import { challengeToBase64Url, verifyWebAuthnAssertion } from "../commerce/shared/webauthn-verify.js";
import {
  FACE_ID_ASSERTION_FLAGS,
  FACE_ID_REGISTRATION_FLAGS,
  SECURITY_KEY_ASSERTION_FLAGS,
  SECURITY_KEY_NO_UV_ASSERTION_FLAGS,
  SECURITY_KEY_NO_UV_REGISTRATION_FLAGS,
  SECURITY_KEY_REGISTRATION_FLAGS,
  backupFlagsConsistent,
  emptyCeremonyStore,
  performWebAuthnCeremony,
  type CeremonyRequest,
  type CeremonyResult,
  type CeremonySuccess,
} from "../ui/e2e/helpers/webauthn-ceremony.js";

const ORIGIN = "http://localhost:5173";
const ES256 = [{ alg: -7, type: "public-key" }];

function mustOk(result: CeremonyResult): CeremonySuccess {
  if (!result.ok) expect.fail(`${result.name}: ${result.message}`);
  return result;
}

function authData(result: CeremonySuccess): Buffer {
  return Buffer.from(result.authenticatorDataB64, "base64");
}

function challengeWithUrlChars(): Buffer {
  for (let lead = 0; lead < 256; lead++) {
    const bytes = Buffer.from([lead, 0xef, 0xff, 0xfb]);
    const standard = bytes.toString("base64");
    if (standard.includes("+") && standard.includes("/")) return bytes;
  }
  throw new Error("expected a challenge whose standard base64 contains + and /");
}

function request(over: Partial<CeremonyRequest> = {}): CeremonyRequest {
  return {
    op: "create",
    origin: ORIGIN,
    hostname: "localhost",
    rpId: "localhost",
    challengeB64: challengeWithUrlChars().toString("base64"),
    userVerification: "required",
    residentKey: "required",
    params: ES256,
    ...over,
  };
}

describe("WebAuthn ceremony", function () {
  it("creates a Face ID passkey and a security key with the flags a browser would return", function () {
    const store = emptyCeremonyStore();
    const face = mustOk(performWebAuthnCeremony(store, request()));
    const yubi = mustOk(
      performWebAuthnCeremony(store, request({ attachment: "cross-platform", requireResidentKey: true }))
    );
    expect(authData(face)[32]).to.equal(FACE_ID_REGISTRATION_FLAGS);
    expect(authData(yubi)[32]).to.equal(SECURITY_KEY_REGISTRATION_FLAGS);
    expect(backupFlagsConsistent(FACE_ID_ASSERTION_FLAGS)).to.equal(true);
    expect(backupFlagsConsistent(0x01 | 0x10)).to.equal(false);
    expect(face.attachment).to.equal("platform");
    expect(yubi.attachment).to.equal("cross-platform");
    expect(store.createCount).to.equal(2);

    const facePoint = Buffer.from(face.spkiB64, "base64").subarray(-65);
    expect(facePoint[0]).to.equal(0x04);
    expect(face.qx).to.equal("0x" + facePoint.subarray(1, 33).toString("hex"));
    expect(face.qy).to.equal("0x" + facePoint.subarray(33, 65).toString("hex"));
  });

  it("signs a Face ID assertion over the unpadded base64url challenge", function () {
    const store = emptyCeremonyStore();
    const challenge = challengeWithUrlChars();
    const created = mustOk(
      performWebAuthnCeremony(store, request({ challengeB64: challenge.toString("base64") }))
    );
    const assertion = mustOk(
      performWebAuthnCeremony(
        store,
        request({
          op: "get",
          challengeB64: challenge.toString("base64"),
          allow: [{ idB64: created.rawIdB64 }],
          hints: ["client-device"],
        })
      )
    );
    const challengeUrl = challengeToBase64Url(challenge);
    expect(challenge.toString("base64")).to.match(/[+/]/);
    expect(challengeUrl).to.not.match(/[+/]/);
    expect(challengeUrl.endsWith("=")).to.equal(false);
    expect(assertion.clientDataJSON).to.equal(
      JSON.stringify({
        type: "webauthn.get",
        challenge: challengeUrl,
        origin: ORIGIN,
        crossOrigin: false,
      })
    );
    expect(assertion.clientDataJSON.indexOf('"type":"webauthn.get"')).to.be.greaterThan(-1);
    expect(assertion.clientDataJSON.indexOf(`"challenge":"${challengeUrl}"`)).to.be.greaterThan(-1);
    expect(authData(assertion)[32]).to.equal(FACE_ID_ASSERTION_FLAGS);
    expect(authData(assertion).readUInt32BE(33)).to.equal(0);
    expect(authData(assertion).subarray(0, 32).equals(createHash("sha256").update("localhost").digest())).to.equal(
      true
    );
    expect(backupFlagsConsistent(authData(assertion)[32]!)).to.equal(true);
    verifyWebAuthnAssertion(
      {
        authenticatorData: "0x" + authData(assertion).toString("hex"),
        clientDataJSON: assertion.clientDataJSON,
        signature: "0x" + Buffer.from(assertion.signatureB64, "base64").toString("hex"),
      },
      {
        expectedChallengeBase64Url: challengeUrl,
        rpId: "localhost",
        origins: [ORIGIN],
        ownerQx: created.qx,
        ownerQy: created.qy,
      }
    );
    expect(store.signCount).to.equal(1);
  });

  it("keeps Face ID verified and backed up, and a discouraged security key unverified", function () {
    const store = emptyCeremonyStore();
    const face = mustOk(performWebAuthnCeremony(store, request({ userVerification: "discouraged" })));
    const yubi = mustOk(
      performWebAuthnCeremony(
        store,
        request({ attachment: "cross-platform", userVerification: "discouraged" })
      )
    );
    expect(authData(face)[32]).to.equal(FACE_ID_REGISTRATION_FLAGS);
    expect(authData(yubi)[32]).to.equal(SECURITY_KEY_NO_UV_REGISTRATION_FLAGS);
    const yubiAssertion = mustOk(
      performWebAuthnCeremony(
        store,
        request({
          op: "get",
          attachment: "cross-platform",
          userVerification: "discouraged",
          allow: [{ idB64: yubi.rawIdB64, transports: ["usb", "nfc", "ble"] }],
        })
      )
    );
    expect(authData(yubiAssertion)[32]).to.equal(SECURITY_KEY_NO_UV_ASSERTION_FLAGS);
    expect(authData(yubiAssertion).readUInt32BE(33)).to.equal(1);
    const again = mustOk(
      performWebAuthnCeremony(
        store,
        request({
          op: "get",
          userVerification: "required",
          allow: [{ idB64: yubi.rawIdB64, transports: ["usb"] }],
        })
      )
    );
    expect(authData(again)[32]).to.equal(SECURITY_KEY_ASSERTION_FLAGS);
    expect(authData(again).readUInt32BE(33)).to.equal(2);
  });

  it("offers Face ID and a security key the way the browser allow list does", function () {
    const store = emptyCeremonyStore();
    const firstFace = mustOk(performWebAuthnCeremony(store, request()));
    mustOk(performWebAuthnCeremony(store, request()));
    const latestFace = mustOk(performWebAuthnCeremony(store, request()));
    const yubi = mustOk(performWebAuthnCeremony(store, request({ attachment: "cross-platform" })));

    const securityHint = performWebAuthnCeremony(store, request({ op: "get", hints: ["security-key"], allow: [] }));
    const security = mustOk(securityHint);
    expect(security.rawIdB64).to.equal(yubi.rawIdB64);

    const severalFaces = performWebAuthnCeremony(store, request({ op: "get", hints: ["client-device"], allow: [] }));
    expect(severalFaces.ok).to.equal(false);
    if (!severalFaces.ok) expect(severalFaces.name).to.equal("NotAllowedError");

    const picked = mustOk(
      performWebAuthnCeremony(
        store,
        request({
          op: "get",
          hints: ["client-device"],
          allow: [],
          selectedIdB64: firstFace.rawIdB64,
        })
      )
    );
    expect(picked.rawIdB64).to.equal(firstFace.rawIdB64);
    expect(picked.rawIdB64).to.not.equal(latestFace.rawIdB64);

    const platformForSecurityKey = performWebAuthnCeremony(
      store,
      request({
        op: "get",
        hints: ["security-key"],
        allow: [{ idB64: firstFace.rawIdB64 }],
      })
    );
    expect(platformForSecurityKey.ok).to.equal(false);
    if (!platformForSecurityKey.ok) expect(platformForSecurityKey.name).to.equal("NotAllowedError");

    const byId = mustOk(
      performWebAuthnCeremony(
        store,
        request({
          op: "get",
          hints: ["client-device"],
          allow: [{ idB64: firstFace.rawIdB64 }],
        })
      )
    );
    expect(byId.rawIdB64).to.equal(firstFace.rawIdB64);

    const wrongTransport = performWebAuthnCeremony(
      store,
      request({
        op: "get",
        allow: [{ idB64: firstFace.rawIdB64, transports: ["usb", "nfc", "ble"] }],
      })
    );
    expect(wrongTransport.ok).to.equal(false);
    if (!wrongTransport.ok) expect(wrongTransport.name).to.equal("NotAllowedError");

    const missing = performWebAuthnCeremony(
      store,
      request({ op: "get", allow: [{ idB64: Buffer.alloc(16, 7).toString("base64") }] })
    );
    expect(missing.ok).to.equal(false);
    if (!missing.ok) expect(missing.name).to.equal("NotAllowedError");
  });

  it("rejects a foreign rpId and a credential already on that authenticator", function () {
    const store = emptyCeremonyStore();
    const foreign = performWebAuthnCeremony(store, request({ hostname: "localhost", rpId: "evil.example" }));
    expect(foreign.ok).to.equal(false);
    if (!foreign.ok) expect(foreign.name).to.equal("SecurityError");

    const suffix = mustOk(
      performWebAuthnCeremony(
        store,
        request({ hostname: "app.example.com", rpId: "example.com", origin: "https://app.example.com" })
      )
    );
    const blocked = performWebAuthnCeremony(
      store,
      request({
        hostname: "app.example.com",
        rpId: "example.com",
        origin: "https://app.example.com",
        exclude: [{ idB64: suffix.rawIdB64 }],
      })
    );
    expect(blocked.ok).to.equal(false);
    if (!blocked.ok) expect(blocked.name).to.equal("InvalidStateError");

    const otherAuthenticator = mustOk(
      performWebAuthnCeremony(
        store,
        request({
          hostname: "app.example.com",
          rpId: "example.com",
          origin: "https://app.example.com",
          attachment: "cross-platform",
          exclude: [{ idB64: suffix.rawIdB64 }],
        })
      )
    );
    expect(otherAuthenticator.attachment).to.equal("cross-platform");

    const unsupported = performWebAuthnCeremony(store, request({ params: [{ alg: -257, type: "public-key" }] }));
    expect(unsupported.ok).to.equal(false);
    if (!unsupported.ok) expect(unsupported.name).to.equal("NotSupportedError");
  });
});
