/**
 * Trustless Commerce Shopify app — offsite checkout + order sync.
 *
 * Flow:
 * 1. Merchant installs app, configures TRUSTLESS_BASE_URL + payout wallets
 * 2. Checkout extension redirects to /apps/trustless-commerce/checkout?shopify_order_id=…
 * 3. App creates Trustless invoice, redirects buyer to hosted /pay
 * 4. Callback marks Shopify order as paid via Admin API
 */
import { createServer } from "node:http";
import { TrustlessCommerceClient, isPaidLikeStatus } from "@trustless-commerce/platform-sdk";

const PORT = Number(process.env.PORT ?? 3456);
const BASE_URL = process.env.TRUSTLESS_BASE_URL ?? "";
const SHOPIFY_ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN ?? "";
const SHOPIFY_SHOP = process.env.SHOPIFY_SHOP ?? "";
const EVM_WALLET = process.env.EVM_WALLET ?? "";
const DEFAULT_CHAIN = process.env.DEFAULT_CHAIN_ID ?? "11155111";
const DEFAULT_TOKEN = process.env.DEFAULT_TOKEN ?? "USDC";
const APP_PUBLIC_URL = process.env.APP_PUBLIC_URL ?? `http://localhost:${PORT}`;

/** @type {Map<string, { invoiceId: string; shopifyOrderId: string }>} */
const sessions = new Map();

function trustlessClient() {
  if (!BASE_URL) throw new Error("TRUSTLESS_BASE_URL is required");
  return new TrustlessCommerceClient({ baseUrl: BASE_URL });
}

async function markShopifyOrderPaid(shopifyOrderId, invoiceId) {
  if (!SHOPIFY_ACCESS_TOKEN || !SHOPIFY_SHOP) {
    console.warn("[shopify] SHOPIFY_ACCESS_TOKEN / SHOPIFY_SHOP not set — skipping Admin API call");
    return;
  }
  const gid = shopifyOrderId.startsWith("gid://")
    ? shopifyOrderId
    : `gid://shopify/Order/${shopifyOrderId}`;
  const mutation = `
    mutation orderMarkAsPaid($input: OrderMarkAsPaidInput!) {
      orderMarkAsPaid(input: $input) {
        order { id displayFinancialStatus }
        userErrors { field message }
      }
    }`;
  const response = await fetch(`https://${SHOPIFY_SHOP}/admin/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-shopify-access-token": SHOPIFY_ACCESS_TOKEN,
    },
    body: JSON.stringify({
      query: mutation,
      variables: { input: { id: gid } },
    }),
  });
  const body = await response.json();
  console.log("[shopify] orderMarkAsPaid", shopifyOrderId, invoiceId, JSON.stringify(body));
}

async function handleCheckout(url) {
  const shopifyOrderId = url.searchParams.get("shopify_order_id") ?? "";
  const amount = url.searchParams.get("amount") ?? "0.00";
  const title = url.searchParams.get("title") ?? `Shopify order ${shopifyOrderId}`;

  if (!shopifyOrderId || !EVM_WALLET) {
    return { status: 400, body: { error: "shopify_order_id and EVM_WALLET required" } };
  }

  const client = trustlessClient();
  const callback = `${APP_PUBLIC_URL}/webhooks/trustless-commerce`;
  const idempotencyKey = `shopify-${shopifyOrderId}`;

  const result = await client.createInvoice(
    {
      price: amount,
      to: [EVM_WALLET],
      chains: [DEFAULT_CHAIN],
      tokens: [DEFAULT_TOKEN],
      chainId: DEFAULT_CHAIN,
      token: DEFAULT_TOKEN,
      selectedTo: EVM_WALLET,
      clientInvoiceId: shopifyOrderId,
      title,
      callback,
      allowPartial: false,
    },
    idempotencyKey
  );

  sessions.set(result.invoice.id, { invoiceId: result.invoice.id, shopifyOrderId });

  return {
    status: 302,
    headers: { location: client.checkoutUrl(result) },
  };
}

async function handleWebhook(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");

  const client = trustlessClient();
  const payload = client.parseCallbackPayload(raw);

  if (!isPaidLikeStatus(payload.invoice.status)) {
    return { status: 200, body: { ok: true, ignored: true } };
  }

  const session =
    sessions.get(payload.invoice.id) ??
    { shopifyOrderId: payload.invoice.clientInvoiceId, invoiceId: payload.invoice.id };

  await markShopifyOrderPaid(session.shopifyOrderId, payload.invoice.id);

  return { status: 200, body: { ok: true } };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", APP_PUBLIC_URL);

    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: true, service: "trustless-commerce-shopify" }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/apps/trustless-commerce/checkout") {
      const out = await handleCheckout(url);
      if (out.headers?.location) {
        res.writeHead(out.status, out.headers);
        res.end();
      } else {
        res.writeHead(out.status, { "content-type": "application/json" });
        res.end(JSON.stringify(out.body));
      }
      return;
    }

    if (req.method === "POST" && url.pathname === "/webhooks/trustless-commerce") {
      const out = await handleWebhook(req);
      res.writeHead(out.status, { "content-type": "application/json" });
      res.end(JSON.stringify(out.body));
      return;
    }

    res.writeHead(404, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  } catch (error) {
    console.error(error);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }));
  }
});

server.listen(PORT, () => {
  console.log(`Trustless Commerce Shopify app listening on :${PORT}`);
});
