import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { CommerceDb } from "../commerce/server/db.js";
import { resetRateLimitBuckets } from "../commerce/server/rate-limit.js";
import { deriveWalletSalt, predictWalletAddress } from "../commerce/shared/wallet-address.js";

const FACTORY = "0x06964dE197ed29A4DC2D34F68aD4510Afa25f537";
const IMPL = "0xe024cE8ed1878dBdd3ca8E73B1e586c4E46dC85C";
const QX = ethersLib.zeroPadValue("0x0a", 32);
const QY = ethersLib.zeroPadValue("0x0b", 32);

const BASE_ENV = {
  PORT: "0",
  ADMIN_API_KEY: "admin-wallet-test",
  SWEEPER_API_KEY: "sweeper-wallet-test",
  WALLET_FACTORY_ADDRESS: FACTORY,
  WALLET_IMPLEMENTATION_ADDRESS: IMPL,
  WALLET_RECOVERY_ADDRESS: "0x72739889bcce2B08a23212bae6C7B9F1C29e7873",
  WALLET_RPC_URL: "",
  EVM_RPC_URL: "",
} as const;

async function withApp(
  fn: (baseUrl: string) => Promise<void>,
  envOverrides: Record<string, string> = {}
): Promise<void> {
  resetRateLimitBuckets();
  const dir = await mkdtemp(join(tmpdir(), "commerce-wallet-"));
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

describe("commerce wallet accounts API", function () {
  it("registers counterfactual account and returns deploy status", async function () {
    await withApp(async (baseUrl) => {
      const salt = deriveWalletSalt(QX, QY);
      const address = predictWalletAddress(FACTORY, IMPL, salt);
      const res = await fetch(`${baseUrl}/api/wallet/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address,
          salt,
          ownerQx: QX,
          ownerQy: QY,
          credentialId: "cred-test",
          webauthnAttestation: { clientDataJSON: "abc", attestationObject: "def" },
        }),
      });
      expect(res.status).to.equal(201);
      const body = (await res.json()) as { account: { address: string; deployedChains: string[] } };
      expect(body.account.address).to.equal(address.toLowerCase());
      expect(body.account.deployedChains).to.deep.equal([]);

      const get = await fetch(`${baseUrl}/api/wallet/accounts/${address}`);
      expect(get.status).to.equal(200);

      const patch = await fetch(`${baseUrl}/api/wallet/accounts/${address}/deployed`, {
        method: "PATCH",
        headers: { "content-type": "application/json", "x-api-key": "sweeper-wallet-test" },
        body: JSON.stringify({ chainId: "11155111" }),
      });
      expect(patch.status).to.equal(200);
      const patched = (await patch.json()) as { account: { deployedChains: string[] } };
      expect(patched.account.deployedChains).to.include("11155111");
    });
  });

  it("wallet-config exposes chains and implementation", async function () {
    await withApp(async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/wallet-config`);
      expect(res.status).to.equal(200);
      const body = (await res.json()) as {
        factoryAddress: string | null;
        implementationAddress: string | null;
        chains: unknown[];
        advancedWalletAbi?: string[];
      };
      expect(body.factoryAddress?.toLowerCase()).to.equal(FACTORY.toLowerCase());
      expect(body.implementationAddress?.toLowerCase()).to.equal(IMPL.toLowerCase());
      expect(body.chains.length).to.be.greaterThan(0);
      expect(body.advancedWalletAbi?.length).to.be.greaterThan(0);
    });
  });

  it("wallet-config defaults to published Sepolia factory when env is unset", async function () {
    await withApp(
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/public/wallet-config`);
        expect(res.status).to.equal(200);
        const body = (await res.json()) as {
          chainId: string;
          factoryAddress: string | null;
          implementationAddress: string | null;
        };
        expect(body.chainId).to.equal("11155111");
        expect(body.factoryAddress?.toLowerCase()).to.equal(FACTORY.toLowerCase());
        expect(body.implementationAddress?.toLowerCase()).to.equal(IMPL.toLowerCase());
      },
      {
        WALLET_FACTORY_ADDRESS: "",
        WALLET_IMPLEMENTATION_ADDRESS: "",
        WALLET_RECOVERY_ADDRESS: "",
        WALLET_CHAIN_ID: "",
      }
    );
  });

  it("looks up account by credentialId", async function () {
    await withApp(async (baseUrl) => {
      const salt = deriveWalletSalt(QX, QY);
      const address = predictWalletAddress(FACTORY, IMPL, salt);
      const credentialId = "cred-lookup-abc";
      await fetch(`${baseUrl}/api/wallet/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address,
          salt,
          ownerQx: QX,
          ownerQy: QY,
          credentialId,
        }),
      });
      await fetch(`${baseUrl}/api/wallet/devices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          walletAddress: address,
          chainId: "11155111",
          ownerQx: QX,
          ownerQy: QY,
          label: "Phone",
          credentialId,
        }),
      });

      const found = await fetch(
        `${baseUrl}/api/wallet/accounts?credentialId=${encodeURIComponent(credentialId)}`
      );
      expect(found.status).to.equal(200);
      const body = (await found.json()) as {
        account: { address: string; credentialId: string | null };
        device: { label: string } | null;
      };
      expect(body.account.address).to.equal(address.toLowerCase());
      expect(body.account.credentialId).to.equal(credentialId);
      expect(body.device?.label).to.equal("Phone");

      const missing = await fetch(`${baseUrl}/api/wallet/accounts?credentialId=nope`);
      expect(missing.status).to.equal(404);
    });
  });

  it("looks up account by credentialId encoding variants", async function () {
    await withApp(async (baseUrl) => {
      const salt = deriveWalletSalt(QX, QY);
      const address = predictWalletAddress(FACTORY, IMPL, salt);
      const credentialId = Buffer.from("raw-credential-bytes-xyz").toString("base64");
      const credentialIdUrl = credentialId.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      await fetch(`${baseUrl}/api/wallet/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address,
          salt,
          ownerQx: QX,
          ownerQy: QY,
          credentialId,
        }),
      });

      const found = await fetch(
        `${baseUrl}/api/wallet/accounts?credentialId=${encodeURIComponent(credentialIdUrl)}`
      );
      expect(found.status).to.equal(200);
      const body = (await found.json()) as { account: { address: string } };
      expect(body.account.address).to.equal(address.toLowerCase());
    });
  });

  it("balance endpoint returns aggregation shape", async function () {
    await withApp(async (baseUrl) => {
      const salt = deriveWalletSalt(QX, QY);
      const address = predictWalletAddress(FACTORY, IMPL, salt);
      await fetch(`${baseUrl}/api/wallet/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, salt, ownerQx: QX, ownerQy: QY, credentialId: "c" }),
      });
      const res = await fetch(`${baseUrl}/api/wallet/balance?wallet=${address}`);
      expect(res.status).to.equal(200);
      const body = (await res.json()) as { wallet: string; totalUsdc: string; chains: unknown[] };
      expect(body.wallet.toLowerCase()).to.equal(address.toLowerCase());
      expect(body.chains).to.be.an("array");
    });
  });
});

describe("commerce wallet pairing API", function () {
  it("create → submit → poll approved → consume", async function () {
    await withApp(async (baseUrl) => {
      const wallet = predictWalletAddress(FACTORY, IMPL, deriveWalletSalt(QX, QY));
      const create = await fetch(`${baseUrl}/api/wallet/pairing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", walletAddress: wallet, chainId: "11155111" }),
      });
      expect(create.status).to.equal(200);
      const { pairing } = (await create.json()) as { pairing: { nonce: string } };

      const submit = await fetch(`${baseUrl}/api/wallet/pairing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          nonce: pairing.nonce,
          newOwnerQx: ethersLib.zeroPadValue("0x11", 32),
          newOwnerQy: ethersLib.zeroPadValue("0x12", 32),
          deviceLabel: "iPad",
        }),
      });
      expect(submit.status).to.equal(200);

      const poll = await fetch(`${baseUrl}/api/wallet/pairing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "poll", nonce: pairing.nonce }),
      });
      const polled = (await poll.json()) as { pairing: { status: string } };
      expect(polled.pairing.status).to.equal("approved");

      const consume = await fetch(`${baseUrl}/api/wallet/pairing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "consume", nonce: pairing.nonce }),
      });
      expect(consume.status).to.equal(200);
      const consumed = (await consume.json()) as { pairing: { status: string } };
      expect(consumed.pairing.status).to.equal("consumed");
    });
  });

  it("reject expires a pending pairing", async function () {
    await withApp(async (baseUrl) => {
      const wallet = predictWalletAddress(FACTORY, IMPL, deriveWalletSalt(QX, QY));
      const create = await fetch(`${baseUrl}/api/wallet/pairing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", walletAddress: wallet, chainId: "11155111" }),
      });
      const { pairing } = (await create.json()) as { pairing: { nonce: string } };

      const reject = await fetch(`${baseUrl}/api/wallet/pairing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reject", nonce: pairing.nonce }),
      });
      expect(reject.status).to.equal(200);
      const body = (await reject.json()) as { pairing: { status: string } };
      expect(body.pairing.status).to.equal("expired");

      const submit = await fetch(`${baseUrl}/api/wallet/pairing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          nonce: pairing.nonce,
          newOwnerQx: ethersLib.zeroPadValue("0x11", 32),
          newOwnerQy: ethersLib.zeroPadValue("0x12", 32),
          deviceLabel: "iPad",
        }),
      });
      expect(submit.status).to.equal(404);
    });
  });

  it("cannot consume after reject", async function () {
    await withApp(async (baseUrl) => {
      const wallet = predictWalletAddress(FACTORY, IMPL, deriveWalletSalt(QX, QY));
      const create = await fetch(`${baseUrl}/api/wallet/pairing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "create", walletAddress: wallet, chainId: "11155111" }),
      });
      const { pairing } = (await create.json()) as { pairing: { nonce: string } };

      await fetch(`${baseUrl}/api/wallet/pairing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "submit",
          nonce: pairing.nonce,
          newOwnerQx: ethersLib.zeroPadValue("0x21", 32),
          newOwnerQy: ethersLib.zeroPadValue("0x22", 32),
          deviceLabel: "Phone",
        }),
      });

      const reject = await fetch(`${baseUrl}/api/wallet/pairing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reject", nonce: pairing.nonce }),
      });
      const rejected = (await reject.json()) as { pairing: { status: string } };
      expect(rejected.pairing.status).to.equal("expired");

      const consume = await fetch(`${baseUrl}/api/wallet/pairing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "consume", nonce: pairing.nonce }),
      });
      expect(consume.status).to.equal(404);

      const poll = await fetch(`${baseUrl}/api/wallet/pairing`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "poll", nonce: pairing.nonce }),
      });
      const polled = (await poll.json()) as { pairing: { status: string } };
      expect(polled.pairing.status).to.equal("expired");
    });
  });

  it("lazy-expires pairing on get after expiresAt", async function () {
    resetRateLimitBuckets();
    const dir = await mkdtemp(join(tmpdir(), "commerce-wallet-lazy-"));
    try {
      const db = new CommerceDb(join(dir, "test.db"));
      const wallet = predictWalletAddress(FACTORY, IMPL, deriveWalletSalt(QX, QY));
      const pairing = db.createWalletPairing(wallet, "11155111");
      db.setWalletPairingExpiresAt(pairing.nonce, new Date(Date.now() - 1_000).toISOString());
      const got = db.getWalletPairing(pairing.nonce);
      expect(got?.status).to.equal("expired");
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
