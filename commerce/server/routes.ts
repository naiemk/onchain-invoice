import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { getAddress, JsonRpcProvider } from "ethers";
import {
  addressesEqual,
  chainKind,
  CommerceInvoiceSdk,
  deriveTronInvoiceAddress,
  looksLikeSolanaAddress,
  normalizeMerchantAddress,
  predictCommerceInvoiceAddress,
  predictCommerceSolanaInvoiceAta,
  resolveSolanaChain,
  resolveSolanaToken,
  tokenAllowedOnChain,
  tronNumericChainId,
} from "onchain-invoice";
import { encodePayLink, invoiceIdFromPayLink, normalizePayLinkFields } from "../shared/invoice.js";
import type { InvoiceStatus, PayLinkFields } from "../shared/types.js";
import { requireApiKey, requireMerchant } from "./auth.js";
import { verifyCaptcha } from "./captcha.js";
import type { AppConfig } from "./config.js";
import type { CommerceDb } from "./db.js";
import { log, newRequestId } from "./logger.js";
import { clientIp, takeToken } from "./rate-limit.js";
import { requireSweeper } from "./sweeper-auth.js";

interface RouteContext {
  config: AppConfig;
  db: CommerceDb;
}

export function createRouter(context: RouteContext): (req: IncomingMessage, res: ServerResponse) => Promise<void> {
  return async (req, res) => {
    const requestId = newRequestId();
    res.setHeader("x-request-id", requestId);
    setCors(res, context.config);
    if (req.method === "OPTIONS") {
      res.writeHead(204).end();
      return;
    }

    const ip = clientIp(req);
    const url = new URL(req.url ?? "/", context.config.baseUrl);

    try {
      if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, service: "trustless-commerce", time: new Date().toISOString() });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/ready") {
        const ok = context.db.ready();
        sendJson(res, ok ? 200 : 503, { ok, db: ok });
        return;
      }

      // One-shot create (canonical)
      if (req.method === "POST" && url.pathname === "/api/invoices") {
        rateLimitOrThrow(ip, "create", context.config.rateLimit.createPerSecond);
        await createInvoice(req, res, context);
        return;
      }

      // Deprecated aliases → same create path
      if (req.method === "POST" && url.pathname === "/api/sessions") {
        rateLimitOrThrow(ip, "create", context.config.rateLimit.createPerSecond);
        await createSessionDeprecated(req, res, context);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/invoices/activate") {
        rateLimitOrThrow(ip, "create", context.config.rateLimit.createPerSecond);
        await createInvoice(req, res, context);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/invoices") {
        rateLimitOrThrow(ip, "public", context.config.rateLimit.publicPerIpPerSecond);
        listMerchantInvoices(req, res, context, url);
        return;
      }

      // Sweeper signed API
      if (req.method === "GET" && url.pathname === "/api/sweeper/me") {
        rateLimitOrThrow(ip, "sweeper", context.config.rateLimit.sweeperPerIpPerSecond);
        const auth = requireSweeper(req, context.db);
        const sweeper = context.db.getSweeper(auth.address)!;
        sendJson(res, 200, { sweeper });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/sweeper/invoices") {
        rateLimitOrThrow(ip, "sweeper", context.config.rateLimit.sweeperPerIpPerSecond);
        const auth = requireSweeper(req, context.db);
        const sweeper = context.db.getSweeper(auth.address)!;
        const requested = url.searchParams.get("status");
        const statuses = requested
          ? (requested.split(",").map((s) => s.trim()).filter(Boolean) as InvoiceStatus[])
          : undefined;
        sendJson(res, 200, {
          invoices: context.db.listWorkerInvoices(statuses, sweeper.chains.length ? sweeper.chains : undefined),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/sweeper/heartbeat") {
        rateLimitOrThrow(ip, "sweeper", context.config.rateLimit.sweeperPerIpPerSecond);
        const auth = requireSweeper(req, context.db);
        context.db.touchSweeper(auth.address);
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/sweeper/claim") {
        rateLimitOrThrow(ip, "sweeper", context.config.rateLimit.sweeperPerIpPerSecond);
        await claimInvoice(req, res, context);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/sweeper/track") {
        rateLimitOrThrow(ip, "sweeper", context.config.rateLimit.sweeperPerIpPerSecond);
        await trackInvoiceSigned(req, res, context);
        return;
      }

      // Legacy internal (API key) — kept for transition
      if (req.method === "GET" && url.pathname === "/api/internal/invoices") {
        requireApiKey(req, context.config.sweeperApiKey, "SWEEPER_API_KEY");
        const requested = url.searchParams.get("status");
        const statuses = requested
          ? (requested.split(",").map((s) => s.trim()).filter(Boolean) as InvoiceStatus[])
          : undefined;
        sendJson(res, 200, { invoices: context.db.listWorkerInvoices(statuses) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/internal/track") {
        await trackInvoiceLegacy(req, res, context);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/admin/sweepers") {
        requireApiKey(req, context.config.adminApiKey, "ADMIN_API_KEY");
        const body = await readJson(req);
        const address = getAddress(String(body.address ?? ""));
        const label = String(body.label ?? address);
        const chains = Array.isArray(body.chains) ? body.chains.map(String) : [];
        const sweeper = context.db.upsertSweeper({
          address,
          label,
          chains,
          enabled: body.enabled !== false,
        });
        sendJson(res, 201, { sweeper });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/admin/stats") {
        requireApiKey(req, context.config.adminApiKey, "ADMIN_API_KEY");
        sendJson(res, 200, context.db.stats());
        return;
      }

      const sweepMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/sweep$/);
      if (req.method === "POST" && sweepMatch) {
        await forceSweep(req, res, context, decodeURIComponent(sweepMatch[1]));
        return;
      }

      const invoiceMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)$/);
      if (req.method === "GET" && invoiceMatch) {
        rateLimitOrThrow(ip, "public", context.config.rateLimit.publicPerIpPerSecond);
        getInvoice(res, context, decodeURIComponent(invoiceMatch[1]));
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      const statusCode = statusCodeFor(error);
      if (statusCode === 409 && typeof error === "object" && error && "invoice" in error) {
        sendJson(res, 409, {
          error: error instanceof Error ? error.message : "Conflict",
          invoice: (error as { invoice: unknown }).invoice,
        });
        return;
      }
      if (statusCode >= 500) {
        log("error", "request failed", { requestId, path: url.pathname, error: String(error) });
      }
      sendJson(res, statusCode, { error: error instanceof Error ? error.message : "Internal server error" });
    }
  };
}

