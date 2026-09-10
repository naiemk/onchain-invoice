import { expect } from "chai";
import { getAddress, Wallet } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import {
  buildPortfolioBuyUrl,
  clearMetamaskOnrampCaches,
  countryFromGeoHeaders,
  mapAggregatorQuotes,
  mapCountries,
  matchCountryFromGeo,
  PAY_IN_CHAIN_ID,
  PAY_IN_TOKEN_ADDRESS,
  isPayInWidgetEmbeddable,
  setMetamaskOnrampFetch,
} from "../commerce/shared/metamask-onramp.js";

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
} as const;

const COUNTRIES_BODY = [
  {
    id: "/regions/de",
    name: "Germany",
    emoji: "🇩🇪",
    currencies: ["/currencies/fiat/eur"],
    support: { buy: true },
  },
  {
    id: "/regions/us",
    name: "United States",
    currencies: ["/currencies/fiat/usd"],
    states: [
      {
        id: "/regions/us-mi",
        name: "Michigan",
        support: { buy: true },
      },
    ],
  },
];

const LIGHT_BODY = {
  payments: [{ id: "/payments/debit-credit-card", name: "Debit / Credit card" }],
  fiatCurrencies: [{ id: "/currencies/fiat/eur", symbol: "EUR" }],
};

const QUOTE_BODY = {
  success: [
    {
      provider: "/providers/moonpay",
      providerInfo: { id: "/providers/moonpay", name: "MoonPay" },
      quote: {
        amountIn: 100,
        amountOut: 98.5,
        exchangeRate: 0.985,
        networkFee: 0.5,
        providerFee: 1,
        extraFee: 0,
        paymentMethod: "/payments/debit-credit-card",
      },
    },
  ],
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function mockMetamaskFetch(): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/regions/countries")) return jsonResponse(COUNTRIES_BODY);
    if (url.pathname.includes("/regions/") && url.pathname.endsWith("/light")) return jsonResponse(LIGHT_BODY);
    if (url.pathname.includes("/buy-widget")) {
      const wallet = url.searchParams.get("walletAddress") ?? "";
      expect(url.searchParams.get("cryptoCurrencyId")).to.equal(
        `/currencies/crypto/${PAY_IN_CHAIN_ID}/${PAY_IN_TOKEN_ADDRESS.toLowerCase()}`
      );
      const provider = url.pathname.split("/").find((p) => p && p !== "providers" && p !== "buy-widget") ?? "unknown";
      const hosts: Record<string, string> = {
        moonpay: "https://buy.moonpay.com",
        coinbase: "https://pay.coinbase.com",
        banxa: "https://banxa.com",
        ramp: "https://app.ramp.network",
        transak: "https://global.transak.com",
      };
      const origin = hosts[provider] ?? "https://global.transak.com";
      return jsonResponse({
        url: `${origin}/?walletAddress=${wallet}&fiatCurrency=EUR&cryptoCurrencyCode=USDC`,
        orderId: `${url.pathname}/orders/test`,
      });
    }
    if (url.pathname.endsWith("/providers/all/quote")) {
      expect(url.searchParams.get("cryptoCurrencyId")).to.equal(
        `/currencies/crypto/${PAY_IN_CHAIN_ID}/${PAY_IN_TOKEN_ADDRESS.toLowerCase()}`
      );
      expect(url.searchParams.get("regionId")).to.equal("/regions/de");
      return jsonResponse(QUOTE_BODY);
    }
    return new Response("not mocked", { status: 404 });
  };
}

