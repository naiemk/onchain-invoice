import { getAddress, JsonRpcProvider, Wallet } from "ethers";
import { OnchainInvoiceSdk } from "../src/sdk.js";
import { API_PORT, DEMO_CAPTCHA_TOKEN, DEMO_HOST, DEMO_PRIVATE_KEY, DEMO_SEED_INVOICE, NODE_API_KEY, deploymentChains, type DemoDeployment } from "./config.js";
import { payInvoice } from "./pay-invoice.js";

const API_BASE = `http://${DEMO_HOST}:${API_PORT}`;

/**
 * After a fresh demo reset the API has no invoices, so the sweep node only logs empty syncs.
 * Create one cross-chain invoice, fund the invoice forwarder, then run one sweeper pull so the
 * receiver emits `InvoicePaid` (required for the sweep node's indexer and queue).
 */
export async function seedDemoInvoiceIfNeeded(deployment: DemoDeployment): Promise<void> {
  if (!DEMO_SEED_INVOICE.enabled) return;
  const [source, target] = deploymentChains(deployment);
  if (!source || !target) return;
  const nodeHeaders = { "x-api-key": NODE_API_KEY };
  const listResponse = await fetch(`${API_BASE}/invoices?limit=5`, { headers: nodeHeaders });
  if (!listResponse.ok) throw new Error(`list invoices: ${listResponse.status} ${await listResponse.text()}`);
  const list = (await listResponse.json()) as { invoices?: unknown[] };
  if ((list.invoices?.length ?? 0) > 0) return;

  const recipient = new Wallet(DEMO_PRIVATE_KEY).address;
  const quote = await postJson(`${API_BASE}/quotes`, {
    sourceChainId: source.id,
    sourceToken: source.tokens.stable.address,
    targetChainId: target.id,
    targetToken: target.tokens.stable.address,
    recipient,
    usdAmountMicros: DEMO_SEED_INVOICE.usdAmountMicros,
    captchaToken: DEMO_CAPTCHA_TOKEN,
  });
  const invoice = (await postJson(`${API_BASE}/invoices`, {
    quoteId: quote.quoteId,
    captchaToken: DEMO_CAPTCHA_TOKEN,
  })) as { invoiceId: string };

  console.log("[fastswap-demo] Seeded demo invoice", invoice.invoiceId);
  await payInvoice(invoice.invoiceId);
  await sweepFundedInvoiceForwarder(deployment, invoice.invoiceId);
  console.log("[fastswap-demo] Seeded source-chain payment and initial sweep into receiver");
}

async function sweepFundedInvoiceForwarder(deployment: DemoDeployment, invoiceId: string): Promise<void> {
  const invoice = (await fetch(`${API_BASE}/invoices/${encodeURIComponent(invoiceId)}`).then((r) => {
    if (!r.ok) throw new Error(`fetch invoice: ${r.status}`);
    return r.json();
  })) as {
    invoiceId: string;
    invoiceAddress: string;
    data: string;
    sourceChainId: string;
    token?: string;
    sourceToken: string;
    amount: string;
  };

  const chain =
    deploymentChains(deployment).find((candidate) => candidate.id === invoice.sourceChainId);
  if (!chain) throw new Error(`Unknown source chain ${invoice.sourceChainId}`);

  const provider = new JsonRpcProvider(chain.rpcUrl);
  const wallet = new Wallet(DEMO_PRIVATE_KEY, provider);
  const sdk = new OnchainInvoiceSdk({ provider, signer: wallet, sweeperAddress: chain.sweeper });
  const token = getAddress((invoice.token ?? invoice.sourceToken) as string);
  const minAmount = BigInt(invoice.amount);
  const sweep = await sdk.sweepInvoice(invoice.invoiceAddress, {
    invoiceId: invoice.invoiceId,
    data: invoice.data,
    token,
    minAmount,
    amount: invoice.amount,
  });
  await sweep.tx.wait();
}

async function postJson(url: string, body: unknown): Promise<any> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
}