async function createInvoice(req: IncomingMessage, res: ServerResponse, { config, db }: RouteContext): Promise<void> {
  const body = await readJson(req);
  if (config.turnstileSecret) {
    const captchaOk = await verifyCaptcha(config, body.captchaToken, req.socket.remoteAddress);
    if (!captchaOk) {
      throw Object.assign(new Error("Captcha verification failed"), { statusCode: 400 });
    }
  }

  const fields = normalizePayLinkFields(body);
  const chainId = String(body.chainId ?? body.chain_id ?? fields.chains[0]);
  const token = String(body.token ?? fields.tokens[0]).toUpperCase();
  assertTokenChainPair(chainId, token);
  const selectedTo = resolveSelectedTo(body, fields, chainId);
  const invoiceId = invoiceIdFromPayLink(fields);
  const invoiceAddress = await getInvoiceAddress(config, selectedTo, invoiceId, chainId, token);
  const idempotencyKey = typeof req.headers["idempotency-key"] === "string" ? req.headers["idempotency-key"] : null;

  const { invoice, created } = db.createInvoice({
    invoiceId,
    fields,
    chainId,
    token,
    selectedTo,
    invoiceAddress,
    paySessionId: typeof body.paySessionId === "string" ? body.paySessionId : null,
    idempotencyKey,
  });

  sendJson(res, created ? 201 : 200, {
    invoice,
    created,
    payLink: `/pay?${encodePayLink(fields)}`,
  });
}

