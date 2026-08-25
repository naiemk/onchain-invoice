import { expect } from "chai";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { clearOnrampQuoteCaches } from "../commerce/shared/onramper-quotes.js";

const { privateKey } = generateKeyPairSync("ed25519");
const SIGNING_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

const BASE_ENV = {
  PORT: "0",
  ADMIN_API_KEY: "admin-faucet-test",
  SWEEPER_API_KEY: "sweeper-faucet-test",
  RATE_LIMIT_CREATE_PER_SECOND: "100",
  RATE_LIMIT_PUBLIC_PER_SECOND: "100",
  EVM_RPC_URL: "https://sepolia.example",
  SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
  FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
  SWEEPER_PRIVATE_KEY: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  ONRAMPER_ENABLED: "1",
  ONRAMPER_API_KEY: "pk_test_faucet",
  ONRAMPER_SIGNING_KEY: SIGNING_KEY_PEM,
  FAUCET_SECRET: "test-faucet-secret",
  FAUCET_DRY_RUN: "1",
} as const;

function withMockedOnramperQuotes<T>(fn: () => Promise<T>): Promise<T> {
  clearOnrampQuoteCaches();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/quotes/")) {
      const u = new URL(url);
      const amount = Number(u.searchParams.get("amount") || "10");
      return new Response(
        JSON.stringify([
          {
            ramp: "moonpay",
            paymentMethod: "creditcard",
            rate: 1,
            payout: amount,
            inAmount: amount,
            recommendations: ["BestPrice"],
            quoteId: "q-faucet",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } }
      );
    }
    return originalFetch(input, init);
  };
  return fn().finally(() => {
    globalThis.fetch = originalFetch;
  });
}

describe("commerce testnet faucet", function () {
  async function withApp(
    env: Record<string, string>,
    fn: (baseUrl: string) => Promise<void>
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "commerce-faucet-"));
    const config = loadConfig({
      ...process.env,
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

  async function createFiatInvoice(baseUrl: string): Promise<{ id: string }> {
    const res = await fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentMode: "fiat",
        displayFiat: "USD",
        displayAmount: "10",
        to: ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"],
        chains: ["11155111"],
        tokens: ["USDC"],
        title: "Faucet test",
      }),
    });
    expect(res.status).to.equal(201);
    const body = (await res.json()) as { invoice: { id: string } };
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
    await withMockedOnramperQuotes(async () => {
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

  it("funds fiat testnet invoice in dry-run", async function () {
    await withMockedOnramperQuotes(async () => {
      await withApp({}, async (baseUrl) => {
        const invoice = await createFiatInvoice(baseUrl);
        const res = await fetch(`${baseUrl}/api/invoices/${invoice.id}/faucet`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ secret: "test-faucet-secret" }),
        });
        expect(res.status).to.equal(200);
        const body = (await res.json()) as {
          ok: boolean;
          txHash: string;
          chainId: string;
          dryRun: boolean;
        };
        expect(body.ok).to.equal(true);
        expect(body.dryRun).to.equal(true);
        expect(body.chainId).to.equal("11155111");
        expect(body.txHash).to.match(/^0xdryrun/);
      });
    });
  });
});
