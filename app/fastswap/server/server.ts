import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import { getInvoiceId } from "../../../src/index.js";
import { encodeFastSwapIntent, quoteIdFromString, quoteToIntent } from "../shared/encoding.js";
import { enrichFastSwapInvoiceExplorers } from "../shared/explorers.js";
import { AuditLog } from "../shared/audit.js";
import { signInvoice, verifyNodeAuth } from "../shared/signing.js";
import type {
  FastSwapChainConfig,
  FastSwapInvoice,
  FastSwapInvoiceTrackPatch,
  FastSwapLiquiditySummary,
  FastSwapPack,
  FastSwapQuoteRequest,
  FastSwapStatus,
} from "../shared/types.js";
import { FASTSWAP_CHAINS, FASTSWAP_DEFAULT_FEE_BPS, FASTSWAP_PACKS } from "../test/fixtures.js";
import { QuoteEngine } from "./quote-engine.js";
import type { PriceFetch } from "./price-sources.js";
import { StaticQuoteSource, type QuoteSource } from "./quote-sources.js";
import { FastSwapStore } from "./store.js";

/** Minimal invoice address deriver implemented by both OnchainInvoiceSdk and TronInvoiceSdk. */
export type InvoiceAddressSdk = {
  getNewInvoiceAddress(encodedInvoiceParams: string): Promise<string>;
};

export type FastSwapServerOptions = {
  sqlitePath: string;
  auditLogPath?: string;
  signingSecret?: string;
  invoiceSdk: InvoiceAddressSdk;
  invoiceSdksByChainId?: Record<string, InvoiceAddressSdk>;
  quoteSources?: QuoteSource[];
  chains?: FastSwapChainConfig[];
  packs?: FastSwapPack[];
  /** Shared secret for node-authenticated endpoints (track, list, liquidity). */
  nodeAuthSecret?: string;
  /** @deprecated Use nodeAuthSecret */
  nodeApiKey?: string;
  verifyCaptcha?: (token: string | undefined, context: FastSwapCaptchaContext) => Promise<boolean> | boolean;
  requireCaptchaForQuotes?: boolean;
  requireCaptchaForInvoices?: boolean;
  captchaSiteKey?: string;
  resolveInvoiceStatus?: (invoice: FastSwapInvoice) => Promise<FastSwapStatus | undefined> | FastSwapStatus | undefined;
  resolveLiquidity?: () => Promise<FastSwapLiquiditySummary[]> | FastSwapLiquiditySummary[];
  quoteTtlMs?: number;
  maxDeviationBps?: bigint;
  feeBps?: bigint;
  priceFetch?: PriceFetch;
};

export type FastSwapCaptchaContext = {
  action: "quote" | "createInvoice";
  request: FastSwapRequestContext;
};

export type FastSwapRequestContext = {
  headers: IncomingMessage["headers"];
  ip?: string;
  userAgent?: string;
  cfConnectingIp?: string;
  cfRay?: string;
};

type CaptchaBody = {
  captchaToken?: string;
};

export class FastSwapServer {
  private readonly store: FastSwapStore;
  private readonly chains: FastSwapChainConfig[];
  private readonly packs: FastSwapPack[];
  private readonly quoteEngine: QuoteEngine;
  private readonly audit?: AuditLog;
  private server?: Server;

  constructor(private readonly options: FastSwapServerOptions) {
    this.store = new FastSwapStore(options.sqlitePath);
    this.chains = options.chains ?? FASTSWAP_CHAINS;
    this.packs = options.packs ?? FASTSWAP_PACKS;
    if (options.auditLogPath) {
      this.audit = new AuditLog(options.auditLogPath, "api");
    }
    this.quoteEngine = new QuoteEngine({
      sources: options.quoteSources ?? [
        new StaticQuoteSource("static-a", {}),
        new StaticQuoteSource("static-b", {}),
        new StaticQuoteSource("static-c", {}),
      ],
      chains: this.chains,
      feeBps: options.feeBps ?? FASTSWAP_DEFAULT_FEE_BPS,
      quoteTtlMs: options.quoteTtlMs ?? 5 * 60 * 1000,
      maxDeviationBps: options.maxDeviationBps ?? 100n,
      allowedPackUsdMicros: this.packs.map((pack) => pack.usdAmountMicros),
      priceFetch: options.priceFetch,
    });
  }

