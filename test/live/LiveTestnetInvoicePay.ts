/**
 * Live integration against https://testnet.trustless-commerce.com:
 * - API create → pay → swept (EVM + Tron)
 * - UI pay-link flow → pay → merchant credited → callback webhook fired
 *
 *   LIVE_TESTNET=1 npx hardhat test test/live/LiveTestnetInvoicePay.ts
 */
import { expect } from "chai";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  formatUnits,
  getAddress,
  parseUnits,
} from "ethers";
import { TronWeb } from "tronweb";
import { getCommerceInvoiceId, randomInvoiceSeed } from "../../src/index.js";

const API_BASE = (process.env.LIVE_TESTNET_API_URL ?? "https://testnet.trustless-commerce.com").replace(
  /\/$/,
  ""
);
const UI_BASE = (process.env.LIVE_TESTNET_UI_URL ?? API_BASE).replace(/\/$/, "");
const SEPOLIA_USDC = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
const NILE_USDT = process.env.TRON_USDT_ADDRESS ?? "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
const NILE_HOST = process.env.NILE_FULL_HOST ?? "https://nile.trongrid.io";
const PRICE_USD = "0.05";
const AMOUNT_UNITS = 50_000n; // 0.05 * 1e6
const POLL_MS = 5_000;
const TIMEOUT_MS = 300_000;

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
] as const;

