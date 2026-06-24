import { expect } from "chai";
import { AbiCoder } from "ethers";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTokenPriceUsdMicros } from "../server/price-sources.js";
import { FastSwapServer } from "../server/server.js";
import { verifyInvoiceSignature } from "../shared/signing.js";
import { tronAddressToEvmHex } from "../shared/tron-address.js";

describe("FastSwapServer", function () {
  it("quotes and creates invoices with deterministic invoice data", async function () {
    const directory = await mkdtemp(join(tmpdir(), "fastswap-server-"));
    const server = new FastSwapServer({
      sqlitePath: join(directory, "fastswap.sqlite"),
      invoiceSdk: {
        async getNewInvoiceAddress(data) {
          return `invoice:${String(data).slice(0, 10)}`;
        },
      },
    });
    const address = await server.run("127.0.0.1", 0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const quote = await postJson(`${baseUrl}/quotes`, {
        sourceChainId: "base",
        sourceToken: "0x0000000000000000000000000000000000000000",
        targetChainId: "base",
        targetToken: "0x0000000000000000000000000000000000000000",
        recipient: "0x0000000000000000000000000000000000000001",
        usdPack: 10,
      });
      expect(quote.quoteId).to.be.a("string");

      const invoice = await postJson(`${baseUrl}/invoices`, { quoteId: quote.quoteId });
      expect(invoice.invoiceId).to.be.a("string");
      expect(invoice.data).to.match(/^0x/);
      expect(invoice.status).to.equal("waiting_payment");

      const fetched = await fetch(`${baseUrl}/invoices/${encodeURIComponent(invoice.invoiceId)}`).then((r) => r.json());
      expect(fetched.invoiceId).to.equal(invoice.invoiceId);
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("requires captcha when enabled for quotes and invoices", async function () {
    const directory = await mkdtemp(join(tmpdir(), "fastswap-server-captcha-"));
    const server = new FastSwapServer({
      sqlitePath: join(directory, "fastswap.sqlite"),
      invoiceSdk: {
        async getNewInvoiceAddress(data) {
          return `invoice:${String(data).slice(0, 10)}`;
        },
      },
      requireCaptchaForQuotes: true,
      requireCaptchaForInvoices: true,
      verifyCaptcha: (token) => token === "ok",
    });
    const address = await server.run("127.0.0.1", 0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      await expectPostError(`${baseUrl}/quotes`, {
        sourceChainId: "base",
        sourceToken: "0x0000000000000000000000000000000000000000",
        targetChainId: "base",
        targetToken: "0x0000000000000000000000000000000000000000",
        recipient: "0x0000000000000000000000000000000000000001",
        usdPack: 10,
      }, 403);

      const quote = await postJson(`${baseUrl}/quotes`, {
        sourceChainId: "base",
        sourceToken: "0x0000000000000000000000000000000000000000",
        targetChainId: "base",
        targetToken: "0x0000000000000000000000000000000000000000",
        recipient: "0x0000000000000000000000000000000000000001",
        usdPack: 10,
        captchaToken: "ok",
      });

      await expectPostError(`${baseUrl}/invoices`, { quoteId: quote.quoteId }, 403);
      const invoice = await postJson(`${baseUrl}/invoices`, { quoteId: quote.quoteId, captchaToken: "ok" });
      expect(invoice.invoiceId).to.be.a("string");
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("signs created invoices and accepts node-authenticated track updates", async function () {
    const directory = await mkdtemp(join(tmpdir(), "fastswap-server-signing-"));
    const signingSecret = "signing-secret";
    const server = new FastSwapServer({
      sqlitePath: join(directory, "fastswap.sqlite"),
      signingSecret,
      nodeAuthSecret: signingSecret,
      invoiceSdk: {
        async getNewInvoiceAddress() {
          return "0x0000000000000000000000000000000000000abc";
        },
      },
    });
    const address = await server.run("127.0.0.1", 0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const quote = await postJson(`${baseUrl}/quotes`, {
        sourceChainId: "base",
        sourceToken: "0x0000000000000000000000000000000000000000",
        targetChainId: "base",
        targetToken: "0x0000000000000000000000000000000000000000",
        recipient: "0x0000000000000000000000000000000000000001",
        usdPack: 10,
      });
      const invoice = await postJson(`${baseUrl}/invoices`, { quoteId: quote.quoteId });
      expect(invoice.signature).to.be.a("string");
      expect(verifyInvoiceSignature(invoice, signingSecret)).to.equal(true);

      const txHash = `0x${"ab".repeat(32)}`;
      const tracked = await fetch(`${baseUrl}/invoices/${encodeURIComponent(invoice.invoiceId)}/track`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": signingSecret },
        body: JSON.stringify({
          sweep: {
            tx: {
              chainId: "base",
              txHash,
              status: "confirmed",
              gasUsed: "123456",
              blockNumber: 99,
            },
          },
        }),
      }).then((r) => r.json());
      expect(tracked.sweep?.tx?.explorerTxUrl).to.equal(`https://basescan.org/tx/${txHash}`);
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("accepts node track updates and exposes explorer links on GET", async function () {
    const directory = await mkdtemp(join(tmpdir(), "fastswap-server-track-"));
    const server = new FastSwapServer({
      sqlitePath: join(directory, "fastswap.sqlite"),
      nodeApiKey: "node-secret",
      invoiceSdk: {
        async getNewInvoiceAddress() {
          return "0x0000000000000000000000000000000000000abc";
        },
      },
    });
    const address = await server.run("127.0.0.1", 0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const quote = await postJson(`${baseUrl}/quotes`, {
        sourceChainId: "base",
        sourceToken: "0x0000000000000000000000000000000000000000",
        targetChainId: "base",
        targetToken: "0x0000000000000000000000000000000000000000",
        recipient: "0x0000000000000000000000000000000000000001",
        usdPack: 10,
      });
      const invoice = await postJson(`${baseUrl}/invoices`, { quoteId: quote.quoteId });
      const txHash = `0x${"ab".repeat(32)}`;

      const unauthorized = await fetch(`${baseUrl}/invoices/${encodeURIComponent(invoice.invoiceId)}/track`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": "wrong" },
        body: JSON.stringify({}),
      });
      expect(unauthorized.status).to.equal(401);

      const tracked = await fetch(`${baseUrl}/invoices/${encodeURIComponent(invoice.invoiceId)}/track`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": "node-secret" },
        body: JSON.stringify({
          sweep: {
            tx: {
              chainId: "base",
              txHash,
              status: "confirmed",
              gasUsed: "123456",
              blockNumber: 99,
            },
          },
          relay: {
            status: "confirmed",
            tx: {
              chainId: "base",
              txHash: `0x${"cd".repeat(32)}`,
              status: "confirmed",
              gasUsed: "999",
            },
          },
          payout: {
            status: "confirmed",
            token: "0x0000000000000000000000000000000000000000",
            amount: "1000",
            tx: {
              chainId: "base",
              txHash: `0x${"cd".repeat(32)}`,
              status: "confirmed",
              gasUsed: "999",
            },
          },
        }),
      }).then((r) => r.json());
      expect(tracked.sweep?.tx?.explorerTxUrl).to.equal(`https://basescan.org/tx/${txHash}`);
      expect(tracked.relay?.tx?.explorerTxUrl).to.match(/basescan\.org\/tx\//);

      const fetched = await fetch(`${baseUrl}/invoices/${encodeURIComponent(invoice.invoiceId)}`).then((r) => r.json());
      expect(fetched.sweep?.tx?.gasUsed).to.equal("123456");
      expect(fetched.payout?.amount).to.equal("1000");
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("exposes node-authenticated liquidity summaries", async function () {
    const directory = await mkdtemp(join(tmpdir(), "fastswap-server-liquidity-"));
    const server = new FastSwapServer({
      sqlitePath: join(directory, "fastswap.sqlite"),
      nodeApiKey: "node-secret",
      invoiceSdk: {
        async getNewInvoiceAddress() {
          return "0x0000000000000000000000000000000000000abc";
        },
      },
      resolveLiquidity: () => [
        {
          chainId: "base",
          token: "ETH",
          balance: "100",
          reserved: "10",
          queuedAmount: "5",
          lowLiquidity: false,
        },
      ],
    });
    const address = await server.run("127.0.0.1", 0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const unauthorized = await fetch(`${baseUrl}/liquidity`, {
        headers: { "x-api-key": "wrong" },
      });
      expect(unauthorized.status).to.equal(401);

      const listed = await fetch(`${baseUrl}/liquidity`, {
        headers: { "x-api-key": "node-secret" },
      }).then((r) => r.json());
      expect(listed.liquidity[0].chainId).to.equal("base");
      expect(listed.liquidity[0].balance).to.equal("100");
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("resolves token prices from configured public source adapters", async function () {
    const fetchImpl = async (url: string | URL | Request) => {
      const href = String(url);
      if (href.includes("coingecko.com/api/v3/simple/price")) {
        return jsonResponse({ ethereum: { usd: 2000 } });
      }
      if (href.includes("data-api.binance.vision")) {
        return jsonResponse({ price: "2010.00" });
      }
      if (href.includes("api.dexscreener.com")) {
        return jsonResponse({ pairs: [{ priceUsd: "1990.00" }] });
      }
      throw new Error(`Unexpected URL ${href}`);
    };

    const price = await resolveTokenPriceUsdMicros(
      {
        symbol: "ETH",
        chainId: "11155111",
        decimals: 18,
        isNative: true,
        priceSources: [
          { type: "coingecko", coinId: "ethereum" },
          { type: "binance", symbol: "ETHUSDT" },
          { type: "dexscreener", chainId: "ethereum", tokenAddress: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2" },
        ],
      },
      fetchImpl as typeof fetch
    );

    expect(price?.toString()).to.equal("2000000000");
  });

  it("uses token price sources to calculate raw quote amounts", async function () {
    const directory = await mkdtemp(join(tmpdir(), "fastswap-server-price-sources-"));
    const server = new FastSwapServer({
      sqlitePath: join(directory, "fastswap.sqlite"),
      chains: [
        {
          id: "11155111",
          type: "evm",
          name: "Sepolia",
          nativeSymbol: "ETH",
          sweeperAddress: "0x0000000000000000000000000000000000000000",
          fastSwapAddress: "0x0000000000000000000000000000000000000000",
          explorerUrl: "",
          tokens: [
            {
              symbol: "ETH",
              chainId: "11155111",
              decimals: 18,
              isNative: true,
              priceSources: [{ type: "static", priceUsdMicros: "2000000000" }],
            },
          ],
        },
      ],
      invoiceSdk: {
        async getNewInvoiceAddress() {
          return "0x0000000000000000000000000000000000000abc";
        },
      },
    });
    const address = await server.run("127.0.0.1", 0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const quote = await postJson(`${baseUrl}/quotes`, {
        sourceChainId: "11155111",
        sourceToken: "0x0000000000000000000000000000000000000000",
        targetChainId: "11155111",
        targetToken: "0x0000000000000000000000000000000000000000",
        recipient: "0x0000000000000000000000000000000000000001",
        usdAmountMicros: "20000000",
      });
      expect(quote.targetAmount).to.equal("10000000000000000");
      expect(quote.sourceAmount).to.equal("10075000000000000");
      expect(quote.feeAmount).to.equal("75000000000000");
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("encodes TRON source token slots as hex bodies and derives the invoice address from the source SDK", async function () {
    const directory = await mkdtemp(join(tmpdir(), "fastswap-server-tron-source-"));
    const tronUsdt = "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t";
    const sdkCalls: string[] = [];
    const server = new FastSwapServer({
      sqlitePath: join(directory, "fastswap.sqlite"),
      chains: [
        {
          id: "3448148188",
          type: "tron",
          name: "TRON Nile",
          nativeSymbol: "TRX",
          sweeperAddress: tronUsdt,
          fastSwapAddress: tronUsdt,
          explorerUrl: "",
          tokens: [
            { symbol: "USDT", chainId: "3448148188", address: tronUsdt, decimals: 6, priceUsdMicros: "1000000" },
          ],
        },
        {
          id: "11155111",
          type: "evm",
          name: "Sepolia",
          nativeSymbol: "ETH",
          sweeperAddress: "0x0000000000000000000000000000000000000000",
          fastSwapAddress: "0x0000000000000000000000000000000000000000",
          explorerUrl: "",
          tokens: [{ symbol: "ETH", chainId: "11155111", decimals: 18, isNative: true, priceUsdMicros: "2000000000" }],
        },
      ],
      invoiceSdksByChainId: {
        "3448148188": {
          async getNewInvoiceAddress(data) {
            sdkCalls.push(String(data));
            return "TWaXyZ9c8c8c8c8c8c8c8c8c8c8c8c8c8c";
          },
        },
      },
      invoiceSdk: {
        async getNewInvoiceAddress() {
          return "0x0000000000000000000000000000000000000abc";
        },
      },
    });
    const address = await server.run("127.0.0.1", 0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const quote = await postJson(`${baseUrl}/quotes`, {
        sourceChainId: "3448148188",
        sourceToken: tronUsdt,
        targetChainId: "11155111",
        targetToken: "0x0000000000000000000000000000000000000000",
        recipient: "0x0000000000000000000000000000000000000001",
        usdAmountMicros: "20000000",
      });
      const invoice = await postJson(`${baseUrl}/invoices`, { quoteId: quote.quoteId });

      expect(invoice.invoiceAddress).to.equal("TWaXyZ9c8c8c8c8c8c8c8c8c8c8c8c8c8c");
      expect(sdkCalls).to.have.lengthOf(1);

      const [decoded] = AbiCoder.defaultAbiCoder().decode(
        [
          "tuple(uint8 version,bytes32 quoteId,uint256 sourceChainId,address sourceToken,uint256 sourceAmount,uint256 targetChainId,address targetToken,uint256 targetAmount,address recipient,uint64 expiresAt,address refundAddress)",
        ],
        invoice.data
      );
      expect(decoded.sourceToken).to.equal(tronAddressToEvmHex(tronUsdt));
      expect(decoded.targetToken).to.equal("0x0000000000000000000000000000000000000000");
    } finally {
      await server.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}

async function expectPostError(url: string, body: unknown, status: number) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  expect(response.status).to.equal(status);
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
