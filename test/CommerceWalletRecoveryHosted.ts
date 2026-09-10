import { expect } from "chai";
import { Wallet } from "ethers";
import { createPasskeyFixture, signPasskeyAssertion, type PasskeyFixture } from "./helpers/passkey-fixture.js";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { resetRateLimitBuckets } from "../commerce/server/rate-limit.js";
import { clearLastDevNotify, clearLastDevOtp, getLastDevNotify, getLastDevOtp } from "../commerce/server/email.js";
import { deriveWalletSalt, predictWalletAddress } from "../commerce/shared/wallet-address.js";
import { guardianLoginMessage } from "../commerce/server/wallet-hosted-recovery.js";
import { recoveryNewOwnerMessage } from "../commerce/shared/wallet.js";
import { signEoaRecover } from "../commerce/shared/wallet-eip712.js";

const FACTORY = "0x06964dE197ed29A4DC2D34F68aD4510Afa25f537";
const IMPL = "0xe024cE8ed1878dBdd3ca8E73B1e586c4E46dC85C";
const GUARDIAN = Wallet.createRandom();

const BASE_ENV = {
  PORT: "0",
  BASE_URL: "http://localhost",
  ADMIN_API_KEY: "admin-hosted-recovery-test",
  SWEEPER_API_KEY: "sweeper-hosted-recovery-test",
  WALLET_FACTORY_ADDRESS: FACTORY,
  WALLET_IMPLEMENTATION_ADDRESS: IMPL,
  WALLET_RECOVERY_ADDRESS: "0x72739889bcce2B08a23212bae6C7B9F1C29e7873",
  WALLET_ADMIN_GUARDIAN: GUARDIAN.address,
  WALLET_RPC_URL: "",
  EVM_RPC_URL: "",
  WALLET_BUNDLER_BENEFICIARY: "0x1111111111111111111111111111111111111111",
  WALLET_BUNDLER_FEE_TOKEN: "0x2222222222222222222222222222222222222222",
  WALLET_BUNDLER_FEE_USDC: "100000",
  TURNSTILE_SECRET: "",
  TURNSTILE_SITE_KEY: "",
  RESEND_API_KEY: "",
  WALLET_RECOVERY_NOTIFY_EMAIL: "ops@example.com",
  RATE_LIMIT_PUBLIC_PER_SECOND: "100",
  RATE_LIMIT_CREATE_PER_SECOND: "100",
} as const;

async function withApp(
  fn: (baseUrl: string, app: ReturnType<typeof createApp>) => Promise<void>,
  envOverrides: Record<string, string> = {}
): Promise<void> {
  resetRateLimitBuckets();
  clearLastDevOtp();
  clearLastDevNotify();
  const dir = await mkdtemp(join(tmpdir(), "commerce-hosted-recovery-"));
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
    await fn(baseUrl, app);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const signAssertion = signPasskeyAssertion;

async function registerWallet(
  baseUrl: string,
  pk: PasskeyFixture,
  captchaToken?: string
): Promise<string> {
  const salt = deriveWalletSalt(pk.qx, pk.qy);
  const address = predictWalletAddress(FACTORY, IMPL, salt);
  const res = await fetch(`${baseUrl}/api/wallet/accounts`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      address,
      salt,
      ownerQx: pk.qx,
      ownerQy: pk.qy,
      credentialId: pk.credentialId,
      ...(captchaToken ? { captchaToken } : {}),
    }),
  });
  expect(res.status).to.equal(201);
  await fetch(`${baseUrl}/api/wallet/devices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      walletAddress: address,
      chainId: "11155111",
      ownerQx: pk.qx,
      ownerQy: pk.qy,
      label: "Primary",
      credentialId: pk.credentialId,
    }),
  });
  return address;
}

async function attachVerifiedEmail(
  baseUrl: string,
  pk: PasskeyFixture,
  wallet: string,
  email: string
): Promise<void> {
  const ch = await (
    await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ purpose: "attach", walletAddress: wallet }),
    })
  ).json() as { challengeId: string; challenge: string };
  await fetch(`${baseUrl}/api/wallet/email`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      walletAddress: wallet,
      email,
      challengeId: ch.challengeId,
      ownerQx: pk.qx,
      ownerQy: pk.qy,
      assertion: signAssertion({
        privateKeyPem: pk.privateKeyPem,
        challengeBase64Url: ch.challenge,
        origin: "http://localhost",
        rpId: "localhost",
      }),
    }),
  });
  await fetch(`${baseUrl}/api/wallet/email/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      walletAddress: wallet,
      email,
      code: getLastDevOtp()!.code,
    }),
  });
}