  async run(host: string, port: number): Promise<AddressInfo> {
    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve) => this.server?.listen(port, host, resolve));
    return this.server.address() as AddressInfo;
  }

  async close() {
    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => (error ? reject(error) : resolve()));
    });
    this.store.close();
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "OPTIONS") {
        response.writeHead(204, corsHeaders());
        return response.end();
      }
      if (request.method === "GET" && url.pathname === "/config") {
        return writeJson(response, 200, {
          chains: this.chains,
          packs: this.packs,
          captcha: {
            requiredForQuotes: this.options.requireCaptchaForQuotes === true,
            requiredForInvoices: this.options.requireCaptchaForInvoices === true,
            siteKey: this.options.captchaSiteKey,
          },
        });
      }
      if (request.method === "POST" && url.pathname === "/quotes") {
        const traceId = this.audit?.traceId();
        const body = await readJson<FastSwapQuoteRequest & CaptchaBody>(request);
        this.audit?.append("quote.requested", { traceId, payload: { ...body, captchaToken: undefined } });
        await this.verifyCaptchaIfRequired(body.captchaToken, {
          action: "quote",
          request: getRequestContext(request),
        });
        const quote = await this.quoteEngine.quote(body);
        if (url.searchParams.get("preview") !== "1") {
          this.store.saveQuote(quote);
        }
        this.audit?.append("quote.issued", { traceId, payload: { quoteId: quote.quoteId, expiresAt: quote.expiresAt } });
        return writeJson(response, 201, quote);
      }
      if (request.method === "POST" && url.pathname === "/invoices") {
        const body = await readJson<{ quoteId: string } & CaptchaBody>(request);
        await this.verifyCaptchaIfRequired(body.captchaToken, {
          action: "createInvoice",
          request: getRequestContext(request),
        });
        const quote = this.store.getQuote(body.quoteId);
        if (!quote) throw new HttpError(404, "Quote not found");
        if (quote.expiresAt < Date.now()) throw new HttpError(410, "Quote expired");

        const data = encodeFastSwapIntent(quoteToIntent({ ...quote, quoteId: quoteIdFromString(quote.quoteId) }, this.chains));
        const invoiceId = getInvoiceId(data);
        const invoiceSdk = this.options.invoiceSdksByChainId?.[quote.sourceChainId] ?? this.options.invoiceSdk;
        const invoiceAddress = await invoiceSdk.getNewInvoiceAddress(data);
        const invoice: FastSwapInvoice = {
          ...quote,
          invoiceId,
          invoiceAddress,
          data,
          chainId: quote.sourceChainId,
          token: quote.sourceToken,
          amount: quote.sourceAmount,
          status: "waiting_payment",
        };
        if (this.options.signingSecret) {
          invoice.signature = signInvoice(invoice, this.options.signingSecret);
        }
        this.store.saveInvoice(invoice);
        this.audit?.append("invoice.created", {
          invoiceId: invoice.invoiceId,
          payload: {
            sourceChainId: invoice.sourceChainId,
            targetChainId: invoice.targetChainId,
            recipient: invoice.recipient,
            invoiceAddress: invoice.invoiceAddress,
            signature: invoice.signature,
          },
        });
        return writeJson(response, 201, invoice);
      }
      if (request.method === "POST" && url.pathname.match(/^\/invoices\/[^/]+\/track$/)) {
        if (!this.requireNodeAuth(request)) {
          throw new HttpError(401, "Invalid node credentials");
        }
        const invoiceId = decodeURIComponent(url.pathname.slice("/invoices/".length, -"/track".length));
        const body = await readJson<FastSwapInvoiceTrackPatch>(request);
        const merged = this.store.applyInvoiceTrackPatch(invoiceId, body);
        if (!merged) throw new HttpError(404, "Invoice not found");
        this.audit?.append("invoice.track", { invoiceId, payload: body as Record<string, unknown> });
        return writeJson(response, 200, await this.finalizeInvoiceResponse(merged));
      }
      if (request.method === "GET" && url.pathname === "/invoices") {
        if (!this.requireNodeAuth(request)) {
          throw new HttpError(401, "Invalid node credentials");
        }
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 100), 1_000);
        const cursor = url.searchParams.get("cursor") ?? undefined;
        const rows = this.store.listInvoices(limit, cursor);
        const invoices = await Promise.all(rows.map((row) => this.finalizeInvoiceResponse(row.invoice)));
        return writeJson(response, 200, {
          invoices: invoices.map((invoice, index) => ({
            id: invoice.invoiceId,
            sessionId: "fastswap",
            input: invoice,
            invoice,
            createdAt: rows[index].updatedAt,
            lastAccessedAt: rows[index].updatedAt,
          })),
          nextCursor: rows.length === limit ? String(rows[rows.length - 1].updatedAt) : undefined,
        });
      }
      if (request.method === "GET" && url.pathname.match(/^\/invoices\/[^/]+$/)) {
        const invoiceId = decodeURIComponent(url.pathname.slice("/invoices/".length));
        const invoice = this.store.getInvoice(invoiceId);
        if (!invoice) throw new HttpError(404, "Invoice not found");
        return writeJson(response, 200, await this.finalizeInvoiceResponse(invoice));
      }
      if (request.method === "GET" && url.pathname === "/recent-swaps") {
        const limit = Math.min(Number(url.searchParams.get("limit") ?? 20), 100);
        const invoices = await Promise.all(
          this.store
            .listInvoices(Math.min(Math.max(limit * 5, 50), 1_000))
            .map((row) => this.finalizeInvoiceResponse(row.invoice).then((invoice) => ({ invoice, updatedAt: row.updatedAt })))
        );
        const swaps = invoices
          .filter(({ invoice }) => invoice.status === "complete" && invoice.payout?.tx?.txHash)
          .slice(0, limit)
          .map(({ invoice, updatedAt }) => ({
            swapId: invoice.invoiceId,
            sourceChainId: invoice.sourceChainId,
            targetChainId: invoice.targetChainId,
            sourceToken: invoice.sourceToken,
            targetToken: invoice.targetToken,
            sourceAmount: invoice.amount,
            targetAmount: invoice.payout?.amount ?? invoice.targetAmount,
            amountBand: invoice.targetAmount,
            status: invoice.status,
            txHash: invoice.payout?.tx?.txHash,
            explorerTxUrl: invoice.payout?.tx?.explorerTxUrl,
            completedAt: updatedAt,
          }));
        return writeJson(response, 200, { swaps });
      }
      if (request.method === "GET" && url.pathname === "/liquidity") {
        if (!this.requireNodeAuth(request)) {
          throw new HttpError(401, "Invalid node credentials");
        }
        const liquidity = this.options.resolveLiquidity ? await this.options.resolveLiquidity() : [];
        return writeJson(response, 200, { liquidity });
      }
      throw new HttpError(404, "Not found");
    } catch (error) {
      writeJson(response, error instanceof HttpError ? error.statusCode : 500, {
        error: error instanceof Error ? error.message : "Internal server error",
      });
    }
  }

  private requireNodeAuth(request: IncomingMessage): boolean {
    const secret = this.options.nodeAuthSecret ?? this.options.nodeApiKey;
    if (!secret) return true;
    const provided = headerAsString(request.headers["x-api-key"]);
    return verifyNodeAuth(secret, provided);
  }

  private async verifyCaptchaIfRequired(token: string | undefined, context: FastSwapCaptchaContext) {
    const required =
      context.action === "quote"
        ? this.options.requireCaptchaForQuotes === true
        : this.options.requireCaptchaForInvoices === true;
    if (!required) return;
    if (!this.options.verifyCaptcha) throw new HttpError(400, "Captcha verifier is not configured");
    const ok = await this.options.verifyCaptcha(token, context);
    if (!ok) throw new HttpError(403, "Captcha verification failed");
  }

  private async finalizeInvoiceResponse(invoice: FastSwapInvoice): Promise<FastSwapInvoice> {
    const resolved = await this.withResolvedStatus(invoice);
    return enrichFastSwapInvoiceExplorers(resolved, this.chains);
  }

  private async withResolvedStatus(invoice: FastSwapInvoice): Promise<FastSwapInvoice> {
    if (!this.options.resolveInvoiceStatus) return invoice;
    const status = await this.options.resolveInvoiceStatus(invoice);
    return status ? { ...invoice, status } : invoice;
  }
}

async function readJson<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString() || "{}") as T;
}

function getRequestContext(request: IncomingMessage): FastSwapRequestContext {
  return {
    headers: request.headers,
    ip: request.socket.remoteAddress,
    userAgent: request.headers["user-agent"],
    cfConnectingIp: headerAsString(request.headers["cf-connecting-ip"]),
    cfRay: headerAsString(request.headers["cf-ray"]),
  };
}

function headerAsString(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function writeJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json", ...corsHeaders() });
  response.end(JSON.stringify(body));
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type,authorization,x-api-key",
  };
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}