async function createSessionDeprecated(
  req: IncomingMessage,
  res: ServerResponse,
  context: RouteContext
): Promise<void> {
  const body = await readJson(req);
  if (context.config.turnstileSecret) {
    const captchaOk = await verifyCaptcha(context.config, body.captchaToken, req.socket.remoteAddress);
    if (!captchaOk) {
      throw Object.assign(new Error("Captcha verification failed"), { statusCode: 400 });
    }
  }
  const fields = normalizePayLinkFields(body);
  const paySessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const chainId = String(body.chainId ?? body.chain_id ?? fields.chains[0]);
  const token = String(body.token ?? fields.tokens[0]).toUpperCase();
  assertTokenChainPair(chainId, token);
  const selectedTo = resolveSelectedTo(body, fields, chainId);
  const invoiceId = invoiceIdFromPayLink(fields);
  const invoiceAddress = await getInvoiceAddress(context.config, selectedTo, invoiceId, chainId, token);
  const { invoice } = context.db.createInvoice({
    invoiceId,
    fields,
    chainId,
    token,
    selectedTo,
    invoiceAddress,
    paySessionId,
  });
  sendJson(res, 201, {
    paySessionId,
    invoiceId,
    expiresAt,
    payLink: `/pay?${encodePayLink(fields)}`,
    invoice,
    deprecated: true,
    notice: "Use POST /api/invoices instead of /api/sessions",
  });
}

function listMerchantInvoices(req: IncomingMessage, res: ServerResponse, { db }: RouteContext, url: URL): void {
  const toParam = url.searchParams.get("to")?.trim();
  const hasMerchantHeaders =
    typeof req.headers["x-merchant-address"] === "string" &&
    typeof req.headers["x-merchant-message"] === "string" &&
    typeof req.headers["x-merchant-signature"] === "string";

  let normalizedTo: string;
  if (hasMerchantHeaders) {
    const merchant = requireMerchant(req);
    normalizedTo = toParam ? normalizeLookupAddress(toParam) : merchant;
    if (!addressesEqual(normalizedTo, merchant)) {
      throw Object.assign(new Error("Merchant auth address must match the requested to address"), { statusCode: 403 });
    }
  } else if (toParam) {
    normalizedTo = normalizeLookupAddress(toParam);
  } else {
    normalizedTo = requireMerchant(req);
  }

  sendJson(res, 200, {
    invoices: db.listInvoices({ to: normalizedTo, status: url.searchParams.get("status") ?? undefined }),
  });
}

async function claimInvoice(req: IncomingMessage, res: ServerResponse, { config, db }: RouteContext): Promise<void> {
  const auth = requireSweeper(req, db);
  const body = await readJson(req);
  if (typeof body.invoiceId !== "string") {
    throw Object.assign(new Error("invoiceId is required"), { statusCode: 400 });
  }
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isFinite(expectedVersion)) {
    throw Object.assign(new Error("expectedVersion is required"), { statusCode: 400 });
  }
  const invoice = db.claimInvoice({
    invoiceId: body.invoiceId,
    sweeperAddress: auth.address,
    expectedVersion,
    leaseMs: config.claimLeaseMs,
  });
  sendJson(res, 200, { invoice });
}

async function trackInvoiceSigned(req: IncomingMessage, res: ServerResponse, { db }: RouteContext): Promise<void> {
  const auth = requireSweeper(req, db);
  const body = await readJson(req);
  await applyTrack(db, body, auth.address);
  const invoice = db.getInvoice(String(body.invoiceId));
  sendJson(res, 200, { invoice });
}

async function trackInvoiceLegacy(req: IncomingMessage, res: ServerResponse, { config, db }: RouteContext): Promise<void> {
  requireApiKey(req, config.sweeperApiKey, "SWEEPER_API_KEY");
  const body = await readJson(req);
  await applyTrack(db, body, undefined);
  const invoice = db.getInvoice(String(body.invoiceId));
  sendJson(res, 200, { invoice });
}

