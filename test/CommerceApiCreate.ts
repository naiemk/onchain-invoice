import { expect } from "chai";
import { getAddress, Wallet } from "ethers";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { randomInvoiceSeed } from "../src/index.js";

describe("commerce API create invoice (EVM multi-chain)", function () {
  it("returns 503 when Base sweeper/forwarder are unset", async function () {
    const config = loadConfig({
      PORT: "0",
      DB_PATH: ":memory:",
      ADMIN_API_KEY: "admin-test",
      SWEEPER_API_KEY: "sweeper-test",
      RATE_LIMIT_CREATE_PER_SECOND: "100",
      RATE_LIMIT_PUBLIC_PER_SECOND: "100",
      // Sepolia configured — Base intentionally missing
      EVM_RPC_URL: "https://sepolia.example",
      SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
      FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
    } as NodeJS.ProcessEnv);

    const app = createApp(config);
    await new Promise<void>((resolve) => {
      app.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const merchant = getAddress(Wallet.createRandom().address);

    try {
      const res = await fetch(`${baseUrl}/api/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          price: "1.00",
          to: [merchant],
          chains: ["8453"],
          tokens: ["USDC"],
          invoiceSeed: randomInvoiceSeed(),
          chainId: "8453",
          token: "USDC",
          selectedTo: merchant,
        }),
      });
      expect(res.status).to.equal(503);
      const body = (await res.json()) as { error?: string };
      expect(body.error ?? "").to.match(/8453|not configured/i);
    } finally {
      await app.close();
    }
  });

  it("creates a Sepolia invoice when legacy sweeper + forwarder are set", async function () {
    const config = loadConfig({
      PORT: "0",
      DB_PATH: ":memory:",
      ADMIN_API_KEY: "admin-test",
      SWEEPER_API_KEY: "sweeper-test",
      RATE_LIMIT_CREATE_PER_SECOND: "100",
      RATE_LIMIT_PUBLIC_PER_SECOND: "100",
      EVM_RPC_URL: "https://sepolia.example",
      SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
      FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
    } as NodeJS.ProcessEnv);

    const app = createApp(config);
    await new Promise<void>((resolve) => {
      app.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const merchant = getAddress(Wallet.createRandom().address);

    try {
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
      expect(res.status).to.be.oneOf([200, 201]);
      const body = (await res.json()) as {
        invoice?: { invoiceAddress?: string; chainId?: string };
        invoiceAddress?: string;
      };
      const invoiceAddress = body.invoice?.invoiceAddress ?? body.invoiceAddress;
      expect(invoiceAddress).to.match(/^0x[0-9a-fA-F]{40}$/);
      expect(body.invoice?.chainId).to.equal("11155111");
    } finally {
      await app.close();
    }
  });
});
