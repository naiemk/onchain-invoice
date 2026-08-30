import { expect } from "chai";
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { ethers as ethersLib } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { resetRateLimitBuckets } from "../commerce/server/rate-limit.js";
import { signClientRequest } from "../commerce/server/client-auth.js";
import { deriveWalletSalt, predictWalletAddress } from "../commerce/shared/wallet-address.js";
import { challengeToBase64Url } from "../commerce/shared/webauthn-verify.js";
import { buildPackedUserOperation } from "../commerce/shared/userop.js";

const FACTORY = "0x2b245a20589c745B11F8a69C677F891e8175a550";
const IMPL = "0x297CF0F47e9f6dAd3903694dE531abaD83CE8AAA";

const BASE_ENV = {
  PORT: "0",
  ADMIN_API_KEY: "admin-wallet-client-test",
  SWEEPER_API_KEY: "sweeper-wallet-client-test",
  WALLET_FACTORY_ADDRESS: FACTORY,
  WALLET_IMPLEMENTATION_ADDRESS: IMPL,
  WALLET_RECOVERY_ADDRESS: "0x87CB1c5eD04959A51A7CACe8eA2787791F9cE347",
  WALLET_RPC_URL: "",
  EVM_RPC_URL: "",
  WALLET_BUNDLER_BENEFICIARY: "0x1111111111111111111111111111111111111111",
  WALLET_BUNDLER_FEE_TOKEN: "0x2222222222222222222222222222222222222222",
  WALLET_BUNDLER_FEE_USDC: "100000",
} as const;

async function withApp(
  fn: (baseUrl: string) => Promise<void>,
  envOverrides: Record<string, string> = {}
): Promise<void> {
  resetRateLimitBuckets();
  const dir = await mkdtemp(join(tmpdir(), "commerce-wallet-client-"));
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

interface PasskeyFixture {
  qx: string;
  qy: string;
  privateKeyPem: string;
  credentialId: string;
}

function createPasskeyFixture(): PasskeyFixture {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  // Uncompressed point is last 65 bytes: 0x04 || x || y
  const point = spki.subarray(spki.length - 65);
  expect(point[0]).to.equal(0x04);
  const qx = "0x" + point.subarray(1, 33).toString("hex");
  const qy = "0x" + point.subarray(33, 65).toString("hex");
  return {
    qx,
    qy,
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    credentialId: Buffer.from("cred-" + qx.slice(2, 10)).toString("base64"),
  };
}

function signAssertion(input: {
  privateKeyPem: string;
  challengeBase64Url: string;
  origin: string;
}): { authenticatorData: string; clientDataJSON: string; signature: string } {
  const clientData = {
    type: "webauthn.get",
    challenge: input.challengeBase64Url,
    origin: input.origin,
    crossOrigin: false,
  };
  const clientDataJSON = JSON.stringify(clientData);
  // Minimal authenticatorData: rpIdHash(32) + flags(1) + signCount(4)
  const rpIdHash = createHash("sha256").update("example.com").digest();
  const authenticatorData = Buffer.concat([
    rpIdHash,
    Buffer.from([0x05]), // UP + UV
    Buffer.alloc(4),
  ]);
  const clientDataHash = createHash("sha256").update(clientDataJSON, "utf8").digest();
  const signed = Buffer.concat([authenticatorData, clientDataHash]);
  const key = createPrivateKey(input.privateKeyPem);
  const signature = sign("sha256", signed, { key, dsaEncoding: "ieee-p1363" });
  return {
    authenticatorData: "0x" + authenticatorData.toString("hex"),
    clientDataJSON,
    signature: "0x" + signature.toString("hex"),
  };
}

async function createClient(
  baseUrl: string,
  label = "Test client",
  rpId = "example.com"
): Promise<{ id: string; hmacSecret: string; rpId: string }> {
  const res = await fetch(`${baseUrl}/api/admin/wallet-clients`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": BASE_ENV.ADMIN_API_KEY,
    },
    body: JSON.stringify({ label, rpId, origins: [`https://${rpId}`] }),
  });
  expect(res.status).to.equal(201);
  const body = (await res.json()) as {
    client: { id: string; rpId: string };
    hmacSecret: string;
  };
  return { id: body.client.id, hmacSecret: body.hmacSecret, rpId: body.client.rpId };
}