async function applyTrack(
  db: CommerceDb,
  body: Record<string, unknown>,
  sweeperAddress: string | undefined
): Promise<void> {
  if (typeof body.invoiceId !== "string") {
    throw Object.assign(new Error("invoiceId is required"), { statusCode: 400 });
  }
  const invoice = db.trackInvoice({
    invoiceId: body.invoiceId,
    status: parseInvoiceStatus(body.status),
    amountPaid: optionalString(body.amountPaid),
    amountSwept: optionalString(body.amountSwept),
    feeCollected: optionalString(body.feeCollected),
    gasSpentWei: optionalString(body.gasSpentWei),
    sweepTx: optionalString(body.sweepTx),
    error: body.error,
    payload: body,
    expectedVersion: body.expectedVersion !== undefined ? Number(body.expectedVersion) : undefined,
    sweeperAddress,
  });

  if ((invoice.status === "paid" || invoice.status === "paid_partial" || invoice.status === "swept") && invoice.callbackUrl) {
    await postCallback(db, invoice.callbackUrl, invoice);
  }
}

async function forceSweep(req: IncomingMessage, res: ServerResponse, { db }: RouteContext, invoiceId: string): Promise<void> {
  const merchant = requireMerchant(req);
  const invoice = db.getInvoice(invoiceId);
  if (!invoice) {
    throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
  }
  if (!invoice.toAddresses.some((value) => addressesEqual(value, merchant))) {
    throw Object.assign(new Error("Merchant auth address does not own this invoice"), { statusCode: 403 });
  }
  const body = await readJson(req);
  db.addEvent(invoiceId, "force_sweep", { forceSweep: body.force !== false, requestedBy: merchant });
  sendJson(res, 202, { queued: true, invoice });
}

function getInvoice(res: ServerResponse, { db }: RouteContext, invoiceId: string): void {
  const invoice = db.getInvoice(invoiceId);
  if (!invoice) {
    throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
  }
  sendJson(res, 200, { ...invoice, events: db.getEvents(invoiceId) });
}

async function getInvoiceAddress(
  config: AppConfig,
  selectedTo: string,
  invoiceId: string,
  chainId: string,
  token: string
): Promise<string | null> {
  const kind = chainKind(chainId);
  if (kind === "tron") {
    if (!config.tronInvoiceMasterSecret) {
      throw Object.assign(
        new Error("TRON_INVOICE_MASTER_SECRET is required to create Tron invoices"),
        { statusCode: 503 }
      );
    }
    const fullHost = config.tronFullHost ?? "https://nile.trongrid.io";
    return deriveTronInvoiceAddress(
      config.tronInvoiceMasterSecret,
      tronNumericChainId(chainId),
      invoiceId,
      fullHost
    );
  }

  if (kind === "solana") {
    const chain = resolveSolanaChain(config.solanaChains, chainId);
    if (!chain) {
      throw Object.assign(
        new Error(`Solana chain ${chainId} is not configured or not enabled`),
        { statusCode: 503 }
      );
    }
    const tokenCfg = resolveSolanaToken(chain, token);
    if (!tokenCfg) {
      throw Object.assign(
        new Error(`Token ${token} is not configured for Solana chain ${chainId}`),
        { statusCode: 400 }
      );
    }
    return predictCommerceSolanaInvoiceAta(chain.programId, selectedTo, invoiceId, tokenCfg.mint);
  }

  if (!config.sweeperAddress) {
    return null;
  }
  if (config.forwarderImplementation) {
    return predictCommerceInvoiceAddress(
      config.sweeperAddress,
      config.forwarderImplementation,
      selectedTo,
      invoiceId
    );
  }
  if (!config.evmRpcUrl) {
    throw Object.assign(
      new Error("EVM_RPC_URL or FORWARDER_IMPLEMENTATION is required when SWEEPER_ADDRESS is set"),
      { statusCode: 503 }
    );
  }
  const provider = new JsonRpcProvider(config.evmRpcUrl);
  const sdk = new CommerceInvoiceSdk({ provider, sweeperAddress: config.sweeperAddress });
  return sdk.getInvoiceAddress(selectedTo, invoiceId);
}

