import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TrustlessCommerceClient,
  isPaidLikeStatus,
  absoluteUrl,
  TrustlessCommerceError,
} from "../dist/index.js";

describe("TrustlessCommerceClient", () => {
  it("absoluteUrl joins base and path", () => {
    assert.equal(absoluteUrl("https://pay.example.com", "/pay?id=1"), "https://pay.example.com/pay?id=1");
    assert.equal(absoluteUrl("https://pay.example.com/", "pay?id=1"), "https://pay.example.com/pay?id=1");
  });

  it("isPaidLikeStatus recognizes paid states", () => {
    assert.equal(isPaidLikeStatus("paid"), true);
    assert.equal(isPaidLikeStatus("swept"), true);
    assert.equal(isPaidLikeStatus("awaiting_payment"), false);
  });

  it("createInvoice sends Idempotency-Key and parses response", async () => {
    const calls = [];
    const mockFetch = async (url, init) => {
      calls.push({ url, init });
      return {
        ok: true,
        status: 201,
        text: async () =>
          JSON.stringify({
            invoice: { id: "inv_1", status: "awaiting_payment", priceUsd: "10.00" },
            created: true,
            payLink: "/pay?id=inv_1",
            checkoutLink: "/pay?price=10",
          }),
      };
    };

    const client = new TrustlessCommerceClient({
      baseUrl: "https://pay.example.com",
      fetch: mockFetch,
    });

    const result = await client.createInvoice(
      {
        price: "10.00",
        to: ["0xabc"],
        chains: ["11155111"],
        tokens: ["USDC"],
        clientInvoiceId: "order-1",
      },
      "order-1"
    );

    assert.equal(result.invoice.id, "inv_1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "https://pay.example.com/api/invoices");
    assert.equal(calls[0].init.headers["Idempotency-Key"], "order-1");
    assert.equal(client.checkoutUrl(result), "https://pay.example.com/pay?id=inv_1");
  });

  it("parseCallbackPayload validates shape", () => {
    const client = new TrustlessCommerceClient({ baseUrl: "https://x.com" });
    const payload = client.parseCallbackPayload({
      type: "invoice.updated",
      invoice: { id: "inv_1", status: "paid" },
    });
    assert.equal(payload.type, "invoice.updated");
    assert.throws(() => client.parseCallbackPayload({ type: "other" }));
  });

  it("throws TrustlessCommerceError on HTTP errors", async () => {
    const client = new TrustlessCommerceClient({
      baseUrl: "https://pay.example.com",
      fetch: async () => ({
        ok: false,
        status: 429,
        text: async () => JSON.stringify({ error: "Rate limit exceeded" }),
      }),
    });

    await assert.rejects(
      () =>
        client.createInvoice({
          price: "1",
          to: ["0x"],
          chains: ["1"],
          tokens: ["USDC"],
        }),
      (err) => {
        assert.ok(err instanceof TrustlessCommerceError);
        assert.equal(err.statusCode, 429);
        return true;
      }
    );
  });
});
