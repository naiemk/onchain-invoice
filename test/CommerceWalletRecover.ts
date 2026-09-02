import { expect } from "chai";
import { createHash, createPrivateKey, generateKeyPairSync, sign } from "node:crypto";
import { ethers as ethersLib } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { resetRateLimitBuckets } from "../commerce/server/rate-limit.js";
import { deriveWalletSalt, predictWalletAddress } from "../commerce/shared/wallet-address.js";
import { matchRecoveredWalletOwner } from "../commerce/shared/wallet-recover-match.js";

const FACTORY = "0x06964dE197ed29A4DC2D34F68aD4510Afa25f537";
const IMPL = "0xe024cE8ed1878dBdd3ca8E73B1e586c4E46dC85C";
const QX = ethersLib.zeroPadValue("0x0c", 32);
const QY = ethersLib.zeroPadValue("0x0d", 32);
const OTHER_WALLET = "0x96aa0C5A047A3602882d72AD0aB4B080F3C0bC7b";

const BASE_ENV = {
  PORT: "0",
  BASE_URL: "http://localhost",
  ADMIN_API_KEY: "admin-wallet-recover",
  SWEEPER_API_KEY: "sweeper-wallet-recover",
  WALLET_FACTORY_ADDRESS: FACTORY,
  WALLET_IMPLEMENTATION_ADDRESS: IMPL,
  WALLET_RECOVERY_ADDRESS: "0x72739889bcce2B08a23212bae6C7B9F1C29e7873",
  WALLET_RPC_URL: "",
  EVM_RPC_URL: "",
  TURNSTILE_SECRET: "",
} as const;

function createPasskeyFixture() {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const spki = publicKey.export({ type: "spki", format: "der" }) as Buffer;
  const point = spki.subarray(spki.length - 65);
  expect(point[0]).to.equal(0x04);
  return {
    qx: "0x" + point.subarray(1, 33).toString("hex"),
    qy: "0x" + point.subarray(33, 65).toString("hex"),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }) as string,
    credentialId: Buffer.from("cred-" + point.subarray(1, 5).toString("hex")).toString("base64"),
  };
}

function signAssertion(input: {
  privateKeyPem: string;
  challengeBase64Url: string;
  origin?: string;
  rpId?: string;
}): { authenticatorData: string; clientDataJSON: string; signature: string } {
  const origin = input.origin ?? "http://localhost";
  const rpId = input.rpId ?? "localhost";
  const clientDataJSON = JSON.stringify({
    type: "webauthn.get",
    challenge: input.challengeBase64Url,
    origin,
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

async function withApp(fn: (baseUrl: string) => Promise<void>): Promise<void> {
  resetRateLimitBuckets();
  const dir = await mkdtemp(join(tmpdir(), "commerce-wallet-recover-"));
  const config = loadConfig({
    ...process.env,
    ...BASE_ENV,
    DB_PATH: join(dir, "test.db"),
  } as NodeJS.ProcessEnv);
  const app = createApp(config);
  await new Promise<void>((resolve) => {
    app.server.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = app.server.address();
  if (!addr || typeof addr === "string") throw new Error("expected TCP address");
  const baseUrl = `http://127.0.0.1:${addr.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
}

describe("matchRecoveredWalletOwner", function () {
  const owner = { qx: QX, qy: QY };
  const salt = deriveWalletSalt(QX, QY);
  const address = predictWalletAddress(FACTORY, IMPL, salt);

  it("accepts undeployed wallets only when CREATE2 matches", function () {
    const hit = matchRecoveredWalletOwner({
      walletAddress: address,
      factoryAddress: FACTORY,
      implementationAddress: IMPL,
      candidates: [owner],
      onChainOwners: [],
      verify: () => true,
    });
    expect(hit.ok).to.equal(true);
    if (hit.ok) expect(hit.create2Matched).to.equal(true);

    const miss = matchRecoveredWalletOwner({
      walletAddress: OTHER_WALLET,
      factoryAddress: FACTORY,
      implementationAddress: IMPL,
      candidates: [owner],
      onChainOwners: [],
      verify: () => true,
    });
    expect(miss).to.deep.include({ ok: false, error: "passkey_owner_mismatch", reason: "create2_mismatch" });
  });

  it("accepts deployed wallets when the passkey is an on-chain owner even if CREATE2 diverges", function () {
    const hit = matchRecoveredWalletOwner({
      walletAddress: OTHER_WALLET,
      factoryAddress: FACTORY,
      implementationAddress: IMPL,
      candidates: [owner],
      onChainOwners: [owner],
      verify: () => true,
    });
    expect(hit.ok).to.equal(true);
    if (hit.ok) {
      expect(hit.create2Matched).to.equal(false);
      expect(hit.qx).to.equal(QX);
    }
  });

  it("rejects a verified passkey that is not an on-chain owner of a deployed wallet", function () {
    const miss = matchRecoveredWalletOwner({
      walletAddress: OTHER_WALLET,
      factoryAddress: FACTORY,
      implementationAddress: IMPL,
      candidates: [owner],
      onChainOwners: [{ qx: ethersLib.zeroPadValue("0x01", 32), qy: ethersLib.zeroPadValue("0x02", 32) }],
      verify: () => true,
    });
    expect(miss).to.deep.include({
      ok: false,
      error: "passkey_owner_mismatch",
      reason: "not_onchain_owner",
    });
  });
});

describe("commerce wallet recover-info API", function () {
  it("returns inDb and deployed flags", async function () {
    await withApp(async (baseUrl) => {
      const salt = deriveWalletSalt(QX, QY);
      const address = predictWalletAddress(FACTORY, IMPL, salt);

      await fetch(`${baseUrl}/api/wallet/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address,
          salt,
          ownerQx: QX,
          ownerQy: QY,
          credentialId: "cred-recover",
        }),
      });

      const missing = await fetch(
        `${baseUrl}/api/wallet/accounts/0x0000000000000000000000000000000000000001/recover-info?chainId=11155111`
      );
      expect(missing.status).to.equal(200);
      const missingBody = (await missing.json()) as { inDb: boolean; deployed: boolean };
      expect(missingBody.inDb).to.equal(false);

      const info = await fetch(
        `${baseUrl}/api/wallet/accounts/${address}/recover-info?chainId=11155111`
      );
      expect(info.status).to.equal(200);
      const body = (await info.json()) as { inDb: boolean; account: { ownerQx: string } | null };
      expect(body.inDb).to.equal(true);
      expect(body.account?.ownerQx).to.equal(QX);

      const challenge = await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "record", walletAddress: address }),
      });
      expect(challenge.status).to.equal(201);
    });
  });
});

