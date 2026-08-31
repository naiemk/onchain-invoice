import { expect } from "chai";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { getAddress, Wallet, zeroPadValue } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import {
  buildOnrampWidgetSession,
  buildOnramperWidgetSession,
  isOnramperSandboxOrigin,
  listOnramperEvmWalletAssets,
  ONRAMPER_SUPPORTED_PAIRS,
  resolveOnramperAsset,
  resolveProductAssetFromOnramperCryptoId,
  signWidgetUrlV1,
} from "../commerce/shared/onramper.js";
import { clearOnrampQuoteCaches } from "../commerce/shared/onramper-quotes.js";
import { deriveWalletSalt, predictWalletAddress } from "../commerce/shared/wallet-address.js";

const { privateKey } = generateKeyPairSync("ed25519");
const SIGNING_KEY_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const API_KEY = "pk_test_onramper";

const BASE_ENV = {
  PORT: "0",
  ADMIN_API_KEY: "admin-test",
  SWEEPER_API_KEY: "sweeper-test",
  RATE_LIMIT_CREATE_PER_SECOND: "100",
  RATE_LIMIT_PUBLIC_PER_SECOND: "100",
  RATE_LIMIT_QUOTE_PER_SECOND: "100",
  RATE_LIMIT_QUOTE_BURST: "100",
  EVM_RPC_URL: "https://sepolia.example",
  SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
  FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
  EVM_8453_RPC_URL: "https://base.example",
  EVM_8453_SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
  EVM_8453_FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
  EVM_1_RPC_URL: "https://ethereum.example",
  EVM_1_SWEEPER_ADDRESS: "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9",
  EVM_1_FORWARDER_IMPLEMENTATION: "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9",
} as const;