describe("commerce hosted wallet recovery", function () {
  it("attaches email with passkey + OTP (dev mail)", async function () {
    await withApp(async (baseUrl) => {
      const pk = createPasskeyFixture();
      const wallet = await registerWallet(baseUrl, pk);

      const ch = await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "attach", walletAddress: wallet }),
      });
      expect(ch.status).to.equal(201);
      const chBody = (await ch.json()) as { challengeId: string; challenge: string };

      const attach = await fetch(`${baseUrl}/api/wallet/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          email: "owner@example.com",
          challengeId: chBody.challengeId,
          ownerQx: pk.qx,
          ownerQy: pk.qy,
          assertion: signAssertion({
            privateKeyPem: pk.privateKeyPem,
            challengeBase64Url: chBody.challenge,
            origin: "http://localhost",
            rpId: "localhost",
          }),
        }),
      });
      expect(attach.status).to.equal(200);
      const otp = getLastDevOtp();
      expect(otp?.code).to.match(/^\d{6}$/);
      expect(otp?.to).to.equal("owner@example.com");

      const verify = await fetch(`${baseUrl}/api/wallet/email/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          email: "owner@example.com",
          code: otp!.code,
        }),
      });
      expect(verify.status).to.equal(200);

      const getEmail = await fetch(`${baseUrl}/api/wallet/email?wallet=${wallet}`);
      const emailBody = (await getEmail.json()) as { verified: boolean; email: string };
      expect(emailBody.verified).to.equal(true);
      expect(emailBody.email).to.include("***@");
    });
  });

  it("creates recovery request → OTP → awaiting_guardian; guardian approve/reject", async function () {
    await withApp(async (baseUrl) => {
      const owner = createPasskeyFixture();
      const wallet = await registerWallet(baseUrl, owner);

      // Attach + verify email first
      const chAttach = await (
        await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "attach", walletAddress: wallet }),
        })
      ).json() as { challengeId: string; challenge: string };
      await fetch(`${baseUrl}/api/wallet/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          email: "recover@example.com",
          challengeId: chAttach.challengeId,
          ownerQx: owner.qx,
          ownerQy: owner.qy,
          assertion: signAssertion({
            privateKeyPem: owner.privateKeyPem,
            challengeBase64Url: chAttach.challenge,
            origin: "http://localhost",
            rpId: "localhost",
          }),
        }),
      });
      await fetch(`${baseUrl}/api/wallet/email/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          email: "recover@example.com",
          code: getLastDevOtp()!.code,
        }),
      });

      const newDevice = createPasskeyFixture();
      const chRec = await (
        await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "recover", walletAddress: wallet }),
        })
      ).json() as { challengeId: string; challenge: string };

      const create = await fetch(`${baseUrl}/api/wallet/recovery/requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          challengeId: chRec.challengeId,
          ownerQx: newDevice.qx,
          ownerQy: newDevice.qy,
          credentialId: newDevice.credentialId,
          label: "New phone",
          assertion: signAssertion({
            privateKeyPem: newDevice.privateKeyPem,
            challengeBase64Url: chRec.challenge,
            origin: "http://localhost",
            rpId: "localhost",
          }),
        }),
      });
      expect(create.status).to.equal(201);
      const created = (await create.json()) as {
        request: { id: string; status: string };
        otpSent: boolean;
      };
      expect(created.otpSent).to.equal(false);
      expect(created.request.status).to.equal("awaiting_guardian");

      // Non-guardian nonce → 403
      const stranger = Wallet.createRandom();
      const badNonce = await fetch(
        `${baseUrl}/api/guardian/nonce?address=${stranger.address}`
      );
      expect(badNonce.status).to.equal(403);

      const nonceRes = await fetch(
        `${baseUrl}/api/guardian/nonce?address=${GUARDIAN.address}`
      );
      expect(nonceRes.status).to.equal(200);
      const nonceBody = (await nonceRes.json()) as {
        nonce: string;
        issuedAt: string;
        message: string;
      };
      expect(nonceBody.message).to.equal(
        guardianLoginMessage(GUARDIAN.address, nonceBody.nonce, nonceBody.issuedAt)
      );
      const signature = await GUARDIAN.signMessage(nonceBody.message);
      const login = await fetch(`${baseUrl}/api/guardian/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address: GUARDIAN.address,
          signature,
          message: nonceBody.message,
          nonce: nonceBody.nonce,
        }),
      });
      expect(login.status).to.equal(200);
      const loginBody = (await login.json()) as { token: string };

      const list = await fetch(`${baseUrl}/api/guardian/recovery-requests?status=awaiting_guardian`, {
        headers: { authorization: `Bearer ${loginBody.token}` },
      });
      expect(list.status).to.equal(200);
      const listBody = (await list.json()) as { requests: Array<{ id: string; email: string }> };
      expect(listBody.requests.some((r) => r.id === created.request.id)).to.equal(true);
      expect(listBody.requests.find((r) => r.id === created.request.id)!.email).to.equal(
        "recover@example.com"
      );

      const approve = await fetch(
        `${baseUrl}/api/guardian/recovery-requests/${created.request.id}/approve`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${loginBody.token}`,
            "content-type": "application/json",
          },
          body: "{}",
        }
      );
      expect(approve.status).to.equal(200);
      const approved = (await approve.json()) as {
        request: { status: string; jobId: string | null };
        job: { id: string; kind: string };
      };
      expect(approved.request.status).to.equal("queued");
      expect(approved.job.kind).to.equal("initiate");
      expect(approved.request.jobId).to.equal(approved.job.id);

      // Second request for reject path: need another wallet
      const owner2 = createPasskeyFixture();
      const wallet2 = await registerWallet(baseUrl, owner2);
      const ch2a = await (
        await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "attach", walletAddress: wallet2 }),
        })
      ).json() as { challengeId: string; challenge: string };
      await fetch(`${baseUrl}/api/wallet/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet2,
          email: "reject@example.com",
          challengeId: ch2a.challengeId,
          ownerQx: owner2.qx,
          ownerQy: owner2.qy,
          assertion: signAssertion({
            privateKeyPem: owner2.privateKeyPem,
            challengeBase64Url: ch2a.challenge,
            origin: "http://localhost",
            rpId: "localhost",
          }),
        }),
      });
      await fetch(`${baseUrl}/api/wallet/email/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet2,
          email: "reject@example.com",
          code: getLastDevOtp()!.code,
        }),
      });
      const new2 = createPasskeyFixture();
      const ch2r = await (
        await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "recover", walletAddress: wallet2 }),
        })
      ).json() as { challengeId: string; challenge: string };
      const create2 = await fetch(`${baseUrl}/api/wallet/recovery/requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet2,
          challengeId: ch2r.challengeId,
          ownerQx: new2.qx,
          ownerQy: new2.qy,
          credentialId: new2.credentialId,
          assertion: signAssertion({
            privateKeyPem: new2.privateKeyPem,
            challengeBase64Url: ch2r.challenge,
            origin: "http://localhost",
            rpId: "localhost",
          }),
        }),
      });
      const created2 = (await create2.json()) as { request: { id: string } };
      const reject = await fetch(
        `${baseUrl}/api/guardian/recovery-requests/${created2.request.id}/reject`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${loginBody.token}`,
            "content-type": "application/json",
          },
          body: "{}",
        }
      );
      expect(reject.status).to.equal(200);
      const rejected = (await reject.json()) as { request: { status: string } };
      expect(rejected.request.status).to.equal("rejected");

      // Unauthenticated guardian list
      const noAuth = await fetch(`${baseUrl}/api/guardian/recovery-requests`);
      expect(noAuth.status).to.equal(401);
    });
  });

  it("requires captcha when TURNSTILE_SECRET is set", async function () {
    await withApp(
      async (baseUrl) => {
        const pk = createPasskeyFixture();
        const wallet = await registerWallet(baseUrl, pk, "test-pass");
        const ch = await (
          await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ purpose: "attach", walletAddress: wallet }),
          })
        ).json() as { challengeId: string; challenge: string };
        const attach = await fetch(`${baseUrl}/api/wallet/email`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            walletAddress: wallet,
            email: "cap@example.com",
            challengeId: ch.challengeId,
            ownerQx: pk.qx,
            ownerQy: pk.qy,
            assertion: signAssertion({
              privateKeyPem: pk.privateKeyPem,
              challengeBase64Url: ch.challenge,
              origin: "http://localhost",
              rpId: "localhost",
            }),
          }),
        });
        expect(attach.status).to.equal(400);
        const body = (await attach.json()) as { error?: string };
        expect(body.error).to.equal("captcha_failed");
      },
      { TURNSTILE_SECRET: "test-secret" }
    );
  });

  it("exposes turnstileSiteKey on wallet-config", async function () {
    await withApp(
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/public/wallet-config`);
        expect(res.status).to.equal(200);
        const body = (await res.json()) as { turnstileSiteKey: string | null };
        expect(body.turnstileSiteKey).to.equal("site-key-public");
      },
      { TURNSTILE_SITE_KEY: "site-key-public" }
    );
  });

  it("cancels awaiting request with owner passkey", async function () {
    await withApp(async (baseUrl) => {
      const owner = createPasskeyFixture();
      const wallet = await registerWallet(baseUrl, owner);
      const chA = await (
        await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "attach", walletAddress: wallet }),
        })
      ).json() as { challengeId: string; challenge: string };
      await fetch(`${baseUrl}/api/wallet/email`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          email: "cancel@example.com",
          challengeId: chA.challengeId,
          ownerQx: owner.qx,
          ownerQy: owner.qy,
          assertion: signAssertion({
            privateKeyPem: owner.privateKeyPem,
            challengeBase64Url: chA.challenge,
            origin: "http://localhost",
            rpId: "localhost",
          }),
        }),
      });
      await fetch(`${baseUrl}/api/wallet/email/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          email: "cancel@example.com",
          code: getLastDevOtp()!.code,
        }),
      });
      const neu = createPasskeyFixture();
      const chR = await (
        await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "recover", walletAddress: wallet }),
        })
      ).json() as { challengeId: string; challenge: string };
      const created = (await (
        await fetch(`${baseUrl}/api/wallet/recovery/requests`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            walletAddress: wallet,
            challengeId: chR.challengeId,
            ownerQx: neu.qx,
            ownerQy: neu.qy,
            credentialId: neu.credentialId,
            assertion: signAssertion({
              privateKeyPem: neu.privateKeyPem,
              challengeBase64Url: chR.challenge,
              origin: "http://localhost",
              rpId: "localhost",
            }),
          }),
        })
      ).json()) as { request: { id: string } };

      const chC = await (
        await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "cancel", walletAddress: wallet }),
        })
      ).json() as { challengeId: string; challenge: string };
      const cancel = await fetch(
        `${baseUrl}/api/wallet/recovery/requests/${created.request.id}/cancel`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            challengeId: chC.challengeId,
            ownerQx: owner.qx,
            ownerQy: owner.qy,
            credentialId: owner.credentialId,
            assertion: signAssertion({
              privateKeyPem: owner.privateKeyPem,
              challengeBase64Url: chC.challenge,
              origin: "http://localhost",
              rpId: "localhost",
            }),
          }),
        }
      );
      expect(cancel.status).to.equal(200);
      const cancelled = (await cancel.json()) as { request: { status: string } };
      expect(cancelled.request.status).to.equal("cancelled");
    });
  });

  it("email-first lookup lists every wallet and does not enumerate unknown emails", async function () {
    await withApp(async (baseUrl) => {
      const a = createPasskeyFixture();
      const b = createPasskeyFixture();
      const walletA = await registerWallet(baseUrl, a);
      const walletB = await registerWallet(baseUrl, b);
      await attachVerifiedEmail(baseUrl, a, walletA, "multi@example.com");
      await attachVerifiedEmail(baseUrl, b, walletB, "multi@example.com");

      clearLastDevOtp();
      const unknown = await fetch(`${baseUrl}/api/wallet/recovery/email/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "nobody@example.com" }),
      });
      expect(unknown.status).to.equal(200);
      expect(getLastDevOtp()).to.equal(null);

      const start = await fetch(`${baseUrl}/api/wallet/recovery/email/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "multi@example.com" }),
      });
      expect(start.status).to.equal(200);
      const otp = getLastDevOtp();
      expect(otp?.to).to.equal("multi@example.com");

      const verify = await fetch(`${baseUrl}/api/wallet/recovery/email/verify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "multi@example.com", code: otp!.code }),
      });
      expect(verify.status).to.equal(200);
      const verified = (await verify.json()) as { emailSession: string };
      expect(verified.emailSession).to.be.a("string");

      const listed = await fetch(`${baseUrl}/api/wallet/recovery/email/wallets`, {
        headers: { authorization: `Bearer ${verified.emailSession}` },
      });
      expect(listed.status).to.equal(200);
      const listBody = (await listed.json()) as { wallets: Array<{ address: string }> };
      expect(listBody.wallets.map((w) => w.address.toLowerCase()).sort()).to.deep.equal(
        [walletA, walletB].map((w) => w.toLowerCase()).sort()
      );

      const newDevice = createPasskeyFixture();
      const ch = await (
        await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "recover", walletAddress: walletA }),
        })
      ).json() as { challengeId: string; challenge: string };
      const create = await fetch(`${baseUrl}/api/wallet/recovery/requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddresses: [walletA, walletB],
          emailSession: verified.emailSession,
          challengeId: ch.challengeId,
          ownerQx: newDevice.qx,
          ownerQy: newDevice.qy,
          credentialId: newDevice.credentialId,
          assertion: signAssertion({
            privateKeyPem: newDevice.privateKeyPem,
            challengeBase64Url: ch.challenge,
            origin: "http://localhost",
            rpId: "localhost",
          }),
        }),
      });
      expect(create.status).to.equal(201);
      const created = (await create.json()) as {
        requests: Array<{ status: string; walletAddress: string }>;
        otpSent: boolean;
      };
      expect(created.otpSent).to.equal(false);
      expect(created.requests).to.have.length(2);
      expect(created.requests.every((r) => r.status === "awaiting_guardian")).to.equal(true);

      const notify = getLastDevNotify();
      expect(notify?.subject).to.equal("recovery requested");
      expect(notify?.text).to.include(walletA.toLowerCase());
      expect(notify?.text).to.include(walletB.toLowerCase());
    });
  });

  it("creates recovery without email and accepts an EIP-712 EOA signature", async function () {
    await withApp(async (baseUrl) => {
      const owner = createPasskeyFixture();
      const wallet = await registerWallet(baseUrl, owner);
      const eoa = Wallet.createRandom();
      const ch = await (
        await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "recover", walletAddress: wallet }),
        })
      ).json() as { challengeId: string; challenge: string };
      const signature = await signEoaRecover(eoa.privateKey, wallet, ch.challenge, eoa.address, 11155111);
      const create = await fetch(`${baseUrl}/api/wallet/recovery/requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          challengeId: ch.challengeId,
          ownerKind: "eoa",
          eoaAddress: eoa.address,
          eoaSignature: signature,
          chainId: "11155111",
        }),
      });
      expect(create.status).to.equal(201);
      const created = (await create.json()) as {
        request: { status: string; newOwnerKind: string; newEoa: string; email: string };
        otpSent: boolean;
        existingOwner: boolean;
      };
      expect(created.otpSent).to.equal(false);
      expect(created.existingOwner).to.equal(false);
      expect(created.request.status).to.equal("awaiting_guardian");
      expect(created.request.newOwnerKind).to.equal("eoa");
      expect(created.request.newEoa?.toLowerCase()).to.equal(eoa.address.toLowerCase());
      expect(created.request.email).to.equal("");
      expect(getLastDevNotify()?.subject).to.equal("recovery requested");
    });
  });

  it("rejects personal_sign leftover recovery messages", async function () {
    await withApp(async (baseUrl) => {
      const owner = createPasskeyFixture();
      const wallet = await registerWallet(baseUrl, owner);
      const eoa = Wallet.createRandom();
      const ch = await (
        await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "recover", walletAddress: wallet }),
        })
      ).json() as { challengeId: string; challenge: string };
      const signature = await eoa.signMessage(recoveryNewOwnerMessage(ch.challenge));
      const create = await fetch(`${baseUrl}/api/wallet/recovery/requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          challengeId: ch.challengeId,
          ownerKind: "eoa",
          eoaAddress: eoa.address,
          eoaSignature: signature,
          chainId: "11155111",
        }),
      });
      expect(create.status).to.equal(400);
      const body = (await create.json()) as { error: string };
      expect(body.error).to.equal("eoa_personal_sign_rejected");
    });
  });

  it("creates Super Wallet EOA recovery with the same request shape", async function () {
    await withApp(async (baseUrl, app) => {
      const owner = createPasskeyFixture();
      const wallet = await registerWallet(baseUrl, owner);
      const entityId = "0x" + "aa".repeat(32);
      app.db.upsertWalletEntity({ walletAddress: wallet, entityId, label: "Admin" });
      const eoa = Wallet.createRandom();
      const ch = await (
        await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ purpose: "recover", walletAddress: wallet }),
        })
      ).json() as { challengeId: string; challenge: string };
      const signature = await signEoaRecover(eoa.privateKey, wallet, ch.challenge, eoa.address, 11155111);
      const create = await fetch(`${baseUrl}/api/wallet/recovery/requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: wallet,
          challengeId: ch.challengeId,
          ownerKind: "eoa",
          eoaAddress: eoa.address,
          eoaSignature: signature,
          chainId: "11155111",
        }),
      });
      expect(create.status).to.equal(201);
      const created = (await create.json()) as {
        request: { status: string; newOwnerKind: string; newEoa: string };
        otpSent: boolean;
      };
      expect(created.otpSent).to.equal(false);
      expect(created.request.status).to.equal("awaiting_guardian");
      expect(created.request.newOwnerKind).to.equal("eoa");
      expect(created.request.newEoa?.toLowerCase()).to.equal(eoa.address.toLowerCase());
    });
  });
});