async function signedFetch(
  baseUrl: string,
  clientId: string,
  hmacSecret: string,
  method: string,
  pathWithQuery: string,
  bodyObj?: unknown
): Promise<Response> {
  const body = bodyObj === undefined ? "" : JSON.stringify(bodyObj);
  const pathForSign = pathWithQuery.split("?")[0]!;
  const headers = signClientRequest(clientId, hmacSecret, {
    method,
    path: pathForSign,
    body,
  });
  return fetch(`${baseUrl}${pathWithQuery}`, {
    method,
    headers: {
      ...headers,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body || undefined,
  });
}

describe("commerce wallet client HMAC API", function () {
  it("rejects missing HMAC and replayed nonce", async function () {
    await withApp(async (baseUrl) => {
      const client = await createClient(baseUrl);
      const bare = await fetch(`${baseUrl}/api/client/wallets?email=a@example.com`);
      expect(bare.status).to.equal(401);

      const path = "/api/client/wallets/challenges";
      const body = JSON.stringify({ purpose: "create", email: "a@example.com" });
      const headers = signClientRequest(client.id, client.hmacSecret, {
        method: "POST",
        path,
        body,
      });
      const first = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body,
      });
      expect(first.status).to.equal(201);

      const replay = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body,
      });
      expect(replay.status).to.equal(401);
    });
  });

  it("rejects skewed timestamp", async function () {
    await withApp(async (baseUrl) => {
      const client = await createClient(baseUrl);
      const path = "/api/client/wallets/challenges";
      const body = JSON.stringify({ purpose: "create" });
      const headers = signClientRequest(client.id, client.hmacSecret, {
        method: "POST",
        path,
        body,
      });
      headers["x-client-timestamp"] = String(Date.now() - 20 * 60 * 1000);
      // Re-sign with skewed timestamp so signature matches message but fails skew check
      const { createHmac } = await import("node:crypto");
      const { canonicalClientMessage, hashBody } = await import("../commerce/server/client-auth.js");
      const message = canonicalClientMessage({
        method: "POST",
        path,
        bodyHash: hashBody(body),
        timestamp: headers["x-client-timestamp"]!,
        nonce: headers["x-client-nonce"]!,
      });
      headers["x-client-signature"] = createHmac("sha256", client.hmacSecret)
        .update(message)
        .digest("hex");
      const res = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body,
      });
      expect(res.status).to.equal(401);
    });
  });

  it("creates and lists wallets scoped by client + email", async function () {
    await withApp(async (baseUrl) => {
      const clientA = await createClient(baseUrl, "A");
      const clientB = await createClient(baseUrl, "B");
      const passkey = createPasskeyFixture();

      const challengeRes = await signedFetch(
        baseUrl,
        clientA.id,
        clientA.hmacSecret,
        "POST",
        "/api/client/wallets/challenges",
        { purpose: "create", email: "user@example.com" }
      );
      expect(challengeRes.status).to.equal(201);
      const challengeBody = (await challengeRes.json()) as {
        challengeId: string;
        challenge: string;
      };

      const assertion = signAssertion({
        privateKeyPem: passkey.privateKeyPem,
        challengeBase64Url: challengeBody.challenge,
        origin: "https://example.com",
      });

      const createRes = await signedFetch(
        baseUrl,
        clientA.id,
        clientA.hmacSecret,
        "POST",
        "/api/client/wallets",
        {
          email: "User@Example.com",
          contact: { phone: "+1555" },
          challengeId: challengeBody.challengeId,
          ownerQx: passkey.qx,
          ownerQy: passkey.qy,
          credentialId: passkey.credentialId,
          assertion,
          label: "Phone",
        }
      );
      expect(createRes.status).to.equal(201);
      const created = (await createRes.json()) as {
        wallet: { address: string; email: string };
      };
      const expected = predictWalletAddress(
        FACTORY,
        IMPL,
        deriveWalletSalt(passkey.qx, passkey.qy)
      ).toLowerCase();
      expect(created.wallet.address).to.equal(expected);
      expect(created.wallet.email).to.equal("user@example.com");

      const listA = await signedFetch(
        baseUrl,
        clientA.id,
        clientA.hmacSecret,
        "GET",
        "/api/client/wallets?email=user@example.com"
      );
      expect(listA.status).to.equal(200);
      const listABody = (await listA.json()) as {
        wallets: Array<{ address: string; devices: Array<{ credentialId: string | null }> }>;
      };
      expect(listABody.wallets).to.have.length(1);
      expect(listABody.wallets[0]!.devices[0]!.credentialId).to.equal(passkey.credentialId);

      const listB = await signedFetch(
        baseUrl,
        clientB.id,
        clientB.hmacSecret,
        "GET",
        "/api/client/wallets?email=user@example.com"
      );
      expect(listB.status).to.equal(200);
      const listBBody = (await listB.json()) as { wallets: unknown[] };
      expect(listBBody.wallets).to.have.length(0);
    });
  });

  it("rejects send for wallet not bound to client", async function () {
    await withApp(async (baseUrl) => {
      const client = await createClient(baseUrl);
      const foreign = "0x3333333333333333333333333333333333333333";
      const res = await signedFetch(
        baseUrl,
        client.id,
        client.hmacSecret,
        "POST",
        `/api/client/wallets/${foreign}/send`,
        {
          userOp: buildPackedUserOperation({
            sender: foreign,
            nonce: 0n,
            callData: "0x",
          }),
          userOpHash: ethersLib.id("fake"),
        }
      );
      expect(res.status).to.equal(403);
    });
  });

  it("enqueues recovery initiate after identityVerified + new device assertion", async function () {
    await withApp(async (baseUrl) => {
      const client = await createClient(baseUrl);
      const passkey = createPasskeyFixture();
      const recoveryKey = createPasskeyFixture();

      // Create wallet first
      const ch1 = await signedFetch(
        baseUrl,
        client.id,
        client.hmacSecret,
        "POST",
        "/api/client/wallets/challenges",
        { purpose: "create", email: "recover@example.com" }
      );
      const ch1Body = (await ch1.json()) as { challengeId: string; challenge: string };
      const createRes = await signedFetch(
        baseUrl,
        client.id,
        client.hmacSecret,
        "POST",
        "/api/client/wallets",
        {
          email: "recover@example.com",
          challengeId: ch1Body.challengeId,
          ownerQx: passkey.qx,
          ownerQy: passkey.qy,
          credentialId: passkey.credentialId,
          assertion: signAssertion({
            privateKeyPem: passkey.privateKeyPem,
            challengeBase64Url: ch1Body.challenge,
            origin: "https://example.com",
          }),
        }
      );
      const created = (await createRes.json()) as { wallet: { address: string } };

      const ch2 = await signedFetch(
        baseUrl,
        client.id,
        client.hmacSecret,
        "POST",
        "/api/client/wallets/challenges",
        { purpose: "recover", email: "recover@example.com", walletAddress: created.wallet.address }
      );
      const ch2Body = (await ch2.json()) as { challengeId: string; challenge: string };

      const noId = await signedFetch(
        baseUrl,
        client.id,
        client.hmacSecret,
        "POST",
        `/api/client/wallets/${created.wallet.address}/recovery`,
        {
          email: "recover@example.com",
          identityVerified: false,
          challengeId: ch2Body.challengeId,
          ownerQx: recoveryKey.qx,
          ownerQy: recoveryKey.qy,
          credentialId: recoveryKey.credentialId,
          assertion: signAssertion({
            privateKeyPem: recoveryKey.privateKeyPem,
            challengeBase64Url: ch2Body.challenge,
            origin: "https://example.com",
          }),
        }
      );
      expect(noId.status).to.equal(400);

      // Fresh challenge after failed attempt (previous may be unconsumed)
      const ch3 = await signedFetch(
        baseUrl,
        client.id,
        client.hmacSecret,
        "POST",
        "/api/client/wallets/challenges",
        { purpose: "recover", email: "recover@example.com" }
      );
      const ch3Body = (await ch3.json()) as { challengeId: string; challenge: string };

      const ok = await signedFetch(
        baseUrl,
        client.id,
        client.hmacSecret,
        "POST",
        `/api/client/wallets/${created.wallet.address}/recovery`,
        {
          email: "recover@example.com",
          identityVerified: true,
          challengeId: ch3Body.challengeId,
          ownerQx: recoveryKey.qx,
          ownerQy: recoveryKey.qy,
          credentialId: recoveryKey.credentialId,
          assertion: signAssertion({
            privateKeyPem: recoveryKey.privateKeyPem,
            challengeBase64Url: ch3Body.challenge,
            origin: "https://example.com",
          }),
        }
      );
      expect(ok.status).to.equal(201);
      const jobBody = (await ok.json()) as { job: { kind: string; status: string; newQx: string } };
      expect(jobBody.job.kind).to.equal("initiate");
      expect(jobBody.job.status).to.equal("pending");
      expect(jobBody.job.newQx).to.equal(recoveryKey.qx);

      const get = await signedFetch(
        baseUrl,
        client.id,
        client.hmacSecret,
        "GET",
        `/api/client/wallets/${created.wallet.address}/recovery`
      );
      expect(get.status).to.equal(200);
      const getBody = (await get.json()) as { jobs: unknown[] };
      expect(getBody.jobs.length).to.be.greaterThan(0);

      // Internal list for deployer
      const internal = await fetch(
        `${baseUrl}/api/internal/wallet-recovery/jobs?status=pending`,
        { headers: { "x-api-key": BASE_ENV.SWEEPER_API_KEY } }
      );
      expect(internal.status).to.equal(200);
      const internalBody = (await internal.json()) as { jobs: Array<{ id: string }> };
      expect(internalBody.jobs.length).to.be.greaterThan(0);
    });
  });

  it("cancel recovery rejects unknown owner device", async function () {
    await withApp(async (baseUrl) => {
      const client = await createClient(baseUrl);
      const passkey = createPasskeyFixture();
      const stranger = createPasskeyFixture();

      const ch1 = await signedFetch(
        baseUrl,
        client.id,
        client.hmacSecret,
        "POST",
        "/api/client/wallets/challenges",
        { purpose: "create", email: "c@example.com" }
      );
      const ch1Body = (await ch1.json()) as { challengeId: string; challenge: string };
      const createRes = await signedFetch(
        baseUrl,
        client.id,
        client.hmacSecret,
        "POST",
        "/api/client/wallets",
        {
          email: "c@example.com",
          challengeId: ch1Body.challengeId,
          ownerQx: passkey.qx,
          ownerQy: passkey.qy,
          credentialId: passkey.credentialId,
          assertion: signAssertion({
            privateKeyPem: passkey.privateKeyPem,
            challengeBase64Url: ch1Body.challenge,
            origin: "https://example.com",
          }),
        }
      );
      const created = (await createRes.json()) as { wallet: { address: string } };

      const chCancel = await signedFetch(
        baseUrl,
        client.id,
        client.hmacSecret,
        "POST",
        "/api/client/wallets/challenges",
        { purpose: "cancel" }
      );
      const chCancelBody = (await chCancel.json()) as { challengeId: string; challenge: string };

      const bad = await signedFetch(
        baseUrl,
        client.id,
        client.hmacSecret,
        "POST",
        `/api/client/wallets/${created.wallet.address}/recovery/cancel`,
        {
          challengeId: chCancelBody.challengeId,
          credentialId: stranger.credentialId,
          ownerQx: stranger.qx,
          ownerQy: stranger.qy,
          assertion: signAssertion({
            privateKeyPem: stranger.privateKeyPem,
            challengeBase64Url: chCancelBody.challenge,
            origin: "https://example.com",
          }),
        }
      );
      expect(bad.status).to.equal(403);
    });
  });

  it("admin can list rotate and disable wallet clients", async function () {
    await withApp(async (baseUrl) => {
      const created = await createClient(baseUrl, "Rotate me");
      const list = await fetch(`${baseUrl}/api/admin/wallet-clients`, {
        headers: { "x-api-key": BASE_ENV.ADMIN_API_KEY },
      });
      expect(list.status).to.equal(200);
      const listBody = (await list.json()) as { clients: Array<{ id: string }> };
      expect(listBody.clients.some((c) => c.id === created.id)).to.equal(true);

      const rotate = await fetch(`${baseUrl}/api/admin/wallet-clients/${created.id}/rotate`, {
        method: "POST",
        headers: { "x-api-key": BASE_ENV.ADMIN_API_KEY },
      });
      expect(rotate.status).to.equal(200);
      const rotated = (await rotate.json()) as { hmacSecret: string };
      expect(rotated.hmacSecret).to.not.equal(created.hmacSecret);

      const disable = await fetch(`${baseUrl}/api/admin/wallet-clients/${created.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          "x-api-key": BASE_ENV.ADMIN_API_KEY,
        },
        body: JSON.stringify({ enabled: false }),
      });
      expect(disable.status).to.equal(200);

      const blocked = await signedFetch(
        baseUrl,
        created.id,
        rotated.hmacSecret,
        "POST",
        "/api/client/wallets/challenges",
        { purpose: "create" }
      );
      expect(blocked.status).to.equal(401);
    });
  });

  it("challengeToBase64Url is stable for fixture challenges", function () {
    const buf = Buffer.alloc(32, 0xab);
    const b64 = challengeToBase64Url(buf);
    expect(b64).to.match(/^[A-Za-z0-9_-]+$/);
  });
});
