import { expect } from "chai";
import { createServer, type Server } from "node:http";
import { ethers as ethersLib } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { clearLastDevOtp, getLastDevOtp } from "../commerce/server/email.js";
import { cookieHeaderFromResponse } from "../commerce/server/identity-session.js";
import { resetRateLimitBuckets } from "../commerce/server/rate-limit.js";
import { deriveIdentityWalletSalt, predictWalletAddress } from "../commerce/shared/wallet-address.js";
import { signIdentityVerifyEoa } from "../commerce/shared/identity-store.js";

const FACTORY = "0x805131afe47723819B7b81dA25256429d77aa12E";
const IMPL = "0x4D19ce70D3D4a63cBa685665B39C133141B5dDC2";
const QX = ethersLib.zeroPadValue("0x0a", 32);
const QY = ethersLib.zeroPadValue("0x0b", 32);

const BASE_ENV = {
  PORT: "0",
  ADMIN_API_KEY: "admin-identity-test",
  SWEEPER_API_KEY: "sweeper-identity-test",
  WALLET_FACTORY_ADDRESS: FACTORY,
  WALLET_IMPLEMENTATION_ADDRESS: IMPL,
  WALLET_RECOVERY_ADDRESS: "0xC68914FF4EE1d9A7f263ea550DAf6d89EB801D91",
  WALLET_RPC_URL: "",
  EVM_RPC_URL: "",
  TURNSTILE_SECRET: "",
  IDENTITY_SESSION_SECRET: "identity-session-test",
  RESEND_API_KEY: "",
} as const;

async function withApp(
  fn: (baseUrl: string) => Promise<void>,
  envOverrides: Record<string, string> = {}
): Promise<void> {
  resetRateLimitBuckets();
  clearLastDevOtp();
  const dir = await mkdtemp(join(tmpdir(), "commerce-identity-"));
  const config = loadConfig({
    ...process.env,
    ...BASE_ENV,
    ...envOverrides,
    DB_PATH: join(dir, "test.db"),
  } as NodeJS.ProcessEnv);
  const app = createApp(config);
  await new Promise<void>((resolve) => {
    app.server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = app.server.address();
  if (!address || typeof address === "string") throw new Error("expected TCP address");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function verifyOtp(baseUrl: string, email: string): Promise<{ cookie: string; identityId: string }> {
  const start = await fetch(`${baseUrl}/api/identity/email/start`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, captchaToken: "unused" }),
  });
  expect(start.status).to.equal(200);
  const otp = getLastDevOtp();
  expect(otp?.to).to.equal(email);
  expect(otp?.purpose).to.equal("login");
  const verify = await fetch(`${baseUrl}/api/identity/email/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, code: otp!.code }),
  });
  expect(verify.status).to.equal(200);
  const body = (await verify.json()) as { identityId: string };
  return { cookie: cookieHeaderFromResponse(verify), identityId: body.identityId };
}

function fakeIdToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

function listenTokenStub(idToken: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server: Server = createServer((req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id_token: idToken, access_token: "x", token_type: "Bearer" }));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") throw new Error("expected TCP address");
      resolve({
        url: `http://127.0.0.1:${addr.port}/token`,
        close: () =>
          new Promise((done, reject) => {
            server.close((err) => (err ? reject(err) : done()));
          }),
      });
    });
  });
}