function resolveSelectedTo(
  body: Record<string, unknown>,
  fields: PayLinkFields,
  chainId: string
): string {
  const raw = String(body.selectedTo ?? body.selected_to ?? pickDefaultTo(fields, chainId) ?? "");
  let selectedTo: string;
  try {
    selectedTo = normalizeMerchantAddress(raw);
  } catch {
    throw Object.assign(new Error("selectedTo is not a valid merchant address"), { statusCode: 400 });
  }
  if (!fields.to.some((value) => addressesEqual(value, selectedTo))) {
    throw Object.assign(new Error("selectedTo is not in the pay-link merchant address list"), { statusCode: 400 });
  }
  const kind = chainKind(chainId);
  if (kind === "tron" && !selectedTo.startsWith("T")) {
    throw Object.assign(new Error("selectedTo must be a Tron address for Nile/Tron chains"), { statusCode: 400 });
  }
  if (kind === "evm" && !selectedTo.startsWith("0x")) {
    throw Object.assign(new Error("selectedTo must be an EVM address for this chain"), { statusCode: 400 });
  }
  if (kind === "solana" && !looksLikeSolanaAddress(selectedTo)) {
    throw Object.assign(new Error("selectedTo must be a Solana address for this chain"), { statusCode: 400 });
  }
  return selectedTo;
}

function pickDefaultTo(fields: PayLinkFields, chainId: string): string | undefined {
  const kind = chainKind(chainId);
  const match = fields.to.find((value) => {
    if (kind === "tron") return value.startsWith("T");
    if (kind === "solana") return looksLikeSolanaAddress(value);
    return value.startsWith("0x");
  });
  return match ?? fields.to[0];
}

function assertTokenChainPair(chainId: string, token: string): void {
  if (!tokenAllowedOnChain(chainId, token)) {
    throw Object.assign(
      new Error(`Token ${token} is not allowed on chain ${chainId}`),
      { statusCode: 400 }
    );
  }
}

function normalizeLookupAddress(value: string): string {
  try {
    return normalizeMerchantAddress(value);
  } catch {
    return getAddress(value);
  }
}

async function postCallback(db: CommerceDb, callbackUrl: string, invoice: unknown): Promise<void> {
  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "invoice.updated", invoice }),
    });
    db.addEvent((invoice as { id: string }).id, "callback", { callbackUrl, status: response.status, ok: response.ok });
  } catch (error) {
    db.addEvent((invoice as { id: string }).id, "error", {
      callbackUrl,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function rateLimitOrThrow(ip: string, bucket: string, perSecond: number): void {
  if (!takeToken(`${bucket}:${ip}`, perSecond)) {
    throw Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 });
  }
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64_000) {
      throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
    }
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
}

function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  const headers: Record<string, string> = {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  };
  if (statusCode === 429) {
    headers["retry-after"] = "1";
  }
  res.writeHead(statusCode, headers);
  res.end(JSON.stringify(body, bigintReplacer, 2));
}

function setCors(res: ServerResponse, config: AppConfig): void {
  const origins = config.corsOrigins;
  const allow = origins.includes("*") ? "*" : origins.join(",");
  res.setHeader("access-control-allow-origin", allow);
  res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  res.setHeader(
    "access-control-allow-headers",
    "content-type,authorization,x-api-key,idempotency-key,x-merchant-address,x-merchant-message,x-merchant-signature,x-sweeper-address,x-sweeper-timestamp,x-sweeper-nonce,x-sweeper-signature,x-sweeper-body-hash"
  );
  if (allow !== "*") {
    res.setHeader("access-control-allow-credentials", "true");
    res.setHeader("vary", "Origin");
  }
}

function statusCodeFor(error: unknown): number {
  return typeof error === "object" && error !== null && "statusCode" in error && typeof (error as { statusCode: number }).statusCode === "number"
    ? (error as { statusCode: number }).statusCode
    : 500;
}

function optionalString(value: unknown): string | undefined {
  return value === undefined || value === null ? undefined : String(value);
}

function parseInvoiceStatus(value: unknown): InvoiceStatus | undefined {
  if (value === undefined || value === null) return undefined;
  if (value === "created" || value === "awaiting_payment" || value === "paid" || value === "paid_partial" || value === "swept") {
    return value;
  }
  throw Object.assign(new Error("Invalid invoice status"), { statusCode: 400 });
}

function bigintReplacer(_: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

// silence unused PayLinkFields import warning in some tsc configs
export type { PayLinkFields };
