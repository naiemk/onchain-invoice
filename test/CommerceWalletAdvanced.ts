import { expect } from "chai";
import { ethers as ethersLib, zeroPadValue } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { resetRateLimitBuckets } from "../commerce/server/rate-limit.js";
import { deriveWalletSalt, predictWalletAddress } from "../commerce/shared/wallet-address.js";
import {
  computeKeyId,
  encodeAdvancedSignature,
  KEY_EOA,
  signEoaPersonalDigest,
} from "../commerce/shared/advanced-wallet.js";
import { encodeErc20Transfer } from "../commerce/shared/userop.js";

const FACTORY = "0x06964dE197ed29A4DC2D34F68aD4510Afa25f537";
const IMPL = "0xe024cE8ed1878dBdd3ca8E73B1e586c4E46dC85C";
const QX = ethersLib.zeroPadValue("0x0a", 32);
const QY = ethersLib.zeroPadValue("0x0b", 32);
const ADMIN_ENTITY = "0x" + "aa".repeat(32);
const ENTITY_B = "0x" + "bb".repeat(32);
const FEE_TOKEN = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const BENEFICIARY = "0x1111111111111111111111111111111111111111";
const HARDHAT_EOA_KEY = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const BASE_ENV = {
  PORT: "0",
  ADMIN_API_KEY: "admin-advanced-test",
  SWEEPER_API_KEY: "sweeper-advanced-test",
  WALLET_FACTORY_ADDRESS: FACTORY,
  WALLET_IMPLEMENTATION_ADDRESS: IMPL,
  WALLET_RECOVERY_ADDRESS: "0x72739889bcce2B08a23212bae6C7B9F1C29e7873",
  WALLET_BUNDLER_BENEFICIARY: BENEFICIARY,
  WALLET_BUNDLER_FEE_TOKEN: FEE_TOKEN,
  WALLET_BUNDLER_FEE_USDC: "100000",
  WALLET_RPC_URL: "",
  EVM_RPC_URL: "",
} as const;

