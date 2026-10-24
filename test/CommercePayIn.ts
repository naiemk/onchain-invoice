import { expect } from "chai";
import { Wallet } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import {
  countryFromGeoHeaders,
  isPayInSettlement,
  matchCountryFromGeo,
  PAY_IN_CHAIN_ID,
  PAY_IN_TOKEN,
  PAY_IN_TOKEN_ADDRESS,
  type PayInCountry,
} from "../commerce/shared/pay-in.js";

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
};

const COUNTRIES: PayInCountry[] = [
  { id: "de", regionId: "/regions/de", name: "Germany", defaultFiat: "EUR", fiats: ["EUR"] },
  { id: "us-mi", regionId: "/regions/us-mi", name: "Michigan", defaultFiat: "USD", fiats: ["USD"] },
];

describe("commerce pay-in (no provider wired in)", function () {
  async function withApp(env: Record<string, string>, fn: (baseUrl: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "commerce-pay-in-"));
    const app = createApp(loadConfig({ ...BASE_ENV, DB_PATH: join(dir, "test.db"), ...env } as NodeJS.ProcessEnv));
    await new Promise<void>((resolve) => app.server.listen(0, "127.0.0.1", () => resolve()));
    const address = app.server.address();
    if (!address || typeof address !== "object") throw new Error("expected TCP address");
    try {
      await fn(`http://127.0.0.1:${address.port}`);
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  }

  const createFiat = (baseUrl: string) =>
    fetch(`${baseUrl}/api/invoices`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentMode: "fiat",
        price: "25",
        to: [Wallet.createRandom().address],
        chains: ["11155111"],
        tokens: ["USDC"],
      }),
    });

  it("matches a geolocation string to a country or state row", () => {
    expect(matchCountryFromGeo("DE", COUNTRIES)?.id).to.equal("de");
    expect(matchCountryFromGeo("US-MI", COUNTRIES)?.id).to.equal("us-mi");
    expect(matchCountryFromGeo("us_mi", COUNTRIES)?.id).to.equal("us-mi");
    expect(matchCountryFromGeo("US", COUNTRIES)?.id).to.equal("us-mi");
    expect(matchCountryFromGeo("", COUNTRIES)).to.equal(undefined);
  });

  it("reads the payer country from CDN headers and ignores placeholders", () => {
    expect(countryFromGeoHeaders({ "cf-ipcountry": "lt" })).to.equal("LT");
    expect(countryFromGeoHeaders({ "x-vercel-ip-country": "DE" })).to.equal("DE");
    expect(countryFromGeoHeaders({ "cf-ipcountry": "XX" })).to.equal("");
    expect(countryFromGeoHeaders({ "cf-ipcountry": "T1" })).to.equal("");
    expect(countryFromGeoHeaders({})).to.equal("");
  });

  it("locks the settlement rail to Base USDC", () => {
    expect(isPayInSettlement(PAY_IN_CHAIN_ID, PAY_IN_TOKEN)).to.equal(true);
    expect(isPayInSettlement("11155111", "USDC")).to.equal(false);
    expect(isPayInSettlement("8453", "USDT")).to.equal(false);
  });

  it("public config reports pay-in disabled by default", async function () {
    await withApp({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/pay-in/config`);
      expect(res.status).to.equal(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.enabled).to.equal(false);
      expect(body.chainId).to.equal(PAY_IN_CHAIN_ID);
      expect(body.tokenAddress).to.equal(PAY_IN_TOKEN_ADDRESS);
      expect(body).to.not.have.property("buyOrigin");
      expect(body).to.not.have.property("geoUrl");
    });
  });

  it("PAY_IN_ENABLED=1 flips the capability flag", async function () {
    await withApp({ PAY_IN_ENABLED: "1" }, async (baseUrl) => {
      const body = (await (await fetch(`${baseUrl}/api/public/pay-in/config`)).json()) as { enabled: boolean };
      expect(body.enabled).to.equal(true);
    });
  });

  it("provider endpoints return 503 until a provider is integrated", async function () {
    await withApp({ PAY_IN_ENABLED: "1" }, async (baseUrl) => {
      for (const path of ["countries", "geo", "quotes?region=de&fiat=EUR&amount=50", "widget?providerId=x", "buy-url"]) {
        const res = await fetch(`${baseUrl}/api/public/pay-in/${path}`);
        expect(res.status, path).to.equal(503);
      }
    });
  });

  it("rejects fiat invoices unless pay-in is enabled", async function () {
    await withApp({}, async (baseUrl) => {
      expect((await createFiat(baseUrl)).status).to.equal(400);
    });
  });

  it("creates fiat invoices as Base USDC when enabled", async function () {
    await withApp({ PAY_IN_ENABLED: "1" }, async (baseUrl) => {
      const res = await createFiat(baseUrl);
      expect(res.status).to.equal(201);
      const body = (await res.json()) as { invoice: { chainId: string; token: string; paymentMode: string } };
      expect(body.invoice.chainId).to.equal("8453");
      expect(body.invoice.token).to.equal("USDC");
      expect(body.invoice.paymentMode).to.equal("fiat");
    });
  });

  it("crypto invoices are unaffected", async function () {
    await withApp({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          price: "10",
          to: [Wallet.createRandom().address],
          chains: ["11155111"],
          tokens: ["USDC"],
          chainId: "11155111",
          token: "USDC",
          paymentMode: "crypto",
        }),
      });
      expect(res.status).to.equal(201);
    });
  });
});
