import { expect } from "chai";
import { generateKeyPairSync } from "node:crypto";
import { getAddress, Wallet } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import {
  buildOnrampWidgetSession,
  isOnramperSandboxOrigin,
  ONRAMPER_SUPPORTED_PAIRS,
  resolveOnramperAsset,
} from "../commerce/shared/onramper.js";

const { privateKey } = generateKeyPairSync("ed25519");
const SIGNING_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const API_KEY = "pk_test_onramper";

const BASE_ENV = {
  PORT: "0",
  ADMIN_API_KEY: "admin-test",
  SWEEPER_API_KEY: "sweeper-test",
  RATE_LIMIT_CREATE_PER_SECOND: "100",
  RATE_LIMIT_PUBLIC_PER_SECOND: "100",
  EVM_RPC_URL: "https://sepolia.example",
  SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
  FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
  EVM_8453_RPC_URL: "https://base.example",
  EVM_8453_SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
  EVM_8453_FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
} as const;

describe("commerce Onramper / fiat invoices", function () {
  async function withApp(
    env: Record<string, string>,
    fn: (baseUrl: string) => Promise<void>
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "commerce-onramp-"));
    const config = loadConfig({
      ...BASE_ENV,
      DB_PATH: join(dir, "test.db"),
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

  it("public onramp is disabled by default", async function () {
    await withApp({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/onramp`);
      expect(res.status).to.equal(200);
      const body = (await res.json()) as { enabled?: boolean; fiats?: string[]; sandbox?: boolean };
      expect(body.enabled).to.equal(false);
      expect(body.fiats).to.deep.equal([]);
      expect(body.sandbox).to.equal(false);
    });
  });

  it("public onramp reports sandbox for pk_test keys", async function () {
    await withApp(
      {
        ONRAMPER_API_KEY: API_KEY,
        ONRAMPER_SIGNING_KEY: SIGNING_KEY_PEM,
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/public/onramp`);
        const body = (await res.json()) as {
          enabled?: boolean;
          sandbox?: boolean;
          supportedPairs?: Array<{ chainId: string; token: string }>;
        };
        expect(body.enabled).to.equal(true);
        expect(body.sandbox).to.equal(true);
        expect(body.supportedPairs).to.deep.include({ chainId: "11155111", token: "USDC" });
        expect(body.supportedPairs).to.deep.include({ chainId: "nile", token: "USDT" });
        const config = loadConfig({
          ...BASE_ENV,
          ONRAMPER_API_KEY: API_KEY,
          ONRAMPER_SIGNING_KEY: SIGNING_KEY_PEM,
        } as NodeJS.ProcessEnv);
        expect(config.onramper.widgetOrigin).to.equal("https://buy.onramper.dev");
      }
    );
  });

  it("enables demo mode with ONRAMPER_ENABLED=1 and no keys", async function () {
    await withApp({ ONRAMPER_ENABLED: "1" }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/onramp`);
      const body = (await res.json()) as {
        enabled?: boolean;
        sandbox?: boolean;
        demo?: boolean;
      };
      expect(body.enabled).to.equal(true);
      expect(body.sandbox).to.equal(true);
      expect(body.demo).to.equal(true);

      const merchant = getAddress(Wallet.createRandom().address);
      const createRes = await fetch(`${baseUrl}/api/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          price: "5.00",
          to: [merchant],
          chains: ["11155111"],
          tokens: ["USDC"],
          chainId: "11155111",
          token: "USDC",
          selectedTo: merchant,
          paymentMode: "fiat",
        }),
      });
      expect(createRes.status).to.equal(201);
      const created = (await createRes.json()) as { invoice: { id: string } };
      const sessionRes = await fetch(
        `${baseUrl}/api/invoices/${encodeURIComponent(created.invoice.id)}/onramp-session`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fiat: "EUR" }),
        }
      );
      expect(sessionRes.status).to.equal(200);
      const session = (await sessionRes.json()) as { widgetUrl?: string; demo?: boolean };
      expect(session.demo).to.equal(true);
      expect(session.widgetUrl).to.match(/^\/api\/public\/onramp-demo\?/);
      const demoPage = await fetch(`${baseUrl}${session.widgetUrl}`);
      expect(demoPage.status).to.equal(200);
      const html = await demoPage.text();
      expect(html).to.match(/Sandbox demo/i);
    });
  });

  it("stays disabled when ONRAMPER_ENABLED=0 despite keys", async function () {
    await withApp(
      {
        ONRAMPER_ENABLED: "0",
        ONRAMPER_API_KEY: API_KEY,
        ONRAMPER_SIGNING_KEY: SIGNING_KEY_PEM,
      },
      async (baseUrl) => {
        const res = await fetch(`${baseUrl}/api/public/onramp`);
        const body = (await res.json()) as { enabled?: boolean };
        expect(body.enabled).to.equal(false);
      }
    );
  });

  it("rejects paymentMode fiat when Onramper is off", async function () {
    await withApp({}, async (baseUrl) => {
      const merchant = getAddress(Wallet.createRandom().address);
      const res = await fetch(`${baseUrl}/api/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          price: "12.00",
          to: [merchant],
          chains: ["8453"],
          tokens: ["USDC"],
          chainId: "8453",
          token: "USDC",
          selectedTo: merchant,
          paymentMode: "fiat",
        }),
      });
      expect(res.status).to.equal(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error ?? "").to.match(/not enabled|card|bank/i);
    });
  });

  it("rejects fiat create with multiple chains", async function () {
    await withApp(
      {
        ONRAMPER_ENABLED: "1",
        ONRAMPER_API_KEY: API_KEY,
        ONRAMPER_SIGNING_KEY: SIGNING_KEY_PEM,
      },
      async (baseUrl) => {
        const merchant = getAddress(Wallet.createRandom().address);
        const res = await fetch(`${baseUrl}/api/invoices`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            price: "12.00",
            to: [merchant],
            chains: ["8453", "56"],
            tokens: ["USDC"],
            chainId: "8453",
            token: "USDC",
            selectedTo: merchant,
            paymentMode: "fiat",
          }),
        });
        expect(res.status).to.equal(400);
        const body = (await res.json()) as { error?: string };
        expect(body.error ?? "").to.match(/single|one/i);
      }
    );
  });

  it("creates a fiat invoice and returns a signed onramp session", async function () {
    await withApp(
      {
        ONRAMPER_ENABLED: "1",
        ONRAMPER_API_KEY: API_KEY,
        ONRAMPER_SIGNING_KEY: SIGNING_KEY_PEM,
      },
      async (baseUrl) => {
        const pub = await fetch(`${baseUrl}/api/public/onramp`);
        const pubBody = (await pub.json()) as { enabled?: boolean; fiats?: string[] };
        expect(pubBody.enabled).to.equal(true);
        expect(pubBody.fiats).to.include("EUR");

        const merchant = getAddress(Wallet.createRandom().address);
        const createRes = await fetch(`${baseUrl}/api/invoices`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            price: "12.00",
            to: [merchant],
            chains: ["8453"],
            tokens: ["USDC"],
            chainId: "8453",
            token: "USDC",
            selectedTo: merchant,
            paymentMode: "fiat",
          }),
        });
        expect(createRes.status).to.equal(201);
        const created = (await createRes.json()) as {
          invoice: { id: string; paymentMode: string; invoiceAddress: string };
        };
        expect(created.invoice.paymentMode).to.equal("fiat");
        expect(created.invoice.invoiceAddress).to.match(/^0x[0-9a-fA-F]{40}$/);

        const sessionRes = await fetch(
          `${baseUrl}/api/invoices/${encodeURIComponent(created.invoice.id)}/onramp-session`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fiat: "EUR" }),
          }
        );
        expect(sessionRes.status).to.equal(200);
        const session = (await sessionRes.json()) as { widgetUrl?: string; expiresAt?: string };
        expect(session.widgetUrl).to.be.a("string");
        const url = new URL(session.widgetUrl!);
        expect(url.origin).to.equal("https://buy.onramper.dev");
        expect(url.searchParams.get("apiKey")).to.equal(API_KEY);
        expect(url.searchParams.get("wallets")).to.equal(
          `usdc_base:${created.invoice.invoiceAddress}`
        );
        expect(url.searchParams.get("isAddressEditable")).to.equal("false");
        expect(url.searchParams.get("onlyCryptos")).to.equal("usdc_base");
        expect(url.searchParams.get("onlyCryptoNetworks")).to.equal("base");
        expect(url.searchParams.get("onlyFiats")).to.equal("EUR");
        expect(url.searchParams.get("partnerContext")).to.equal(created.invoice.id);
        expect(url.searchParams.get("sigV2")).to.match(/^v2:/);
        expect(session.expiresAt).to.be.a("string");
      }
    );
  });

  it("rejects onramp-session for crypto-only invoices", async function () {
    await withApp(
      {
        ONRAMPER_ENABLED: "1",
        ONRAMPER_API_KEY: API_KEY,
        ONRAMPER_SIGNING_KEY: SIGNING_KEY_PEM,
      },
      async (baseUrl) => {
        const merchant = getAddress(Wallet.createRandom().address);
        const createRes = await fetch(`${baseUrl}/api/invoices`, {
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
            paymentMode: "crypto",
          }),
        });
        expect(createRes.status).to.equal(201);
        const created = (await createRes.json()) as { invoice: { id: string } };

        const sessionRes = await fetch(
          `${baseUrl}/api/invoices/${encodeURIComponent(created.invoice.id)}/onramp-session`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fiat: "USD" }),
          }
        );
        expect(sessionRes.status).to.equal(400);
      }
    );
  });

  it("creates a Sepolia fiat invoice and returns sandbox onramp session", async function () {
    await withApp(
      {
        ONRAMPER_ENABLED: "1",
        ONRAMPER_API_KEY: API_KEY,
        ONRAMPER_SIGNING_KEY: SIGNING_KEY_PEM,
      },
      async (baseUrl) => {
        const merchant = getAddress(Wallet.createRandom().address);
        const createRes = await fetch(`${baseUrl}/api/invoices`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            price: "12.00",
            to: [merchant],
            chains: ["11155111"],
            tokens: ["USDC"],
            chainId: "11155111",
            token: "USDC",
            selectedTo: merchant,
            paymentMode: "fiat",
          }),
        });
        expect(createRes.status).to.equal(201);
        const created = (await createRes.json()) as {
          invoice: { id: string; paymentMode: string; invoiceAddress: string; chainId: string };
        };
        expect(created.invoice.paymentMode).to.equal("fiat");
        expect(created.invoice.chainId).to.equal("11155111");
        expect(created.invoice.invoiceAddress).to.match(/^0x[0-9a-fA-F]{40}$/);

        const sessionRes = await fetch(
          `${baseUrl}/api/invoices/${encodeURIComponent(created.invoice.id)}/onramp-session`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fiat: "EUR" }),
          }
        );
        expect(sessionRes.status).to.equal(200);
        const session = (await sessionRes.json()) as { widgetUrl?: string };
        const url = new URL(session.widgetUrl!);
        expect(url.origin).to.equal("https://buy.onramper.dev");
        expect(url.searchParams.get("wallets")).to.equal(
          `usdc_base:${created.invoice.invoiceAddress}`
        );
      }
    );
  });

  it("maps Base USDC and signs widget URLs", function () {
    expect(resolveOnramperAsset("8453", "USDC")).to.deep.equal({
      cryptoId: "usdc_base",
      networkId: "base",
    });
    expect(resolveOnramperAsset("11155111", "USDC")).to.deep.equal({
      cryptoId: "usdc_base",
      networkId: "base",
    });
    expect(resolveOnramperAsset("nile", "USDT")).to.deep.equal({
      cryptoId: "usdt_tron",
      networkId: "tron",
    });
    expect(ONRAMPER_SUPPORTED_PAIRS.length).to.be.at.least(6);
    expect(isOnramperSandboxOrigin("https://buy.onramper.dev")).to.equal(true);
    expect(isOnramperSandboxOrigin("https://buy.onramper.com")).to.equal(false);
    const session = buildOnrampWidgetSession({
      apiKey: API_KEY,
      signingKeyPem: SIGNING_KEY_PEM,
      widgetOrigin: "https://buy.onramper.com",
      invoiceId: "inv_test",
      invoiceAddress: "0x1111111111111111111111111111111111111111",
      chainId: "8453",
      token: "USDC",
      priceUsd: "10.5",
      fiat: "USD",
      lockFiat: false,
    });
    const url = new URL(session.widgetUrl);
    expect(url.searchParams.get("defaultAmount")).to.equal("10.5");
    expect(url.searchParams.get("sigV2Fields")).to.include("apiKey");
    expect(url.searchParams.has("onlyFiats")).to.equal(false);
  });
});