describe("commerce wallet recover API", function () {
  it("restores an undeployed CREATE2 wallet from a passkey assertion", async function () {
    await withApp(async (baseUrl) => {
      const pk = createPasskeyFixture();
      const salt = deriveWalletSalt(pk.qx, pk.qy);
      const address = predictWalletAddress(FACTORY, IMPL, salt);

      const challengeRes = await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "record", walletAddress: address }),
      });
      expect(challengeRes.status).to.equal(201);
      const challenge = (await challengeRes.json()) as { challengeId: string; challenge: string };

      const recover = await fetch(`${baseUrl}/api/wallet/accounts/recover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          chainId: "11155111",
          ownerQx: pk.qx,
          ownerQy: pk.qy,
          credentialId: pk.credentialId,
          challengeId: challenge.challengeId,
          assertion: signAssertion({
            privateKeyPem: pk.privateKeyPem,
            challengeBase64Url: challenge.challenge,
          }),
          label: "Recovered",
        }),
      });
      expect(recover.status).to.equal(200);
      const body = (await recover.json()) as {
        recovered: boolean;
        account: { address: string; ownerQx: string; credentialId: string | null };
      };
      expect(body.recovered).to.equal(true);
      expect(body.account.address).to.equal(address.toLowerCase());
      expect(body.account.ownerQx).to.equal(pk.qx);
      expect(body.account.credentialId).to.equal(pk.credentialId);
    });
  });

  it("rejects undeployed recover when CREATE2 does not match", async function () {
    await withApp(async (baseUrl) => {
      const pk = createPasskeyFixture();
      const challengeRes = await fetch(`${baseUrl}/api/wallet/recovery/challenges`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ purpose: "record", walletAddress: OTHER_WALLET }),
      });
      const challenge = (await challengeRes.json()) as { challengeId: string; challenge: string };

      const recover = await fetch(`${baseUrl}/api/wallet/accounts/recover`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: OTHER_WALLET,
          chainId: "11155111",
          ownerQx: pk.qx,
          ownerQy: pk.qy,
          credentialId: pk.credentialId,
          challengeId: challenge.challengeId,
          assertion: signAssertion({
            privateKeyPem: pk.privateKeyPem,
            challengeBase64Url: challenge.challenge,
          }),
        }),
      });
      expect(recover.status).to.equal(400);
      const body = (await recover.json()) as { error: string; reason?: string };
      expect(body.error).to.equal("passkey_owner_mismatch");
      expect(body.reason).to.equal("create2_mismatch");
    });
  });
});
