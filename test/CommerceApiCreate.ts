import { expect } from "chai";
import { getAddress, Wallet } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { CommerceDb } from "../commerce/server/db.js";
import { getCommerceInvoiceId, randomInvoiceSeed } from "../src/index.js";

describe("commerce API create invoice (EVM multi-chain)", function () {
  async function withApp(
    env: Record<string, string>,
    fn: (baseUrl: string) => Promise<void>
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "commerce-api-"));
    const config = loadConfig({
      PORT: "0",
      DB_PATH: join(dir, "test.db"),
      ADMIN_API_KEY: "admin-test",
      SWEEPER_API_KEY: "sweeper-test",
      RATE_LIMIT_CREATE_PER_SECOND: "100",
      RATE_LIMIT_PUBLIC_PER_SECOND: "100",
      ...env,
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

  it("returns 503 when Base sweeper/forwarder are unset", async function () {
    await withApp(
      {
        EVM_RPC_URL: "https://sepolia.example",
        SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
        FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
      },
      async (baseUrl) => {
        const merchant = getAddress(Wallet.createRandom().address);
        const res = await fetch(`${baseUrl}/api/invoices`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            price: "1.00",
            to: [merchant],
            chains: ["8453"],
            tokens: ["USDC"],
            chainId: "8453",
            token: "USDC",
            selectedTo: merchant,
          }),
        });
        expect(res.status).to.equal(503);
        const body = (await res.json()) as { error?: string };
        expect(body.error ?? "").to.match(/8453|not configured/i);
      }
    );
  });

  it("creates a Sepolia invoice when legacy sweeper + forwarder are set", async function () {
    await withApp(
      {
        EVM_RPC_URL: "https://sepolia.example",
        SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
        FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
      },
      async (baseUrl) => {
        const merchant = getAddress(Wallet.createRandom().address);
        const res = await fetch(`${baseUrl}/api/invoices`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            price: "1.00",
            to: [merchant],
            chains: ["11155111"],
            tokens: ["USDC"],
            chainId: "11155111",
            token: "USDC",
            selectedTo: merchant,
          }),
        });
        expect(res.status).to.equal(201);
        const body = (await res.json()) as {
          invoice?: { id?: string; invoiceAddress?: string; chainId?: string; invoiceSeed?: string };
          payLink?: string;
          created?: boolean;
        };
        expect(body.created).to.equal(true);
        expect(body.invoice?.invoiceAddress).to.match(/^0x[0-9a-fA-F]{40}$/);
        expect(body.invoice?.chainId).to.equal("11155111");
        expect(body.invoice?.invoiceSeed).to.match(/^0x[0-9a-fA-F]{64}$/);
        expect(body.payLink).to.equal(`/pay?id=${body.invoice?.id}`);
        expect(body.payLink ?? "").to.not.include("invoice_seed");
      }
    );
  });

  it("rejects client-supplied invoiceSeed", async function () {
    await withApp(
      {
        EVM_RPC_URL: "https://sepolia.example",
        SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
        FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
      },
      async (baseUrl) => {
        const merchant = getAddress(Wallet.createRandom().address);
        const res = await fetch(`${baseUrl}/api/invoices`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            price: "1.00",
            to: [merchant],
            chains: ["11155111"],
            tokens: ["USDC"],
            invoiceSeed: randomInvoiceSeed(),
            chainId: "11155111",
            token: "USDC",
            selectedTo: merchant,
          }),
        });
        expect(res.status).to.equal(400);
        const body = (await res.json()) as { error?: string };
        expect(body.error ?? "").to.match(/server-assigned/i);
      }
    );
  });

  it("rejects duplicate invoice ids with 409", async function () {
    const dir = await mkdtemp(join(tmpdir(), "commerce-dup-"));
    try {
      const db = new CommerceDb(join(dir, "test.db"));
      const merchant = getAddress(Wallet.createRandom().address);
      const seed = randomInvoiceSeed();
      const fields = {
        price: "1.00",
        to: [merchant],
        chains: ["11155111"],
        tokens: ["USDC"],
        invoiceSeed: seed,
        allowPartial: false,
      };
      const invoiceId = getCommerceInvoiceId({ invoiceSeed: seed, toAddresses: [merchant] });
      const first = db.createInvoice({
        invoiceId,
        fields,
        chainId: "11155111",
        token: "USDC",
        selectedTo: merchant,
        invoiceAddress: "0x0000000000000000000000000000000000000001",
      });
      expect(first.created).to.equal(true);

      let status = 0;
      try {
        db.createInvoice({
          invoiceId,
          fields,
          chainId: "11155111",
          token: "USDC",
          selectedTo: merchant,
          invoiceAddress: "0x0000000000000000000000000000000000000001",
        });
      } catch (error) {
        status = (error as { statusCode?: number }).statusCode ?? 0;
      }
      expect(status).to.equal(409);

      const retry = db.createInvoice({
        invoiceId: getCommerceInvoiceId({ invoiceSeed: randomInvoiceSeed(), toAddresses: [merchant] }),
        fields: { ...fields, invoiceSeed: randomInvoiceSeed() },
        chainId: "11155111",
        token: "USDC",
        selectedTo: merchant,
        invoiceAddress: "0x0000000000000000000000000000000000000002",
        idempotencyKey: "same-key",
      });
      const again = db.createInvoice({
        invoiceId: getCommerceInvoiceId({ invoiceSeed: randomInvoiceSeed(), toAddresses: [merchant] }),
        fields: { ...fields, invoiceSeed: randomInvoiceSeed() },
        chainId: "11155111",
        token: "USDC",
        selectedTo: merchant,
        invoiceAddress: "0x0000000000000000000000000000000000000003",
        idempotencyKey: "same-key",
      });
      expect(again.created).to.equal(false);
      expect(again.invoice.id).to.equal(retry.invoice.id);
      db.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
