import type { BrowserContext } from "@playwright/test";
import { getBytes } from "ethers";
import { encodeWebAuthnSignatureFromJson } from "../../../commerce/shared/webauthn-signature.js";
import { challengeToBase64Url } from "../../../commerce/shared/webauthn-verify.js";
import {
  createPasskeyFixture,
  signPasskeyAssertion,
  type PasskeyFixture,
} from "../../../test/helpers/passkey-fixture.js";

export type DeviceKeys = {
  current: PasskeyFixture | null;
  byCredentialId: Map<string, PasskeyFixture>;
};

export function emptyDeviceKeys(): DeviceKeys {
  return { current: null, byCredentialId: new Map() };
}

function fixtureToOwner(fixture: PasskeyFixture) {
  return {
    qx: fixture.qx,
    qy: fixture.qy,
    credentialId: fixture.credentialId,
    rawId: "0x" + Buffer.from(fixture.credentialId, "base64").toString("hex"),
  };
}

function lookup(keys: DeviceKeys, credentialId?: string): PasskeyFixture {
  if (credentialId?.trim()) {
    const match = keys.byCredentialId.get(credentialId);
    if (match) return match;
    for (const fixture of keys.byCredentialId.values()) {
      if (fixture.credentialId === credentialId) return fixture;
    }
  }
  if (keys.current) return keys.current;
  throw new Error("e2e webauthn: no fixture key for this browser context");
}

/**
 * One Playwright browser context = one device = one (or more) P-256 fixture keys.
 * Must run before the first navigation on the context.
 */
export async function installE2eWebAuthn(context: BrowserContext, keys: DeviceKeys): Promise<void> {
  await context.exposeFunction("tcE2eWebAuthnCreate", (_displayName: string) => {
    const fixture = createPasskeyFixture();
    keys.byCredentialId.set(fixture.credentialId, fixture);
    keys.current = fixture;
    return fixtureToOwner(fixture);
  });

  await context.exposeFunction("tcE2eWebAuthnAuthenticate", (input?: { credentialId?: string }) => {
    const fixture = lookup(keys, input?.credentialId);
    return { ...fixtureToOwner(fixture), fromRegistry: false };
  });

  await context.exposeFunction(
    "tcE2eWebAuthnSign",
    (input: { userOpHashHex: string; credentialId?: string; origin: string; rpId: string }) => {
      const fixture = lookup(keys, input.credentialId);
      const challenge = challengeToBase64Url(getBytes(input.userOpHashHex));
      const assertion = signPasskeyAssertion({
        privateKeyPem: fixture.privateKeyPem,
        challengeBase64Url: challenge,
        origin: input.origin,
        rpId: input.rpId,
      });
      return encodeWebAuthnSignatureFromJson(assertion);
    }
  );

  await context.exposeFunction(
    "tcE2eWebAuthnAssert",
    (input: { challengeBase64Url: string; credentialId?: string; origin: string; rpId: string }) => {
      const fixture = lookup(keys, input.credentialId);
      const assertion = signPasskeyAssertion({
        privateKeyPem: fixture.privateKeyPem,
        challengeBase64Url: input.challengeBase64Url,
        origin: input.origin,
        rpId: input.rpId,
      });
      return {
        credentialId: fixture.credentialId,
        assertion: {
          authenticatorData: Buffer.from(assertion.authenticatorData.slice(2), "hex").toString("base64"),
          clientDataJSON: Buffer.from(assertion.clientDataJSON, "utf8").toString("base64"),
          signature: Buffer.from(assertion.signature.slice(2), "hex").toString("base64"),
        },
      };
    }
  );

  await context.addInitScript(() => {
    const w = window as Window & {
      tcE2eWebAuthnCreate: (name: string) => Promise<unknown>;
      tcE2eWebAuthnAuthenticate: (input?: { credentialId?: string }) => Promise<unknown>;
      tcE2eWebAuthnSign: (input: {
        userOpHashHex: string;
        credentialId?: string;
        origin: string;
        rpId: string;
      }) => Promise<string>;
      tcE2eWebAuthnAssert: (input: {
        challengeBase64Url: string;
        credentialId?: string;
        origin: string;
        rpId: string;
      }) => Promise<unknown>;
      __TC_E2E_WEBAUTHN__?: unknown;
      open: typeof window.open;
    };
    w.__TC_E2E_WEBAUTHN__ = {
      createPasskey: (displayName: string) => w.tcE2eWebAuthnCreate(displayName),
      authenticatePasskey: (input?: { credentialId?: string }) => w.tcE2eWebAuthnAuthenticate(input),
      signUserOpHash: (userOpHashHex: string, credentialId?: string) =>
        w.tcE2eWebAuthnSign({
          userOpHashHex,
          credentialId,
          origin: window.location.origin,
          rpId: window.location.hostname,
        }),
      assertPasskeyChallenge: (input: { challengeBase64Url: string; credentialId?: string }) =>
        w.tcE2eWebAuthnAssert({
          ...input,
          origin: window.location.origin,
          rpId: window.location.hostname,
        }),
    };
    const nativeOpen = w.open.bind(w);
    w.open = (url?: string | URL, target?: string, features?: string) => {
      if (typeof url === "string" && url.includes("/pay")) {
        window.location.assign(url);
        return null;
      }
      return nativeOpen(url, target, features);
    };
  });
}
