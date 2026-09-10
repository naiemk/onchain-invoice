import { expect } from "chai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";

const BASE_ENV = {
  PORT: "0",
  ADMIN_API_KEY: "admin-faucet-test",
  SWEEPER_API_KEY: "sweeper-faucet-test",
  RATE_LIMIT_CREATE_PER_SECOND: "100",
  RATE_LIMIT_PUBLIC_PER_SECOND: "100",
  EVM_RPC_URL: "https://sepolia.example",
  SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
  FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
  EVM_8453_RPC_URL: "https://base.example",
  EVM_8453_SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
  EVM_8453_FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
  SWEEPER_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  FAUCET_SECRET: "test-faucet-secret",
  FAUCET_DRY_RUN: "1",
} as const;

describe("commerce testnet faucet", function () {
  async function withApp(
    env: Record<string, string>,
    fn: (baseUrl: string) => Promise<void>
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "commerce-faucet-"));
    const config = loadConfig({
      ...BASE_ENV,
      ...env,
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

  async function createFiatInvoice(baseUrl: string): Promise<{ id: string; chainId?: string }> {
    const res = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentMode: "fiat",
        price: "10",
        displayFiat: "USD",
        displayAmount: "10",
        to: ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"],
        chains: ["8453"],
        tokens: ["USDC"],
        title: "Faucet test",
      }),
    });
    expect(res.status).to.equal(201);
    const body = (await res.json()) as { invoice: { id: string; chainId?: string } };
    return body.invoice;
  }

  it("public faucet is disabled without secret", async function () {
    await withApp({ FAUCET_SECRET: "" }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/faucet`);
      expect(res.status).to.equal(200);
      const body = (await res.json()) as { enabled: boolean };
      expect(body.enabled).to.equal(false);
    });
  });

  it("public faucet is disabled when FAUCET_ENABLED=0", async function () {
    await withApp({ FAUCET_ENABLED: "0" }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/faucet`);
      expect(res.status).to.equal(200);
      const body = (await res.json()) as { enabled: boolean };
      expect(body.enabled).to.equal(false);
    });
  });

  it("public faucet enabled with secret + dry-run", async function () {
    await withApp({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/faucet`);
      expect(res.status).to.equal(200);
      const body = (await res.json()) as { enabled: boolean };
      expect(body.enabled).to.equal(true);
    });
  });

  it("rejects wrong secret", async function () {
    await withApp({}, async (baseUrl) => {
      const invoice = await createFiatInvoice(baseUrl);
      const res = await fetch(`${baseUrl}/api/invoices/${invoice.id}/faucet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: "wrong" }),
      });
      expect(res.status).to.equal(403);
      const body = (await res.json()) as { code?: string };
      expect(body.code).to.equal("faucet_forbidden");
    });
  });

  it("rejects crypto payment mode", async function () {
    await withApp({}, async (baseUrl) => {
      const create = await fetch(`${baseUrl}/api/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paymentMode: "crypto",
          price: "1",
          to: ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"],
          chains: ["11155111"],
          tokens: ["USDC"],
        }),
      });
      expect(create.status).to.equal(201);
      const created = (await create.json()) as { invoice: { id: string } };
      const res = await fetch(`${baseUrl}/api/invoices/${created.invoice.id}/faucet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: "test-faucet-secret" }),
      });
      expect(res.status).to.equal(400);
      const body = (await res.json()) as { code?: string };
      expect(body.code).to.equal("faucet_payment_mode");
    });
  });

  it("rejects faucet for Base fiat invoices", async function () {
    await withApp({}, async (baseUrl) => {
      const invoice = await createFiatInvoice(baseUrl);
      expect(invoice.chainId).to.equal("8453");
      const res = await fetch(`${baseUrl}/api/invoices/${invoice.id}/faucet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret: "test-faucet-secret" }),
      });
      expect(res.status).to.equal(400);
      const body = (await res.json()) as { code?: string };
      expect(body.code).to.equal("faucet_mainnet");
    });
  });
});