/** Stable Onramper /quotes responses so create+session tests do not hit the live API. */
function withMockedOnramperQuotes<T>(fn: () => Promise<T>, payoutForAmount?: (amount: number) => number): Promise<T> {
  clearOnrampQuoteCaches();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.includes("/quotes/")) {
      const u = new URL(url);
      const amount = Number(u.searchParams.get("amount") || "0");
      const inputSide = u.searchParams.get("input") || "source";
      const payout = (payoutForAmount ?? ((n) => n))(amount);
      const inAmount = inputSide === "source" ? amount : payout * (amount > 0 ? amount / payout : 1);
      const fiatIn = inputSide === "source" ? amount : inAmount;
      const cryptoOut = inputSide === "destination" ? amount : payout;
      return new Response(
        JSON.stringify([
          {
            ramp: "moonpay",
            paymentMethod: "creditcard",
            rate: fiatIn / (cryptoOut || 1),
            payout: cryptoOut,
            inAmount: fiatIn,
            recommendations: ["BestPrice"],
            quoteId: "q-mock",
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
          displayFiat: "USD",
          displayAmount: "5.00",
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
          displayFiat: "USD",
          displayAmount: "12.00",
          paymentMode: "fiat",
        }),
      });
      expect(res.status).to.equal(400);
      const body = (await res.json()) as { error?: string };
      expect(body.error ?? "").to.match(/not enabled|card|bank/i);
    });
  });

  it("allows fiat create with multiple Onramper-supported chains", async function () {
    await withApp(
      {
        ONRAMPER_ENABLED: "1",
        ONRAMPER_API_KEY: API_KEY,
        ONRAMPER_SIGNING_KEY: SIGNING_KEY_PEM,
      },
      async (baseUrl) => {
        clearOnrampQuoteCaches();
        const originalFetch = globalThis.fetch;
        globalThis.fetch = async (input, init) => {
          const url = String(input);
          if (url.includes("/quotes/")) {
            return new Response(
              JSON.stringify([
                {
                  ramp: "revolut",
                  paymentMethod: "revolutpay",
                  rate: 1,
                  payout: 12,
                  inAmount: 12,
                  recommendations: ["BestPrice"],
                  quoteId: "q-multi",
                },
              ]),
              { status: 200, headers: { "content-type": "application/json" } }
            );
          }
          return originalFetch(input, init);
        };
        try {
          const merchant = getAddress(Wallet.createRandom().address);
          const tron = "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
          const res = await fetch(`${baseUrl}/api/invoices`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              to: [merchant, tron],
              chains: ["1", "8453", "tron"],
              tokens: ["USDC", "USDT"],
              chainId: "1",
              token: "USDC",
              selectedTo: merchant,
              displayFiat: "USD",
              displayAmount: "12.00",
              quotePaymentMethod: "revolutpay",
              paymentMode: "fiat",
            }),
          });
          expect(res.status).to.equal(201);
          const body = (await res.json()) as { invoice: { chainId: string; token: string } };
          expect(body.invoice.chainId).to.equal("1");
          expect(body.invoice.token).to.equal("USDC");
        } finally {
          globalThis.fetch = originalFetch;
        }
      }
    );
  });

  it("creates a fiat invoice and returns a signed onramp session", async function () {
    await withMockedOnramperQuotes(async () => {
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
          displayFiat: "USD",
          displayAmount: "12.00",
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
        expect(url.searchParams.get("onlyFiats")).to.equal("USD");
        expect(url.searchParams.get("defaultAmount")).to.equal("12");
        expect(url.searchParams.get("partnerContext")).to.equal(created.invoice.id);
        expect(url.searchParams.get("sigV2")).to.match(/^v2:/);
        expect(session.expiresAt).to.be.a("string");
      }
    );
    });
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
    await withMockedOnramperQuotes(async () => {
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
          displayFiat: "USD",
          displayAmount: "12.00",
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
    expect(resolveOnramperAsset("1", "USDC")).to.deep.equal({
      cryptoId: "usdc_ethereum",
      networkId: "ethereum",
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

  it("signs widget URLs with HMAC V1 when the secret is not a PEM", function () {
    const hmacSecret = "0".repeat(64);
    const session = buildOnrampWidgetSession({
      apiKey: API_KEY,
      signingKeyPem: hmacSecret,
      widgetOrigin: "https://buy.onramper.dev",
      invoiceId: "inv_hmac",
      invoiceAddress: "0x1111111111111111111111111111111111111111",
      chainId: "8453",
      token: "USDC",
      priceUsd: "25",
      fiat: "EUR",
      displayAmount: "230",
      lockFiat: true,
    });
    const url = new URL(session.widgetUrl);
    expect(url.origin).to.equal("https://buy.onramper.dev");
    expect(url.searchParams.has("sigV2")).to.equal(false);
    const wallets = url.searchParams.get("wallets");
    const networkWallets = url.searchParams.get("networkWallets");
    expect(wallets).to.equal("usdc_base:0x1111111111111111111111111111111111111111");
    const signContent = `networkWallets=${networkWallets}&wallets=${wallets}`;
    const expected = createHmac("sha256", hmacSecret).update(signContent).digest("hex");
    expect(url.searchParams.get("signature")).to.equal(expected);
    const signed = signWidgetUrlV1({
      baseUrl: "https://buy.onramper.dev",
      hmacSecret,
      fields: { apiKey: API_KEY, wallets: wallets!, networkWallets: networkWallets! },
    });
    expect(new URL(signed.url).searchParams.get("signature")).to.equal(expected);
  });

  it("returns demo onramp quotes when enabled without keys", async function () {
    clearOnrampQuoteCaches();
    await withApp({ ONRAMPER_ENABLED: "1" }, async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/api/public/onramp-quote?fiat=SEK&chainId=8453&token=USDC&country=se&paymentMethod=creditcard&direction=receive&cryptoAmount=100`
      );
      expect(res.status).to.equal(200);
      const body = (await res.json()) as {
        demo?: boolean;
        fiat?: string;
        fiatAmount?: string;
        cryptoAmount?: string;
        recommended?: { fiatAmount: string };
      };
      expect(body.demo).to.equal(true);
      expect(body.fiat).to.equal("SEK");
      expect(body.cryptoAmount).to.equal("100");
      expect(Number(body.fiatAmount)).to.be.greaterThan(1000);
      expect(body.recommended?.fiatAmount).to.equal(body.fiatAmount);
    });
  });

  it("persists display fiat fields on fiat invoice create", async function () {
    clearOnrampQuoteCaches();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/quotes/")) {
        return new Response(
          JSON.stringify([
            {
              ramp: "moonpay",
              paymentMethod: "creditcard",
              rate: 14.875,
              payout: 100,
              inAmount: 1487.5,
              recommendations: ["BestPrice"],
              quoteId: "q-stable",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    };
    try {
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
          price: "100",
          to: [merchant],
          chains: ["8453"],
          tokens: ["USDC"],
          chainId: "8453",
          token: "USDC",
          selectedTo: merchant,
          paymentMode: "fiat",
          displayFiat: "SEK",
          displayAmount: "1487.50",
          quoteCountry: "se",
          quotePaymentMethod: "creditcard",
          quoteProvider: "moonpay",
          quoteSlippageBps: 100,
        }),
      });
      expect(createRes.status).to.equal(201);
      const created = (await createRes.json()) as {
        invoice: {
          id: string;
          displayFiat: string | null;
          displayAmount: string | null;
          quoteCountry: string | null;
          quotePaymentMethod: string | null;
          quoteProvider: string | null;
          priceUsd: string;
        };
      };
      expect(created.invoice.displayFiat).to.equal("SEK");
      expect(created.invoice.displayAmount).to.equal("1487.5");
      expect(created.invoice.quoteCountry).to.equal("se");
      expect(created.invoice.quotePaymentMethod).to.equal("creditcard");
      expect(created.invoice.quoteProvider).to.equal("moonpay");
      // Settlement is quote crypto with a small buffer so fee variance cannot strand payment.
      expect(created.invoice.priceUsd).to.equal("99.9");

      const getRes = await fetch(`${baseUrl}/api/invoices/${encodeURIComponent(created.invoice.id)}`);
      const fetched = (await getRes.json()) as { displayFiat: string };
      expect(fetched.displayFiat).to.equal("SEK");

      const sessionRes = await fetch(
        `${baseUrl}/api/invoices/${encodeURIComponent(created.invoice.id)}/onramp-session`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ fiat: "EUR", theme: "dark" }),
        }
      );
      expect(sessionRes.status).to.equal(200);
      const session = (await sessionRes.json()) as { widgetUrl?: string };
      const url = new URL(session.widgetUrl!);
      expect(url.searchParams.get("onlyFiats")).to.equal("SEK");
      expect(url.searchParams.get("defaultAmount")).to.equal("1487.5");
      expect(url.searchParams.get("defaultPaymentMethod")).to.equal("creditcard");
      expect(url.searchParams.get("onlyOnramps")).to.equal("moonpay");
      expect(url.searchParams.get("themeName")).to.equal("dark");
      expect(url.searchParams.get("isAmountEditable")).to.equal("true");
      }
    );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("expires onramp session when settlement drifts past slippage", async function () {
    clearOnrampQuoteCaches();
    const originalFetch = globalThis.fetch;
    let quoteCalls = 0;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/quotes/")) {
        quoteCalls += 1;
        const crypto = quoteCalls === 1 ? 100 : 90; // 10% worse on requote
        return new Response(
          JSON.stringify([
            {
              ramp: "moonpay",
              paymentMethod: "creditcard",
              rate: 10.5,
              payout: crypto,
              inAmount: 1487.5,
              recommendations: ["BestPrice"],
              quoteId: `q${quoteCalls}`,
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    };
    try {
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
              to: [merchant],
              chains: ["8453"],
              tokens: ["USDC"],
              chainId: "8453",
              token: "USDC",
              selectedTo: merchant,
              paymentMode: "fiat",
              displayFiat: "SEK",
              displayAmount: "1487.50",
              quoteCountry: "se",
              quotePaymentMethod: "creditcard",
              quoteProvider: "moonpay",
              quoteSlippageBps: 100, // 1%
            }),
          });
          expect(createRes.status).to.equal(201);
          const created = (await createRes.json()) as {
            invoice: { id: string; priceUsd: string; quoteProvider: string | null; quoteSlippageBps: number | null };
          };
          expect(created.invoice.quoteProvider).to.equal("moonpay");
          expect(created.invoice.quoteSlippageBps).to.equal(100);

          const sessionRes = await fetch(
            `${baseUrl}/api/invoices/${encodeURIComponent(created.invoice.id)}/onramp-session`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ fiat: "SEK" }),
            }
          );
          expect(sessionRes.status).to.equal(410);
          const body = (await sessionRes.json()) as { code?: string; error?: string };
          expect(body.code).to.equal("quote_expired");
          expect(body.error ?? "").to.match(/expired|try again/i);
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("locks onlyOnramps to the create-time provider when within slippage", async function () {
    clearOnrampQuoteCaches();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      if (url.includes("/quotes/")) {
        return new Response(
          JSON.stringify([
            {
              ramp: "moonpay",
              paymentMethod: "creditcard",
              rate: 1,
              payout: 100,
              inAmount: 100,
              recommendations: ["BestPrice"],
              quoteId: "q-lock",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return originalFetch(input, init);
    };
    try {
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
              price: "100",
              to: [merchant],
              chains: ["8453"],
              tokens: ["USDC"],
              chainId: "8453",
              token: "USDC",
              selectedTo: merchant,
              paymentMode: "fiat",
              displayFiat: "USD",
              displayAmount: "100",
              quoteCountry: "us",
              quotePaymentMethod: "creditcard",
              quoteProvider: "moonpay",
              quoteSlippageBps: 500,
            }),
          });
          expect(createRes.status).to.equal(201);
          const created = (await createRes.json()) as { invoice: { id: string; quoteProvider: string | null } };
          expect(created.invoice.quoteProvider).to.equal("moonpay");

          const sessionRes = await fetch(
            `${baseUrl}/api/invoices/${encodeURIComponent(created.invoice.id)}/onramp-session`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ fiat: "USD" }),
            }
          );
          expect(sessionRes.status).to.equal(200);
          const session = (await sessionRes.json()) as { widgetUrl?: string };
          const url = new URL(session.widgetUrl!);
          expect(url.searchParams.get("onlyOnramps")).to.equal("moonpay");
          expect(url.searchParams.get("defaultAmount")).to.equal("100");
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("proxies live Onramper quote responses", async function () {
    clearOnrampQuoteCaches();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/quotes/sek/usdc_base")) {
        return new Response(
          JSON.stringify([
            {
              ramp: "moonpay",
              paymentMethod: "creditcard",
              rate: 10.5,
              payout: 100,
              recommendations: ["BestPrice"],
              quoteId: "q1",
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return originalFetch(input);
    };
    try {
      await withApp(
        {
          ONRAMPER_ENABLED: "1",
          ONRAMPER_API_KEY: API_KEY,
          ONRAMPER_SIGNING_KEY: SIGNING_KEY_PEM,
        },
        async (baseUrl) => {
          const res = await fetch(
            `${baseUrl}/api/public/onramp-quote?fiat=SEK&chainId=8453&token=USDC&country=se&paymentMethod=creditcard&direction=receive&cryptoAmount=100`
          );
          expect(res.status).to.equal(200);
          const body = (await res.json()) as {
            demo?: boolean;
            recommended?: { provider: string; cryptoAmount: string };
          };
          expect(body.demo).to.not.equal(true);
          expect(body.recommended?.provider).to.equal("moonpay");
          expect(body.recommended?.cryptoAmount).to.equal("100");
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("returns structured LimitMismatch when amount is below Onramper min", async function () {
    clearOnrampQuoteCaches();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      const url = String(input);
      if (url.includes("/quotes/sek/usdc_base")) {
        return new Response(
          JSON.stringify([
            {
              ramp: "moonpay",
              paymentMethod: "creditcard",
              availablePaymentMethods: [
                {
                  paymentTypeId: "creditcard",
                  details: { limits: { aggregatedLimit: { min: 250, max: 105000 } } },
                },
              ],
              errors: [
                {
                  type: "LimitMismatch",
                  errorId: 6101,
                  message: "Amount should be in between SEK 250 and SEK 105000",
                  minAmount: 250,
                  maxAmount: 105000,
                },
              ],
            },
            {
              ramp: "stripe",
              paymentMethod: "creditcard",
              errors: [{ type: "NoSupportedPayments", message: "No supported payments found" }],
            },
          ]),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      }
      return originalFetch(input);
    };
    try {
      await withApp(
        {
          ONRAMPER_ENABLED: "1",
          ONRAMPER_API_KEY: API_KEY,
          ONRAMPER_SIGNING_KEY: SIGNING_KEY_PEM,
        },
        async (baseUrl) => {
          const res = await fetch(
            `${baseUrl}/api/public/onramp-quote?fiat=SEK&chainId=8453&token=USDC&country=se&paymentMethod=creditcard&direction=pay&fiatAmount=100`
          );
          expect(res.status).to.equal(400);
          const body = (await res.json()) as {
            error?: string;
            code?: string;
            fiat?: string;
            minAmount?: number;
            maxAmount?: number;
            errorId?: number;
            type?: string;
          };
          expect(body.code).to.equal("onramp_limit_mismatch");
          expect(body.fiat).to.equal("SEK");
          expect(body.minAmount).to.equal(250);
          expect(body.maxAmount).to.equal(105000);
          expect(body.errorId).to.equal(6101);
          expect(body.type).to.equal("LimitMismatch");
          expect(body.error).to.include("250");
        }
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("accepts chains+tokens aliases and always returns chainId/token", async function () {
    clearOnrampQuoteCaches();
    await withApp({ ONRAMPER_ENABLED: "1" }, async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/api/public/onramp-quote?fiat=USD&direction=receive&cryptoAmount=25&country=us&chains=11155111,8453&tokens=USDC&slippageBps=100`
      );
      expect(res.status).to.equal(200);
      const body = (await res.json()) as {
        chainId?: string;
        token?: string;
        country?: string;
        paymentMethod?: string;
        provider?: string;
        cryptoAmount?: string;
        minSettlement?: string;
        maxSettlement?: string;
        slippageBps?: number;
      };
      expect(body.chainId).to.be.a("string").and.not.empty;
      expect(body.token).to.equal("USDC");
      expect(body.country).to.equal("us");
      expect(body.cryptoAmount).to.equal("25");
      expect(body.slippageBps).to.equal(100);
      expect(Number(body.minSettlement)).to.be.lessThan(25);
      expect(Number(body.maxSettlement)).to.be.greaterThan(25);
    });
  });

  it("lists EVM wallet assets including USDT on BNB and reverses crypto ids", function () {
    const assets = listOnramperEvmWalletAssets(["8453", "56", "11155111"]);
    expect(assets.some((a) => a.cryptoId === "usdc_base")).to.equal(true);
    expect(assets.some((a) => a.cryptoId === "usdt_bsc")).to.equal(true);
    expect(assets.some((a) => a.networkId === "tron")).to.equal(false);
    expect(resolveProductAssetFromOnramperCryptoId("usdt_bsc")).to.deep.equal({
      chainId: "56",
      token: "USDT",
    });
  });

  it("builds buy sessions for wallet destinations with multi-asset locks", function () {
    const assets = listOnramperEvmWalletAssets(["8453", "56"]);
    const session = buildOnramperWidgetSession({
      apiKey: API_KEY,
      signingKeyPem: SIGNING_KEY_PEM,
      widgetOrigin: "https://buy.onramper.com",
      mode: "buy",
      partnerContext: "wallet:0x1111111111111111111111111111111111111111",
      walletAddress: "0x1111111111111111111111111111111111111111",
      assets,
      fiat: "USD",
      defaultAmount: "40",
    });
    const url = new URL(session.widgetUrl);
    expect(url.searchParams.get("mode")).to.equal("buy");
    expect(url.searchParams.get("defaultAmount")).to.equal("40");
    expect(url.searchParams.get("onlyCryptos")).to.include("usdc_base");
    expect(url.searchParams.get("onlyCryptos")).to.include("usdt_bsc");
    expect(url.searchParams.get("wallets")).to.include("usdc_base:0x1111111111111111111111111111111111111111");
  });

  it("builds sell sessions with cashout redirect and max crypto", function () {
    const assets = listOnramperEvmWalletAssets(["8453"]);
    const session = buildOnramperWidgetSession({
      apiKey: API_KEY,
      signingKeyPem: SIGNING_KEY_PEM,
      widgetOrigin: "https://buy.onramper.com",
      mode: "sell",
      partnerContext: "wallet:0x2222222222222222222222222222222222222222",
      walletAddress: "0x2222222222222222222222222222222222222222",
      assets,
      fiat: "EUR",
      offrampCashoutRedirectUrl: "https://app.example/wallet/offramp/cashout",
      maxAvailableCrypto: "12.5",
    });
    const url = new URL(session.widgetUrl);
    expect(url.searchParams.get("mode")).to.equal("sell");
    expect(url.searchParams.get("sell_defaultCrypto")).to.equal("usdc_base");
    expect(url.searchParams.get("sell_maxAvailableCrypto")).to.equal("12.5");
    expect(url.searchParams.get("offrampCashoutRedirectUrl")).to.equal(
      "https://app.example/wallet/offramp/cashout"
    );
  });

  it("returns demo wallet onramp/offramp sessions for registered wallets", async function () {
    const factory = "0x06964dE197ed29A4DC2D34F68aD4510Afa25f537";
    const impl = "0xe024cE8ed1878dBdd3ca8E73B1e586c4E46dC85C";
    const qx = zeroPadValue("0x0a", 32);
    const qy = zeroPadValue("0x0b", 32);
    const salt = deriveWalletSalt(qx, qy);
    const walletAddress = predictWalletAddress(factory, impl, salt);

    await withApp(
      {
        ONRAMPER_ENABLED: "1",
        WALLET_FACTORY_ADDRESS: factory,
        WALLET_IMPLEMENTATION_ADDRESS: impl,
        WALLET_RECOVERY_ADDRESS: "0x72739889bcce2B08a23212bae6C7B9F1C29e7873",
      },
      async (baseUrl) => {
        const reg = await fetch(`${baseUrl}/api/wallet/accounts`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            address: walletAddress,
            salt,
            ownerQx: qx,
            ownerQy: qy,
            credentialId: "cred-onramp-wallet",
          }),
        });
        expect(reg.status).to.equal(201);

        const missing = await fetch(`${baseUrl}/api/wallet/onramp-session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            walletAddress: "0x1111111111111111111111111111111111111111",
            fiat: "USD",
          }),
        });
        expect(missing.status).to.equal(400);

        const onramp = await fetch(`${baseUrl}/api/wallet/onramp-session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ walletAddress, fiat: "USD" }),
        });
        expect(onramp.status).to.equal(200);
        const onrampBody = (await onramp.json()) as { widgetUrl?: string; demo?: boolean };
        expect(onrampBody.demo).to.equal(true);
        expect(onrampBody.widgetUrl).to.include("/api/public/onramp-demo");
        expect(onrampBody.widgetUrl).to.include("walletAddress");

        const offramp = await fetch(`${baseUrl}/api/wallet/offramp-session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ walletAddress, fiat: "EUR" }),
        });
        expect(offramp.status).to.equal(200);
        const offrampBody = (await offramp.json()) as { widgetUrl?: string; demo?: boolean };
        expect(offrampBody.demo).to.equal(true);
        expect(offrampBody.widgetUrl).to.include("mode=sell");
      }
    );
  });
});