describe("commerce identity API", function () {
  it("OTP start always returns ok and verify issues a session", async function () {
    await withApp(async (baseUrl) => {
      const unknown = await fetch(`${baseUrl}/api/identity/email/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.com" }),
      });
      expect(unknown.status).to.equal(200);
      expect(((await unknown.json()) as { ok: boolean }).ok).to.equal(true);

      const { cookie, identityId } = await verifyOtp(baseUrl, "ada@example.com");
      expect(identityId).to.match(/^0x[0-9a-f]{64}$/);
      const me = await fetch(`${baseUrl}/api/identity/me`, { headers: { cookie } });
      expect(me.status).to.equal(200);
      const meBody = (await me.json()) as { email: string; methods: { webauthn: number } };
      expect(meBody.email).to.equal("ada@example.com");
      expect(meBody.methods.webauthn).to.equal(0);
    });
  });

  it("email lookup reports whether an identity has a passkey", async function () {
    await withApp(async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/identity/email/lookup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.com" }),
      });
      expect(missing.status).to.equal(200);
      expect(((await missing.json()) as { exists: boolean }).exists).to.equal(false);

      const { cookie } = await verifyOtp(baseUrl, "ada@example.com");
      const beforePasskey = await fetch(`${baseUrl}/api/identity/email/lookup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com" }),
      });
      const beforeBody = (await beforePasskey.json()) as { exists: boolean; identityId?: string };
      expect(beforeBody.exists).to.equal(false);
      expect(beforeBody.identityId).to.equal(undefined);

      await fetch(`${baseUrl}/api/identity/passkey/register`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ qx: QX, qy: QY, credentialId: "cred-lookup" }),
      });
      const after = await fetch(`${baseUrl}/api/identity/email/lookup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com" }),
      });
      const body = (await after.json()) as { exists: boolean; identityId?: string; options: { tryWebAuthn: boolean } };
      expect(body.exists).to.equal(true);
      expect(body.identityId).to.match(/^0x[0-9a-f]{64}$/);
      expect(body.options.tryWebAuthn).to.equal(true);
    });
  });

  it("OTP start requires captcha when TURNSTILE_SECRET is set", async function () {
    await withApp(
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/identity/email/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "ada@example.com" }),
        });
        expect(res.status).to.equal(400);
        const ok = await fetch(`${baseUrl}/api/identity/email/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "ada@example.com", captchaToken: "test-pass" }),
        });
        expect(ok.status).to.equal(200);
        const otp = getLastDevOtp();
        expect(otp?.code).to.match(/^\d{6}$/);
        const verify = await fetch(`${baseUrl}/api/identity/email/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "ada@example.com", code: otp!.code }),
        });
        expect(verify.status).to.equal(200);
      },
      { TURNSTILE_SECRET: "test-secret" }
    );
  });

  it("dev-otp is available when IDENTITY_DEV_OTP is set even if Resend is configured", async function () {
    await withApp(
      async (baseUrl) => {
        const start = await fetch(`${baseUrl}/api/identity/email/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "ada@example.com" }),
        });
        expect(start.status).to.equal(200);
        const otp = getLastDevOtp();
        expect(otp?.code).to.match(/^\d{6}$/);
        const res = await fetch(`${baseUrl}/api/identity/email/dev-otp`);
        expect(res.status).to.equal(200);
        const body = (await res.json()) as { to: string; code: string };
        expect(body.to).to.equal("ada@example.com");
        expect(body.code).to.equal(otp!.code);
      },
      { IDENTITY_DEV_OTP: "1", RESEND_API_KEY: "re_test_invalid" }
    );
  });

  it("Google start without client id redirects to wallet", async function () {
    await withApp(
      async (baseUrl) => {
        const start = await fetch(`${baseUrl}/api/identity/google/start`, { redirect: "manual" });
        expect(start.status).to.equal(302);
        expect(start.headers.get("location")).to.equal("/wallet?google=unavailable");
      },
      { GOOGLE_CLIENT_ID: "" }
    );
  });

  it("Google callback binds identity, sets session, and redirects", async function () {
    const idToken = fakeIdToken({
      sub: "google-sub-1",
      email: "google-user@example.com",
      email_verified: true,
    });
    const stub = await listenTokenStub(idToken);
    try {
      await withApp(
        async (baseUrl) => {
          const start = await fetch(`${baseUrl}/api/identity/google/start`, { redirect: "manual" });
          expect(start.status).to.equal(302);
          const loc = start.headers.get("location") ?? "";
          expect(loc).to.include("accounts.google.test");
          const state = new URL(loc).searchParams.get("state");
          expect(state).to.be.a("string");
          const cookie = cookieHeaderFromResponse(start);
          const cb = await fetch(
            `${baseUrl}/api/identity/google/callback?code=abc&state=${encodeURIComponent(state!)}`,
            { headers: { cookie }, redirect: "manual" }
          );
          expect(cb.status).to.equal(302);
          expect(cb.headers.get("location")).to.equal("/wallet");
          const sessionCookie = cookieHeaderFromResponse(cb);
          const me = await fetch(`${baseUrl}/api/identity/me`, { headers: { cookie: sessionCookie } });
          expect(me.status).to.equal(200);
          const body = (await me.json()) as { email: string };
          expect(body.email).to.equal("google-user@example.com");
        },
        {
          GOOGLE_CLIENT_ID: "cid",
          GOOGLE_CLIENT_SECRET: "csecret",
          GOOGLE_AUTH_URL: "https://accounts.google.test/o/oauth2/v2/auth",
          GOOGLE_TOKEN_URL: stub.url,
          GOOGLE_SKIP_ID_TOKEN_VERIFY: "1",
        }
      );
    } finally {
      await stub.close();
    }
  });

  it("existing email cannot register a second passkey identity", async function () {
    await withApp(async (baseUrl) => {
      const { cookie } = await verifyOtp(baseUrl, "ada@example.com");
      const first = await fetch(`${baseUrl}/api/identity/passkey/register`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ qx: QX, qy: QY, credentialId: "cred-ada-1" }),
      });
      expect(first.status).to.equal(201);
      const again = await fetch(`${baseUrl}/api/identity/passkey/register`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          qx: ethersLib.zeroPadValue("0x11", 32),
          qy: ethersLib.zeroPadValue("0x12", 32),
          credentialId: "cred-ada-2",
        }),
      });
      expect(again.status).to.equal(409);
      const body = (await again.json()) as { error?: string };
      expect(body.error).to.equal("identity_exists");
    });
  });

  it("passkey login maps credential to wallets", async function () {
    await withApp(async (baseUrl) => {
      const { cookie, identityId } = await verifyOtp(baseUrl, "ada@example.com");
      const reg = await fetch(`${baseUrl}/api/identity/passkey/register`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ qx: QX, qy: QY, credentialId: "cred-login" }),
      });
      expect(reg.status).to.equal(201);
      const salt = deriveIdentityWalletSalt(identityId, 0);
      const expected = predictWalletAddress(FACTORY, IMPL, salt).toLowerCase();
      const login = await fetch(`${baseUrl}/api/identity/passkey/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialId: "cred-login" }),
      });
      expect(login.status).to.equal(200);
      const body = (await login.json()) as {
        identityId: string;
        email?: string;
        wallets: { address: string }[];
      };
      expect(body.identityId).to.equal(identityId);
      expect(body.email).to.equal("ada@example.com");
      expect(body.wallets[0]?.address).to.equal(expected);

      const loginCookie = cookieHeaderFromResponse(login);
      const me = await fetch(`${baseUrl}/api/identity/me`, { headers: { cookie: loginCookie } });
      expect(me.status).to.equal(200);

      const listed = await fetch(`${baseUrl}/api/identity/wallets`, { headers: { cookie: loginCookie } });
      expect(listed.status).to.equal(200);

      const extra = await fetch(`${baseUrl}/api/identity/wallets`, {
        method: "POST",
        headers: { cookie: loginCookie },
      });
      expect(extra.status).to.equal(201);
    });
  });

  it("creates an extra wallet for the same identity without a new passkey", async function () {
    await withApp(async (baseUrl) => {
      const { cookie, identityId } = await verifyOtp(baseUrl, "ada@example.com");
      await fetch(`${baseUrl}/api/identity/passkey/register`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ qx: QX, qy: QY, credentialId: "cred-extra" }),
      });
      const extra = await fetch(`${baseUrl}/api/identity/wallets`, {
        method: "POST",
        headers: { cookie },
      });
      expect(extra.status).to.equal(201);
      const extraBody = (await extra.json()) as { account: { address: string; identityId: string; salt: string } };
      expect(extraBody.account.identityId).to.equal(identityId);
      const listed = await fetch(`${baseUrl}/api/identity/wallets`, { headers: { cookie } });
      const listedBody = (await listed.json()) as { wallets: { address: string }[] };
      expect(listedBody.wallets).to.have.length(2);
      expect(listedBody.wallets.map((w) => w.address.toLowerCase())).to.include(extraBody.account.address.toLowerCase());

      const byCred = await fetch(`${baseUrl}/api/identity/wallets`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialId: "cred-extra" }),
      });
      expect(byCred.status).to.equal(201);

      const named = await fetch(`${baseUrl}/api/identity/wallets`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ label: "Operations" }),
      });
      expect(named.status).to.equal(201);
      const namedBody = (await named.json()) as { account: { label?: string | null } };
      expect(namedBody.account.label).to.equal("Operations");

      const renamed = await fetch(`${baseUrl}/api/identity/wallets`, {
        method: "PATCH",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ address: extraBody.account.address, label: "Treasury" }),
      });
      expect(renamed.status).to.equal(200);
      const renamedBody = (await renamed.json()) as { account: { label?: string | null } };
      expect(renamedBody.account.label).to.equal("Treasury");
    });
  });

  it("pair addMethod records a second webauthn method", async function () {
    await withApp(async (baseUrl) => {
      const { cookie } = await verifyOtp(baseUrl, "ada@example.com");
      await fetch(`${baseUrl}/api/identity/passkey/register`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ qx: QX, qy: QY, credentialId: "cred-primary" }),
      });
      const pair = await fetch(`${baseUrl}/api/identity/methods`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          kind: "webauthn",
          qx: ethersLib.zeroPadValue("0x21", 32),
          qy: ethersLib.zeroPadValue("0x22", 32),
          credentialId: "cred-paired",
        }),
      });
      expect(pair.status).to.equal(201);
      const me = await fetch(`${baseUrl}/api/identity/me`, { headers: { cookie } });
      const body = (await me.json()) as { methods: { webauthn: number } };
      expect(body.methods.webauthn).to.equal(2);
      const login = await fetch(`${baseUrl}/api/identity/passkey/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          credentialId: "missing-cred",
          qx: ethersLib.zeroPadValue("0x21", 32),
          qy: ethersLib.zeroPadValue("0x22", 32),
        }),
      });
      expect(login.status).to.equal(200);
      const removed = await fetch(`${baseUrl}/api/identity/methods`, {
        method: "DELETE",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          qx: ethersLib.zeroPadValue("0x21", 32),
          qy: ethersLib.zeroPadValue("0x22", 32),
          credentialId: "cred-paired",
        }),
      });
      expect(removed.status).to.equal(200);
      const after = await fetch(`${baseUrl}/api/identity/me`, { headers: { cookie } });
      expect(((await after.json()) as { methods: { webauthn: number } }).methods.webauthn).to.equal(1);
      const last = await fetch(`${baseUrl}/api/identity/methods`, {
        method: "DELETE",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ credentialId: "cred-primary" }),
      });
      expect(last.status).to.equal(400);
      expect(((await last.json()) as { error: string }).error).to.equal("last_method");
    });
  });

  it("pair addMethod accepts provingCredentialId without a session cookie", async function () {
    await withApp(async (baseUrl) => {
      const { cookie } = await verifyOtp(baseUrl, "ada@example.com");
      await fetch(`${baseUrl}/api/identity/passkey/register`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ qx: QX, qy: QY, credentialId: "cred-primary" }),
      });
      const pair = await fetch(`${baseUrl}/api/identity/methods`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "webauthn",
          qx: ethersLib.zeroPadValue("0x31", 32),
          qy: ethersLib.zeroPadValue("0x32", 32),
          credentialId: "cred-paired-no-cookie",
          provingCredentialId: "cred-primary",
        }),
      });
      expect(pair.status).to.equal(201);
      const ready = await fetch(`${baseUrl}/api/identity/pair/ready?credentialId=cred-paired-no-cookie`);
      expect(((await ready.json()) as { ready: boolean }).ready).to.equal(true);
    });
  });

  it("pair/ready reports whether a credential is an identity method", async function () {
    await withApp(async (baseUrl) => {
      const missing = await fetch(`${baseUrl}/api/identity/pair/ready`);
      expect(missing.status).to.equal(400);
      const unknown = await fetch(`${baseUrl}/api/identity/pair/ready?credentialId=cred-paired`);
      expect(unknown.status).to.equal(200);
      expect(((await unknown.json()) as { ready: boolean }).ready).to.equal(false);

      const { cookie } = await verifyOtp(baseUrl, "ada@example.com");
      await fetch(`${baseUrl}/api/identity/passkey/register`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ qx: QX, qy: QY, credentialId: "cred-primary" }),
      });
      const before = await fetch(`${baseUrl}/api/identity/pair/ready?credentialId=cred-paired`);
      expect(((await before.json()) as { ready: boolean }).ready).to.equal(false);
      await fetch(`${baseUrl}/api/identity/methods`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({
          kind: "webauthn",
          qx: ethersLib.zeroPadValue("0x21", 32),
          qy: ethersLib.zeroPadValue("0x22", 32),
          credentialId: "cred-paired",
        }),
      });
      const ready = await fetch(`${baseUrl}/api/identity/pair/ready?credentialId=cred-paired`);
      expect(ready.status).to.equal(200);
      expect(((await ready.json()) as { ready: boolean }).ready).to.equal(true);
      const byKey = await fetch(`${baseUrl}/api/identity/pair/ready`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          qx: ethersLib.zeroPadValue("0x21", 32),
          qy: ethersLib.zeroPadValue("0x22", 32),
        }),
      });
      expect(((await byKey.json()) as { ready: boolean }).ready).to.equal(true);
      const plusId = await fetch(`${baseUrl}/api/identity/pair/ready`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialId: "ab+cd/ef==" }),
      });
      expect(plusId.status).to.equal(200);
      expect(((await plusId.json()) as { ready: boolean }).ready).to.equal(false);
    });
  });

  it("parses pairing JSON and ?pair= URLs", async function () {
    const { encodeIdentityPairLink, parseIdentityPairPayload } = await import(
      "../commerce/shared/identity-pair.js"
    );
    const payload = {
      v: 2 as const,
      identityId: "0x" + "11".repeat(32),
      qx: QX,
      qy: QY,
      credentialId: "cred-paired",
    };
    expect(parseIdentityPairPayload(JSON.stringify(payload))).to.deep.equal(payload);
    const link = encodeIdentityPairLink("http://127.0.0.1:5173", payload);
    expect(link).to.match(/\/wallet\/security\?pair=/);
    expect(parseIdentityPairPayload(link)).to.deep.equal(payload);
    expect(parseIdentityPairPayload(`/wallet/security?pair=${link.split("pair=")[1]}`)).to.deep.equal(
      payload
    );
  });

  it("logout clears the identity cookie", async function () {
    await withApp(async (baseUrl) => {
      const { cookie } = await verifyOtp(baseUrl, "ada@example.com");
      const out = await fetch(`${baseUrl}/api/identity/logout`, {
        method: "POST",
        headers: { cookie },
      });
      expect(out.status).to.equal(200);
      const cleared = cookieHeaderFromResponse(out);
      expect(cleared).to.include("tc_identity=");
      const me = await fetch(`${baseUrl}/api/identity/me`, { headers: { cookie: cleared } });
      expect(me.status).to.equal(401);
    });
  });

  it("retires public POST /api/wallet/accounts qx/qy", async function () {
    await withApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/wallet/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ownerQx: QX, ownerQy: QY, credentialId: "x" }),
      });
      expect(res.status).to.equal(410);
    });
  });

  it("recovers with a YubiKey method without an identity login cookie", async function () {
    await withApp(async (baseUrl) => {
      const { cookie } = await verifyOtp(baseUrl, "ada@example.com");
      await fetch(`${baseUrl}/api/identity/passkey/register`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ qx: QX, qy: QY, credentialId: "cred-platform" }),
      });
      const yubiQx = ethersLib.zeroPadValue("0x0c", 32);
      const yubiQy = ethersLib.zeroPadValue("0x0d", 32);
      const added = await fetch(`${baseUrl}/api/identity/methods`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ kind: "yubikey", qx: yubiQx, qy: yubiQy, credentialId: "cred-yubi" }),
      });
      expect(added.status).to.equal(201);

      const allow = await fetch(`${baseUrl}/api/identity/recover/security-keys`);
      expect(allow.status).to.equal(200);
      const allowBody = (await allow.json()) as { credentialIds: string[] };
      expect(allowBody.credentialIds).to.include("cred-yubi");

      const prove = await fetch(`${baseUrl}/api/identity/recover/prove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "yubikey", credentialId: "cred-yubi" }),
      });
      expect(prove.status).to.equal(200);
      const proved = (await prove.json()) as { email: string; restoreEnabled: boolean; wallets: { address: string }[] };
      expect(proved.email).to.equal("ada@example.com");
      expect(proved.restoreEnabled).to.equal(true);
      expect(proved.wallets).to.have.length.greaterThan(0);
      const recoverCookie = cookieHeaderFromResponse(prove);

      const extraQx = ethersLib.zeroPadValue("0x11", 32);
      const extraQy = ethersLib.zeroPadValue("0x12", 32);
      const addedMethod = await fetch(`${baseUrl}/api/identity/recover/add-method`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: recoverCookie },
        body: JSON.stringify({
          pay: "recorded",
          qx: extraQx,
          qy: extraQy,
          credentialId: "cred-recovered",
        }),
      });
      expect(addedMethod.status).to.equal(201);

      const login = await fetch(`${baseUrl}/api/identity/passkey/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ credentialId: "cred-recovered" }),
      });
      expect(login.status).to.equal(200);
    });
  });

  it("looks up an identity EOA and rejects recover add-method without a session", async function () {
    await withApp(async (baseUrl) => {
      const { cookie } = await verifyOtp(baseUrl, "ada@example.com");
      await fetch(`${baseUrl}/api/identity/passkey/register`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ qx: QX, qy: QY, credentialId: "cred-eoa-owner" }),
      });
      const eoa = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const added = await fetch(`${baseUrl}/api/identity/methods`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie },
        body: JSON.stringify({ kind: "eoa", eoa }),
      });
      expect(added.status).to.equal(201);

      const missing = await fetch(`${baseUrl}/api/identity/recover/add-method`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          pay: "relayer",
          qx: ethersLib.zeroPadValue("0x21", 32),
          qy: ethersLib.zeroPadValue("0x22", 32),
          credentialId: "cred-no-session",
        }),
      });
      expect(missing.status).to.equal(401);

      const unknown = await fetch(`${baseUrl}/api/identity/recover/prove`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "yubikey", credentialId: "no-such-key" }),
      });
      expect(unknown.status).to.equal(404);
    });
  });

  it("proves an identity EOA with Verify(bytes32) and issues a recover session", async function () {
    const store = "0x1111111111111111111111111111111111111111";
    const eoaWallet = new ethersLib.Wallet("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
    await withApp(
      async (baseUrl) => {
        const { cookie } = await verifyOtp(baseUrl, "ada@example.com");
        await fetch(`${baseUrl}/api/identity/passkey/register`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ qx: QX, qy: QY, credentialId: "cred-eoa-prove" }),
        });
        const added = await fetch(`${baseUrl}/api/identity/methods`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ kind: "eoa", eoa: eoaWallet.address }),
        });
        expect(added.status).to.equal(201);

        const challengeRes = await fetch(`${baseUrl}/api/identity/recover/challenge`);
        expect(challengeRes.status).to.equal(200);
        const { challenge } = (await challengeRes.json()) as { challenge: string };
        const signature = await signIdentityVerifyEoa(eoaWallet.privateKey, store, 11155111n, challenge);
        const prove = await fetch(`${baseUrl}/api/identity/recover/prove`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "eoa",
            eoa: eoaWallet.address,
            signature,
            challenge,
          }),
        });
        expect(prove.status).to.equal(200);
        const proved = (await prove.json()) as { email: string; provingMethod: { kind: string; eoa: string } };
        expect(proved.email).to.equal("ada@example.com");
        expect(proved.provingMethod.kind).to.equal("eoa");
        expect(proved.provingMethod.eoa?.toLowerCase()).to.equal(eoaWallet.address.toLowerCase());
      },
      { IDENTITY_STORE_ADDRESS: store }
    );
  });

  it("rejects hosted email recovery when restore is disabled", async function () {
    await withApp(
      async (baseUrl) => {
        const { cookie } = await verifyOtp(baseUrl, "ada@example.com");
        await fetch(`${baseUrl}/api/identity/passkey/register`, {
          method: "POST",
          headers: { "content-type": "application/json", cookie },
          body: JSON.stringify({ qx: QX, qy: QY, credentialId: "cred-restore-off" }),
        });
        const start = await fetch(`${baseUrl}/api/wallet/recovery/email/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "ada@example.com" }),
        });
        expect(start.status).to.equal(403);
        expect(((await start.json()) as { error: string }).error).to.equal("restore_disabled");
      },
      { IDENTITY_RESTORE_ENABLED: "0" }
    );
  });
});
