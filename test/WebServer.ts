import { expect } from "chai";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { InvoiceWebClient } from "../src/web-client.js";
import { InvoiceWebServer } from "../src/web-server.js";

describe("InvoiceWebServer", function () {
  it("supports UI sessions, invoice registration, fetch, session LRU list, and node listing", async function () {
    const server = new InvoiceWebServer<{ orderId: string }, { invoiceId: string; invoiceAddress: string }>({
      jwtSecret: "test-secret",
      nodeApiKey: "node-secret",
      sqlitePath: ":memory:",
      async calculateInvoice(input) {
        return {
          invoiceId: `invoice:${input.orderId}`,
          invoiceAddress: `address:${input.orderId}`,
        };
      },
    });

    const address = await server.run("127.0.0.1", 0);
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const client = new InvoiceWebClient<{ orderId: string }, { invoiceId: string; invoiceAddress: string }>({
        baseUrl,
      });

      const session = await client.createSession();
      expect(session.token).to.be.a("string");

      const invoice = await client.registerInvoice({ orderId: "ord_1" });
      expect(invoice.id).to.equal("invoice:ord_1");
      expect(invoice.invoice.invoiceAddress).to.equal("address:ord_1");

      const fetched = await client.fetchInvoice(invoice.id);
      expect(fetched.id).to.equal(invoice.id);

      const mine = await client.myInvoices();
      expect(mine.invoices.map((record) => record.id)).to.deep.equal([invoice.id]);

      const nodeClient = new InvoiceWebClient<{ orderId: string }, { invoiceId: string; invoiceAddress: string }>({
        baseUrl,
        nodeApiKey: "node-secret",
      });
      const listed = await nodeClient.listInvoices({ lookbackMs: 60_000 });
      expect(listed.invoices.map((record) => record.id)).to.deep.equal([invoice.id]);
    } finally {
      await server.close();
    }
  });

  it("supports captcha verification hooks", async function () {
    const server = new InvoiceWebServer({
      jwtSecret: "test-secret",
      sqlitePath: ":memory:",
      requireCaptchaForSession: true,
      verifyCaptcha(token) {
        return token === "ok";
      },
      calculateInvoice() {
        return { invoiceId: "invoice:captcha" };
      },
    });

    const address = await server.run("127.0.0.1", 0);
    const client = new InvoiceWebClient({ baseUrl: `http://127.0.0.1:${address.port}` });

    try {
      await expectReject(client.createSession({ captchaToken: "bad" }), "Captcha verification failed");
      const session = await client.createSession({ captchaToken: "ok" });
      expect(session.session.id).to.be.a("string");
    } finally {
      await server.close();
    }
  });

  it("persists invoices in SQLite across server instances", async function () {
    const directory = await mkdtemp(join(tmpdir(), "onchain-invoice-"));
    const sqlitePath = join(directory, "invoices.sqlite");

    try {
      const first = createPersistentTestServer(sqlitePath);
      const firstAddress = await first.run("127.0.0.1", 0);
      const firstClient = new InvoiceWebClient<{ orderId: string }, { invoiceId: string; invoiceAddress: string }>({
        baseUrl: `http://127.0.0.1:${firstAddress.port}`,
      });

      await firstClient.createSession();
      await firstClient.registerInvoice({ orderId: "persisted" });
      await first.close();

      const second = createPersistentTestServer(sqlitePath);
      const secondAddress = await second.run("127.0.0.1", 0);
      const nodeClient = new InvoiceWebClient<{ orderId: string }, { invoiceId: string; invoiceAddress: string }>({
        baseUrl: `http://127.0.0.1:${secondAddress.port}`,
        nodeApiKey: "node-secret",
      });

      try {
        const listed = await nodeClient.listInvoices();
        expect(listed.invoices.map((record) => record.id)).to.deep.equal(["invoice:persisted"]);
      } finally {
        await second.close();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

function createPersistentTestServer(sqlitePath: string) {
  return new InvoiceWebServer<{ orderId: string }, { invoiceId: string; invoiceAddress: string }>({
    jwtSecret: "test-secret",
    nodeApiKey: "node-secret",
    sqlitePath,
    calculateInvoice(input) {
      return {
        invoiceId: `invoice:${input.orderId}`,
        invoiceAddress: `address:${input.orderId}`,
      };
    },
  });
}

async function expectReject(promise: Promise<unknown>, message: string) {
  try {
    await promise;
  } catch (error) {
    expect(String(error)).to.include(message);
    return;
  }

  throw new Error("Expected promise to reject");
}
