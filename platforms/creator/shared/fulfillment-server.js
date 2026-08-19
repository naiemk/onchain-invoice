/**
 * Shared fulfillment server for creator platforms (Kajabi, Teachable, etc.).
 */
import { createServer } from "node:http";
import { TrustlessCommerceClient, isPaidLikeStatus } from "@trustless-commerce/platform-sdk";

const PORT = Number(process.env.PORT ?? 3460);
const BASE_URL = process.env.TRUSTLESS_BASE_URL ?? "";
const EVM_WALLET = process.env.EVM_WALLET ?? "";
const DEFAULT_CHAIN = process.env.DEFAULT_CHAIN_ID ?? "11155111";
const DEFAULT_TOKEN = process.env.DEFAULT_TOKEN ?? "USDC";
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL ?? `http://localhost:${PORT}`;
const PLATFORM = process.env.PLATFORM ?? "creator";

/** @type {Map<string, { email: string; productId: string }>} */
const pending = new Map();

function client() {
  if (!BASE_URL || !EVM_WALLET) throw new Error("TRUSTLESS_BASE_URL and EVM_WALLET required");
  return new TrustlessCommerceClient({ baseUrl: BASE_URL });
}

async function fulfill({ email, productId, invoiceId, status }) {
  // Platform-specific hooks — replace with Kajabi / Teachable API calls.
  console.log(`[${PLATFORM}] fulfill`, { email, productId, invoiceId, status });

  if (process.env.KAJABI_API_KEY && PLATFORM === "kajabi") {
    // TODO: POST to Kajabi contact offer endpoint when credentials are configured.
  }
  if (process.env.TEACHABLE_API_KEY && PLATFORM === "teachable") {
    // TODO: POST Teachable enrollment when credentials are configured.
  }

  return { ok: true };
}

async function readJson(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", APP_PUBLIC_URL);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, platform: PLATFORM }));
      return;
    }

    if (req.method === "POST" && url.pathname === "/checkout") {
      const body = await readJson(req);
      const email = String(body.email ?? "");
      const productId = String(body.productId ?? "default");
      const price = String(body.price ?? "0.00");
      const title = String(body.title ?? `Product ${productId}`);

      if (!email) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "email required" }));
        return;
      }

      const idempotencyKey = `${PLATFORM}-${productId}-${email}-${price}`;
      const tc = client();
      const result = await tc.createInvoice(
        {
          price,
          to: [EVM_WALLET],
          chains: [DEFAULT_CHAIN],
          tokens: [DEFAULT_TOKEN],
          chainId: DEFAULT_CHAIN,
          token: DEFAULT_TOKEN,
          selectedTo: EVM_WALLET,
          clientInvoiceId: idempotencyKey,
          title,
          callback: `${APP_PUBLIC_URL}/webhooks/trustless-commerce`,
          allowPartial: false,
        },
        idempotencyKey
      );

      pending.set(result.invoice.id, { email, productId });

      res.writeHead(200, { "content-type": "application/json" });
      res.end(
        JSON.stringify({
          checkoutUrl: tc.checkoutUrl(result),
          invoiceId: result.invoice.id,
        })
      );
      return;
    }

    if (req.method === "POST" && url.pathname === "/webhooks/trustless-commerce") {
      const raw = await readJson(req);
      const tc = client();
      const payload = tc.parseCallbackPayload(raw);

      if (!isPaidLikeStatus(payload.invoice.status)) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, ignored: true }));
        return;
      }

      const meta =
        pending.get(payload.invoice.id) ??
        parseClientInvoiceId(payload.invoice.clientInvoiceId);

      await fulfill({
        email: meta.email,
        productId: meta.productId,
        invoiceId: payload.invoice.id,
        status: payload.invoice.status,
      });

      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "error" }));
  }
});

function parseClientInvoiceId(clientInvoiceId) {
  const parts = String(clientInvoiceId ?? "").split("-");
  return { email: parts.slice(3).join("-") || "unknown", productId: parts[2] ?? "default" };
}

server.listen(PORT, () => {
  console.log(`Creator fulfillment server (${PLATFORM}) on :${PORT}`);
});