describe("commerce MetaMask pay-in", function () {
  afterEach(() => {
    setMetamaskOnrampFetch(undefined);
    clearMetamaskOnrampCaches();
  });

  async function withApp(
    env: Record<string, string>,
    fn: (baseUrl: string) => Promise<void>
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "commerce-pay-in-"));
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
    if (!address || typeof address !== "object") throw new Error("expected TCP address");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      await fn(baseUrl);
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("maps countries and geolocation to region ids", () => {
    const countries = mapCountries(COUNTRIES_BODY);
    expect(countries.map((c) => c.id)).to.deep.equal(["de", "us-mi"]);
    expect(countries[0]?.defaultFiat).to.equal("EUR");
    expect(countries[0]?.fiats).to.deep.equal(["EUR"]);
    expect(matchCountryFromGeo("DE", countries)?.id).to.equal("de");
    expect(matchCountryFromGeo("US-MI", countries)?.id).to.equal("us-mi");
    expect(matchCountryFromGeo("US", countries)?.id).to.equal("us-mi");
    expect(countryFromGeoHeaders({ "cf-ipcountry": "lt" })).to.equal("LT");
    expect(countryFromGeoHeaders({ "cf-ipcountry": "XX" })).to.equal("");
    expect(countryFromGeoHeaders({ "x-vercel-ip-country": "FR" })).to.equal("FR");
    const lithuania = mapCountries([
      {
        id: "/regions/lt",
        name: "Lithuania",
        currencies: ["/currencies/fiat/ltl", "/currencies/fiat/eur"],
        support: { buy: true },
      },
    ]);
    expect(lithuania[0]?.defaultFiat).to.equal("EUR");
    expect(lithuania[0]?.fiats).to.deep.equal(["EUR"]);
  });

  it("builds a Portfolio buy URL locked to Base USDC", () => {
    const wallet = Wallet.createRandom().address;
    const url = new URL(
      buildPortfolioBuyUrl({
        buyOrigin: "https://portfolio.metamask.io",
        walletAddress: wallet,
        amount: "100",
        fiat: "EUR",
        regionId: "/regions/de",
        paymentMethodId: "/payments/debit-credit-card",
        providerId: "/providers/moonpay",
      })
    );
    expect(url.origin + url.pathname).to.equal("https://portfolio.metamask.io/buy");
    expect(url.searchParams.get("chainId")).to.equal("8453");
    expect(url.searchParams.get("address")).to.equal(PAY_IN_TOKEN_ADDRESS);
    expect(url.searchParams.get("walletAddress")).to.equal(wallet);
    expect(url.searchParams.get("fiat")).to.equal("eur");
    expect(url.searchParams.get("region")).to.equal("de");
    expect(url.searchParams.get("payment")).to.equal("debit-credit-card");
    expect(url.searchParams.get("provider")).to.equal("moonpay");
  });

  it("maps aggregator quotes onto buy URLs", () => {
    const wallet = Wallet.createRandom().address;
    const rows = mapAggregatorQuotes(QUOTE_BODY, {
      buyOrigin: "https://portfolio.metamask.io",
      walletAddress: wallet,
      amount: "100",
      fiat: "EUR",
      regionId: "/regions/de",
      paymentNames: new Map([["/payments/debit-credit-card", "Debit / Credit card"]]),
    });
    expect(rows).to.have.length(1);
    expect(rows[0]?.provider).to.equal("MoonPay");
    expect(rows[0]?.cryptoAmount).to.equal("98.5");
    expect(rows[0]?.embeddable).to.equal(false);
    expect(rows[0]?.providerId).to.equal("/providers/moonpay");
  });

  it("treats Transak, Banxa, and Ramp as embeddable", () => {
    expect(isPayInWidgetEmbeddable("/providers/transak")).to.equal(true);
    expect(isPayInWidgetEmbeddable("/providers/banxa")).to.equal(true);
    expect(isPayInWidgetEmbeddable("/providers/ramp")).to.equal(true);
    expect(isPayInWidgetEmbeddable("/providers/moonpay")).to.equal(false);
    expect(isPayInWidgetEmbeddable("/providers/coinbase")).to.equal(false);
  });

  it("public config is enabled by default and locked to Base USDC", async function () {
    await withApp({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/pay-in/config`);
      expect(res.status).to.equal(200);
      const body = (await res.json()) as {
        enabled?: boolean;
        chainId?: string;
        token?: string;
        tokenAddress?: string;
      };
      expect(body.enabled).to.equal(true);
      expect(body.chainId).to.equal("8453");
      expect(body.token).to.equal("USDC");
      expect(body.tokenAddress).to.equal(PAY_IN_TOKEN_ADDRESS);
    });
  });

  it("returns pay-in country from CDN IP headers", async function () {
    await withApp({}, async (baseUrl) => {
      const se = await fetch(`${baseUrl}/api/public/pay-in/geo`, {
        headers: { "cf-ipcountry": "se" },
      });
      expect(se.status).to.equal(200);
      expect((await se.json() as { country?: string }).country).to.equal("SE");

      const unknown = await fetch(`${baseUrl}/api/public/pay-in/geo`, {
        headers: { "cf-ipcountry": "XX" },
      });
      expect((await unknown.json() as { country?: string }).country).to.equal("");
    });
  });

  it("returns 503 when MetaMask pay-in is disabled", async function () {
    await withApp({ METAMASK_ONRAMP_ENABLED: "0" }, async (baseUrl) => {
      const configRes = await fetch(`${baseUrl}/api/public/pay-in/config`);
      const configBody = (await configRes.json()) as { enabled?: boolean };
      expect(configBody.enabled).to.equal(false);
      const res = await fetch(`${baseUrl}/api/public/pay-in/countries`);
      expect(res.status).to.equal(503);
    });
  });

  it("proxies countries and quotes with Base USDC locked", async function () {
    setMetamaskOnrampFetch(mockMetamaskFetch());
    await withApp({}, async (baseUrl) => {
      const countriesRes = await fetch(`${baseUrl}/api/public/pay-in/countries`);
      expect(countriesRes.status).to.equal(200);
      const countriesBody = (await countriesRes.json()) as { countries: Array<{ id: string }> };
      expect(countriesBody.countries.map((c) => c.id)).to.include("de");

      const wallet = Wallet.createRandom().address;
      const quotesRes = await fetch(
        `${baseUrl}/api/public/pay-in/quotes?region=de&fiat=EUR&amount=100&address=${wallet}`
      );
      expect(quotesRes.status).to.equal(200);
      const quotesBody = (await quotesRes.json()) as {
        chainId: string;
        tokenAddress: string;
        quotes: Array<{ embeddable?: boolean; provider: string; providerId: string }>;
      };
      expect(quotesBody.chainId).to.equal("8453");
      expect(quotesBody.tokenAddress).to.equal(PAY_IN_TOKEN_ADDRESS);
      expect(quotesBody.quotes[0]?.provider).to.equal("MoonPay");
      expect(quotesBody.quotes[0]?.embeddable).to.equal(false);
    });
  });

  it("rejects quotes without a wallet address", async function () {
    setMetamaskOnrampFetch(mockMetamaskFetch());
    await withApp({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/public/pay-in/quotes?region=de&fiat=EUR&amount=100`);
      expect(res.status).to.equal(400);
    });
  });

  it("returns a provider checkout widget locked to the wallet address", async function () {
    setMetamaskOnrampFetch(mockMetamaskFetch());
    const wallet = Wallet.createRandom().address.toLowerCase();
    await withApp({}, async (baseUrl) => {
      const res = await fetch(
        `${baseUrl}/api/public/pay-in/widget?region=de&fiat=EUR&amount=50&address=${wallet}&providerId=/providers/moonpay&paymentMethodId=/payments/debit-credit-card`
      );
      expect(res.status).to.equal(200);
      const body = (await res.json()) as { widgetUrl: string; embeddable?: boolean };
      expect(body.widgetUrl).to.include("walletAddress=" + encodeURIComponent(getAddress(wallet)));
      expect(body.widgetUrl).to.include("buy.moonpay.com");
      expect(body.embeddable).to.equal(false);
    });
  });

  it("returns widget URLs for Banxa, Ramp, and Coinbase", async function () {
    setMetamaskOnrampFetch(mockMetamaskFetch());
    const wallet = Wallet.createRandom().address.toLowerCase();
    await withApp({}, async (baseUrl) => {
      const cases = [
        { id: "/providers/banxa", host: "banxa.com", embeddable: true },
        { id: "/providers/ramp", host: "app.ramp.network", embeddable: true },
        { id: "/providers/coinbase", host: "pay.coinbase.com", embeddable: false },
      ] as const;
      for (const row of cases) {
        const res = await fetch(
          `${baseUrl}/api/public/pay-in/widget?region=de&fiat=EUR&amount=50&address=${wallet}&providerId=${encodeURIComponent(row.id)}&paymentMethodId=/payments/debit-credit-card`
        );
        expect(res.status).to.equal(200);
        const body = (await res.json()) as { widgetUrl: string; embeddable?: boolean };
        expect(body.widgetUrl).to.include(row.host);
        expect(body.embeddable).to.equal(row.embeddable);
      }
    });
  });

  it("creates fiat invoices as Base USDC and rejects when pay-in is off", async function () {
    await withApp({}, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/invoices`, {
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
      expect(res.status).to.equal(201);
      const body = (await res.json()) as { invoice: { chainId: string; token: string; paymentMode: string } };
      expect(body.invoice.chainId).to.equal("8453");
      expect(body.invoice.token).to.equal("USDC");
      expect(body.invoice.paymentMode).to.equal("fiat");
    });
    await withApp({ METAMASK_ONRAMP_ENABLED: "0" }, async (baseUrl) => {
      const res = await fetch(`${baseUrl}/api/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paymentMode: "fiat",
          price: "25",
          to: [Wallet.createRandom().address],
          chains: ["8453"],
          tokens: ["USDC"],
        }),
      });
      expect(res.status).to.equal(400);
    });
  });
});