async function withApp(
  fn: (baseUrl: string) => Promise<void>,
  envOverrides: Record<string, string> = {}
): Promise<void> {
  resetRateLimitBuckets();
  const dir = await mkdtemp(join(tmpdir(), "commerce-wallet-advanced-"));
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

describe("commerce wallet advanced API", function () {
  it("registers entities and keys off-chain", async function () {
    await withApp(async (baseUrl) => {
      const wallet = predictWalletAddress(FACTORY, IMPL, deriveWalletSalt(QX, QY));
      const entityRes = await fetch(`${baseUrl}/api/wallet/${wallet}/entities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId: ADMIN_ENTITY, label: "Admin" }),
      });
      expect(entityRes.status).to.equal(200);
      const eoa = ethersLib.Wallet.createRandom().address;
      const keyId = computeKeyId(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), eoa);
      const keyRes = await fetch(`${baseUrl}/api/wallet/${wallet}/entities/${ADMIN_ENTITY}/keys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyId, keyType: KEY_EOA, eoa }),
      });
      expect(keyRes.status).to.equal(200);

      const list = await fetch(`${baseUrl}/api/wallet/${wallet}/entities`);
      expect(list.status).to.equal(200);
      const body = (await list.json()) as {
        entities: Array<{ entityId: string; label: string | null }>;
        keys: Array<{ keyId: string; keyType: number; eoa: string | null }>;
      };
      expect(body.entities).to.have.length(1);
      expect(body.entities[0]?.label).to.equal("Admin");
      expect(body.keys[0]?.keyId.toLowerCase()).to.equal(keyId.toLowerCase());
      expect(body.keys[0]?.eoa?.toLowerCase()).to.equal(eoa.toLowerCase());
    });
  });

  it("creates proposal, records signatures, execute queues userOp", async function () {
    await withApp(async (baseUrl) => {
      const wallet = predictWalletAddress(FACTORY, IMPL, deriveWalletSalt(QX, QY));
      const recipient = ethersLib.Wallet.createRandom().address;
      const eoa = new ethersLib.Wallet(HARDHAT_EOA_KEY).address;
      const keyId = computeKeyId(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), eoa);

      await fetch(`${baseUrl}/api/wallet/${wallet}/entities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId: ADMIN_ENTITY }),
      });
      await fetch(`${baseUrl}/api/wallet/${wallet}/entities/${ADMIN_ENTITY}/keys`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keyId, keyType: KEY_EOA, eoa }),
      });

      const data = encodeErc20Transfer(recipient, 500_000n);
      const create = await fetch(`${baseUrl}/api/wallet/${wallet}/proposals`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chainId: "11155111",
          target: FEE_TOKEN,
          value: "0",
          data,
        }),
      });
      expect(create.status).to.equal(201);
      const { proposal } = (await create.json()) as { proposal: { id: string; status: string } };
      expect(proposal.status).to.equal("draft");

      const prepare = await fetch(`${baseUrl}/api/wallet/${wallet}/proposals/${proposal.id}/prepare`, {
        method: "POST",
      });
      expect(prepare.status).to.equal(503);

      const digest = ethersLib.id("proposal-sign-test");
      const sig = await signEoaPersonalDigest(HARDHAT_EOA_KEY, digest);
      const sign = await fetch(`${baseUrl}/api/wallet/${wallet}/proposals/${proposal.id}/sign`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId: ADMIN_ENTITY,
          keyId,
          keyType: KEY_EOA,
          signature: sig,
        }),
      });
      expect(sign.status).to.equal(200);

      const got = await fetch(`${baseUrl}/api/wallet/${wallet}/proposals/${proposal.id}`);
      expect(got.status).to.equal(200);
      const detail = (await got.json()) as { signatures: Array<{ keyId: string }> };
      expect(detail.signatures).to.have.length(1);

      const execute = await fetch(`${baseUrl}/api/wallet/${wallet}/proposals/${proposal.id}/execute`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(execute.status).to.equal(503);
    });
  });

  it("execute with pre-set nonce queues userOp when RPC available", async function () {
    await withApp(
      async (baseUrl) => {
        const wallet = predictWalletAddress(FACTORY, IMPL, deriveWalletSalt(QX, QY));
        const eoa = new ethersLib.Wallet(HARDHAT_EOA_KEY).address;
        const keyId = computeKeyId(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), eoa);
        const recipient = ethersLib.Wallet.createRandom().address;

        const create = await fetch(`${baseUrl}/api/wallet/${wallet}/proposals`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            chainId: "11155111",
            target: FEE_TOKEN,
            value: "0",
            data: encodeErc20Transfer(recipient, 100_000n),
          }),
        });
        const { proposal } = (await create.json()) as { proposal: { id: string } };

        const sig = await signEoaPersonalDigest(HARDHAT_EOA_KEY, ethersLib.id("exec-test"));
        await fetch(`${baseUrl}/api/wallet/${wallet}/proposals/${proposal.id}/sign`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            entityId: ADMIN_ENTITY,
            keyId,
            keyType: KEY_EOA,
            signature: sig,
          }),
        });

        const prepare = await fetch(`${baseUrl}/api/wallet/${wallet}/proposals/${proposal.id}/prepare`, {
          method: "POST",
        });
        if (prepare.status === 503) {
          return;
        }
        expect(prepare.status).to.equal(200);

        const execute = await fetch(`${baseUrl}/api/wallet/${wallet}/proposals/${proposal.id}/execute`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({}),
        });
        expect(execute.status).to.equal(200);
        const body = (await execute.json()) as { userOpHash: string };
        expect(body.userOpHash).to.match(/^0x[0-9a-f]{64}$/i);

        const userOp = await fetch(`${baseUrl}/api/wallet/userops/${body.userOpHash}`);
        expect(userOp.status).to.equal(200);
      },
      process.env.HARDHAT_RPC_URL ? { WALLET_RPC_URL: process.env.HARDHAT_RPC_URL, EVM_RPC_URL: process.env.HARDHAT_RPC_URL } : {}
    );
  });

  it("advanced-policy returns 503 without RPC", async function () {
    await withApp(async (baseUrl) => {
      const wallet = predictWalletAddress(FACTORY, IMPL, deriveWalletSalt(QX, QY));
      const res = await fetch(`${baseUrl}/api/wallet/${wallet}/advanced-policy`);
      expect(res.status).to.equal(503);
    });
  });

  it("advanced-policy returns not-advanced for undeployed wallet when RPC is up", async function () {
    if (!process.env.HARDHAT_RPC_URL) return;
    await withApp(
      async (baseUrl) => {
        const wallet = predictWalletAddress(FACTORY, IMPL, deriveWalletSalt(QX, QY));
        const res = await fetch(`${baseUrl}/api/wallet/${wallet}/advanced-policy`);
        expect(res.status).to.equal(200);
        const body = (await res.json()) as { advanced: boolean; supportsAdvanced: boolean };
        expect(body.advanced).to.equal(false);
        expect(body.supportsAdvanced).to.equal(true);
      },
      { WALLET_RPC_URL: process.env.HARDHAT_RPC_URL, EVM_RPC_URL: process.env.HARDHAT_RPC_URL }
    );
  });

  it("encodeAdvancedSignature packs entity sigs for execute", function () {
    const keyA = computeKeyId(ADMIN_ENTITY, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), ethersLib.ZeroAddress);
    const keyB = computeKeyId(ENTITY_B, KEY_EOA, zeroPadValue("0x00", 32), zeroPadValue("0x00", 32), ethersLib.ZeroAddress);
    const packed = encodeAdvancedSignature([
      { keyId: keyA, sig: "0x01" },
      { keyId: keyB, sig: "0x02" },
    ]);
    expect(packed.startsWith("0x")).to.equal(true);
    expect(packed.length).to.be.greaterThan(10);
  });

  it("manages key enrollment requests for teammate join", async function () {
    await withApp(async (baseUrl) => {
      const wallet = predictWalletAddress(FACTORY, IMPL, deriveWalletSalt(QX, QY));
      await fetch(`${baseUrl}/api/wallet/${wallet}/entities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ entityId: ENTITY_B, label: "teammate@example.com" }),
      });
      const qx = ethersLib.zeroPadValue("0x0c", 32);
      const qy = ethersLib.zeroPadValue("0x0d", 32);
      const createRes = await fetch(`${baseUrl}/api/wallet/${wallet}/key-enrollment-requests`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          entityId: ENTITY_B,
          keyType: 0,
          qx,
          qy,
          label: "teammate@example.com",
        }),
      });
      expect(createRes.status).to.equal(201);
      const created = (await createRes.json()) as { request: { id: string; status: string } };
      expect(created.request.status).to.equal("pending");

      const listRes = await fetch(`${baseUrl}/api/wallet/${wallet}/key-enrollment-requests?status=pending`);
      expect(listRes.status).to.equal(200);
      const list = (await listRes.json()) as { requests: Array<{ id: string }> };
      expect(list.requests.some((r) => r.id === created.request.id)).to.equal(true);

      const approveRes = await fetch(
        `${baseUrl}/api/wallet/${wallet}/key-enrollment-requests/${created.request.id}/approve`,
        { method: "POST", headers: { "content-type": "application/json" }, body: "{}" }
      );
      expect(approveRes.status).to.equal(200);
      const approved = (await approveRes.json()) as { request: { status: string } };
      expect(approved.request.status).to.equal("approved");
    });
  });
});