const TRC20_ABI = [
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    constant: true,
    inputs: [{ name: "who", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    type: "function",
  },
] as const;

interface InvoiceRecord {
  id: string;
  status: string;
  invoiceAddress: string | null;
  amountPaid: string;
  amountSwept: string;
  feeCollected: string;
  sweepTx: string | null;
  chainId: string;
  token: string;
  selectedTo: string;
  callbackUrl?: string | null;
  events?: Array<{ kind: string; payload: unknown; createdAt?: string }>;
}

interface WebhookToken {
  uuid: string;
  url: string;
}

function liveEnabled(): boolean {
  return process.env.LIVE_TESTNET === "1" || process.env.LIVE_TESTNET === "true";
}

function evmKey(): string | undefined {
  return process.env.EVM_PRIVATE_KEY?.trim();
}

function tronKey(): string | undefined {
  const raw = process.env.TRON_PRIVATE_KEY ?? process.env.TRON_SPONSOR_PRIVATE_KEY;
  return raw?.replace(/^0x/, "").trim();
}

async function createWebhook(): Promise<WebhookToken> {
  const res = await fetch("https://webhook.site/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (!res.ok) throw new Error(`webhook.site token failed: ${res.status}`);
  const body = (await res.json()) as { uuid: string };
  return { uuid: body.uuid, url: `https://webhook.site/${body.uuid}` };
}

async function waitForWebhook(
  token: WebhookToken,
  predicate: (body: unknown) => boolean,
  timeoutMs = TIMEOUT_MS
): Promise<unknown> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await fetch(`https://webhook.site/token/${token.uuid}/requests?sorting=newest`, {
      headers: { accept: "application/json" },
    });
    if (res.ok) {
      const data = (await res.json()) as { data?: Array<{ content?: string; method?: string }> };
      for (const req of data.data ?? []) {
        if ((req.method ?? "POST").toUpperCase() !== "POST") continue;
        try {
          const parsed = JSON.parse(req.content ?? "{}");
          if (predicate(parsed)) return parsed;
        } catch {
          /* ignore non-json */
        }
      }
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Timeout waiting for callback webhook ${token.url}`);
}

async function createInvoice(body: Record<string, unknown>): Promise<InvoiceRecord> {
  const res = await fetch(`${API_BASE}/api/invoices`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`POST /api/invoices → ${res.status}: ${text}`);
  }
  const json = JSON.parse(text) as { invoice: InvoiceRecord };
  expect(json.invoice.invoiceAddress).to.be.a("string").and.not.empty;
  expect(json.invoice.status).to.equal("awaiting_payment");
  return json.invoice;
}

async function getInvoice(id: string): Promise<InvoiceRecord> {
  const res = await fetch(`${API_BASE}/api/invoices/${encodeURIComponent(id)}`);
  const text = await res.text();
  if (!res.ok) throw new Error(`GET /api/invoices/${id} → ${res.status}: ${text}`);
  return JSON.parse(text) as InvoiceRecord;
}

async function waitUntilPaidOrSwept(id: string): Promise<InvoiceRecord> {
  const start = Date.now();
  let last = await getInvoice(id);
  while (Date.now() - start < TIMEOUT_MS) {
    last = await getInvoice(id);
    if (last.status === "paid" || last.status === "paid_partial" || last.status === "swept") {
      return last;
    }
    await sleep(POLL_MS);
  }
  throw new Error(
    `Timeout waiting for invoice ${id} (last status=${last.status}, amountPaid=${last.amountPaid})`
  );
}

function encodeUiPayLink(fields: {
  price: string;
  to: string[];
  chains: string[];
  tokens: string[];
  invoiceSeed: string;
  clientInvoiceId?: string;
  callback?: string;
  title?: string;
  description?: string;
  allowPartial: boolean;
}): string {
  const params = new URLSearchParams();
  params.set("price", fields.price);
  params.set("to", fields.to.join(","));
  params.set("chains", fields.chains.join(","));
  params.set("tokens", fields.tokens.join(","));
  params.set("invoice_seed", fields.invoiceSeed);
  if (fields.clientInvoiceId) params.set("client_invoice_id", fields.clientInvoiceId);
  if (fields.callback) params.set("callback", fields.callback);
  if (fields.title) params.set("title", fields.title);
  if (fields.description) params.set("description", fields.description);
  params.set("allow_partial", fields.allowPartial ? "1" : "0");
  return params.toString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitTronTx(tronWeb: TronWeb, txId: string, timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const info = await tronWeb.trx.getTransactionInfo(txId);
    if (info?.id || info?.blockNumber || info?.receipt) return;
    await sleep(2_000);
  }
  throw new Error(`Timeout waiting for Tron tx ${txId}`);
}

describe("Live testnet invoice pay (API → chain → sweeper)", function () {
  this.timeout(TIMEOUT_MS + 60_000);

  before(function () {
    if (!liveEnabled()) this.skip();
  });

  it("EVM Sepolia: create USDC invoice, pay, receive confirmation", async function () {
    const pk = evmKey();
    if (!pk) this.skip();

    const rpc = process.env.SEPOLIA_RPC_URL?.trim() || "https://ethereum-sepolia-rpc.publicnode.com";
    const provider = new JsonRpcProvider(rpc);
    const wallet = new Wallet(pk, provider);
    const merchant = getAddress(wallet.address);
    const usdc = new Contract(SEPOLIA_USDC, ERC20_ABI, wallet);

    const bal = await usdc.balanceOf(merchant);
    if (bal < AMOUNT_UNITS) {
      throw new Error(`Need ≥ ${PRICE_USD} Sepolia USDC on ${merchant}; have ${formatUnits(bal, 6)}`);
    }

    const invoice = await createInvoice({
      price: PRICE_USD,
      to: [merchant],
      chains: ["11155111"],
      tokens: ["USDC"],
      invoiceSeed: randomInvoiceSeed(),
      clientInvoiceId: `live-evm-${Date.now()}`,
      chainId: "11155111",
      token: "USDC",
      selectedTo: merchant,
      title: "Live EVM integ",
    });

    const tx = await usdc.transfer(invoice.invoiceAddress!, AMOUNT_UNITS);
    await tx.wait();

    const settled = await waitUntilPaidOrSwept(invoice.id);
    expect(["paid", "paid_partial", "swept"]).to.include(settled.status);
    expect(BigInt(settled.amountPaid)).to.be.greaterThan(0n);
  });

  it("Tron Nile: create USDT invoice, pay, receive confirmation", async function () {
    const pk = tronKey();
    if (!pk) this.skip();

    const tronWeb = new TronWeb({ fullHost: NILE_HOST, privateKey: pk });
    const merchant = tronWeb.address.fromPrivateKey(pk);
    if (!merchant) throw new Error("Failed to derive Tron address from TRON_PRIVATE_KEY");

    const contract = await tronWeb.contract(TRC20_ABI as never, NILE_USDT);
    const bal = BigInt((await contract.balanceOf(merchant).call()).toString());
    if (bal < AMOUNT_UNITS) {
      throw new Error(`Need ≥ ${PRICE_USD} Nile USDT on ${merchant}; have ${Number(bal) / 1e6}`);
    }

    const invoice = await createInvoice({
      price: PRICE_USD,
      to: [merchant],
      chains: ["nile"],
      tokens: ["USDT"],
      invoiceSeed: randomInvoiceSeed(),
      clientInvoiceId: `live-tron-${Date.now()}`,
      chainId: "nile",
      token: "USDT",
      selectedTo: merchant,
      title: "Live Tron integ",
    });

    const payTx: string = await contract.transfer(invoice.invoiceAddress!, AMOUNT_UNITS.toString()).send({
      feeLimit: 150_000_000,
    });
    await waitTronTx(tronWeb, payTx);

    const settled = await waitUntilPaidOrSwept(invoice.id);
    expect(["paid", "paid_partial", "swept"]).to.include(settled.status);
    expect(BigInt(settled.amountPaid)).to.be.greaterThan(0n);
  });
});

describe("Live testnet UI pay link + callback", function () {
  this.timeout(TIMEOUT_MS + 90_000);

  before(function () {
    if (!liveEnabled()) this.skip();
  });

  it("UI create→pay flow credits merchant and POSTs callback", async function () {
    const pk = evmKey();
    if (!pk) this.skip();

    const webhook = await createWebhook();
    const rpc = process.env.SEPOLIA_RPC_URL?.trim() || "https://ethereum-sepolia-rpc.publicnode.com";
    const provider = new JsonRpcProvider(rpc);
    const wallet = new Wallet(pk, provider);
    const merchant = getAddress(wallet.address);
    const usdc = new Contract(SEPOLIA_USDC, ERC20_ABI, wallet);

    const balBeforePay = await usdc.balanceOf(merchant);
    if (balBeforePay < AMOUNT_UNITS) {
      throw new Error(`Need ≥ ${PRICE_USD} Sepolia USDC on ${merchant}`);
    }

    const fields = {
      price: PRICE_USD,
      to: [merchant],
      chains: ["11155111"],
      tokens: ["USDC"],
      invoiceSeed: randomInvoiceSeed(),
      clientInvoiceId: `ui-evm-${Date.now()}`,
      callback: webhook.url,
      title: "UI live callback",
      description: "Create page → pay page → activate → pay",
      allowPartial: false,
    };

    // Same pay URL the Create page would emit.
    const payUrl = `${UI_BASE}/pay?${encodeUiPayLink(fields)}`;
    const payPage = await fetch(payUrl);
    expect(payPage.status).to.equal(200);
    const html = await payPage.text();
    expect(html).to.match(/Trustless Commerce|invoice|pay/i);

    const expectedId = getCommerceInvoiceId({
      invoiceSeed: fields.invoiceSeed,
      toAddresses: fields.to,
    });

    // Same POST the pay page "Continue" button sends.
    const created = await createInvoice({
      ...fields,
      chainId: "11155111",
      token: "USDC",
      selectedTo: merchant,
    });
    expect(created.id).to.equal(expectedId);
    expect(created.callbackUrl ?? fields.callback).to.equal(webhook.url);

    const merchantBeforeSweep = await usdc.balanceOf(merchant);
    // After funding invoice from merchant wallet, balance drops by AMOUNT; sweep returns amount-fee.
    const tx = await usdc.transfer(created.invoiceAddress!, AMOUNT_UNITS);
    await tx.wait();
    const afterSend = await usdc.balanceOf(merchant);
    expect(afterSend).to.equal(merchantBeforeSweep - AMOUNT_UNITS);

    const settled = await waitUntilPaidOrSwept(created.id);
    expect(["paid", "paid_partial", "swept"]).to.include(settled.status);
    expect(BigInt(settled.amountPaid)).to.equal(AMOUNT_UNITS);

    // Wait until swept so merchant is credited on-chain.
    const start = Date.now();
    let finalInv = settled;
    while (Date.now() - start < TIMEOUT_MS && finalInv.status !== "swept") {
      await sleep(POLL_MS);
      finalInv = await getInvoice(created.id);
    }
    expect(finalInv.status).to.equal("swept");
    expect(finalInv.sweepTx).to.be.a("string").and.not.empty;

    const merchantAfter = await usdc.balanceOf(merchant);
    const credited = merchantAfter - afterSend;
    expect(credited).to.be.greaterThan(0n);
    expect(BigInt(finalInv.amountPaid)).to.equal(AMOUNT_UNITS);
    // Merchant wallet credited by the swept payout (fee policy is contract-side).
    expect(credited).to.equal(BigInt(finalInv.amountSwept || "0"));

    const callbackPayload = (await waitForWebhook(webhook, (body) => {
      const inv = (body as { type?: string; invoice?: { id?: string } })?.invoice;
      return (
        (body as { type?: string }).type === "invoice.updated" &&
        inv?.id?.toLowerCase() === created.id.toLowerCase()
      );
    })) as { type: string; invoice: InvoiceRecord };

    expect(callbackPayload.type).to.equal("invoice.updated");
    expect(["paid", "paid_partial", "swept"]).to.include(callbackPayload.invoice.status);

    const withEvents = await getInvoice(created.id);
    const callbackEvents = (withEvents.events ?? []).filter((e) => e.kind === "callback");
    expect(callbackEvents.length).to.be.greaterThan(0);
  });
});
