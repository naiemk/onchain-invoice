import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { getAddress, JsonRpcProvider } from "ethers";
import {
  addressesEqual,
  chainKind,
  CommerceInvoiceSdk,
  defaultTronFullHost,
  deriveTronInvoiceAddress,
  looksLikeSolanaAddress,
  normalizeMerchantAddress,
  predictCommerceInvoiceAddress,
  predictCommerceSolanaInvoiceAta,
  randomInvoiceSeed,
  resolveSolanaChain,
  resolveSolanaToken,
  tokenAllowedOnChain,
  tronNumericChainId,
} from "onchain-invoice";
import {
  encodeInvoiceResumeLink,
  encodePayLink,
  invoiceIdFromPayLink,
  normalizePayLinkFields,
} from "../shared/invoice.js";
import type { InvoiceStatus, PayLinkFields, PaymentMode } from "../shared/types.js";
import {
  buildOnrampWidgetSession,
  isOnramperSandboxOrigin,
  ONRAMPER_SUPPORTED_PAIRS,
  onramperSupportedPair,
  parsePaymentMode,
  paymentModeAllowsFiat,
  verifyOnramperWebhookSignature,
} from "../shared/onramper.js";
import {
  fetchOnrampPaymentMethods,
  fetchOnrampQuote,
  isSettlementWithinSlippage,
  parseSlippageBps,
  settlementAmountFromQuote,
  settlementDriftBps,
  type QuoteDirection,
} from "../shared/onramper-quotes.js";
import { requireApiKey, requireMerchant } from "./auth.js";
import { verifyCaptcha } from "./captcha.js";
import { resolveEvmChain, type AppConfig } from "./config.js";
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

      if (req.method === "GET" && url.pathname === "/api/public/onramp") {
        rateLimitOrThrow(ip, "public", context.config.rateLimit.publicPerIpPerSecond);
        const onramper = context.config.onramper;
        sendJson(res, 200, {
          enabled: onramper.enabled,
          sandbox: onramper.enabled && (onramper.demo || isOnramperSandboxOrigin(onramper.widgetOrigin)),
          demo: onramper.enabled && onramper.demo,
          fiats: onramper.enabled ? onramper.fiats : [],
          supportedPairs: onramper.enabled ? [...ONRAMPER_SUPPORTED_PAIRS] : [],
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/public/onramp-quote") {
        rateLimitOrThrow(ip, "public", context.config.rateLimit.publicPerIpPerSecond);
        await getOnrampQuote(res, context, url);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/public/onramp-methods") {
        rateLimitOrThrow(ip, "public", context.config.rateLimit.publicPerIpPerSecond);
        await getOnrampMethods(res, context, url);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/public/onramp-demo") {
        rateLimitOrThrow(ip, "public", context.config.rateLimit.publicPerIpPerSecond);
        sendOnrampDemoHtml(res, url);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/public/onramp-webhook") {
        rateLimitOrThrow(ip, "public", context.config.rateLimit.publicPerIpPerSecond);
        await handleOnrampWebhook(req, res, context);
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

      const onrampMatch = url.pathname.match(/^\/api\/invoices\/([^/]+)\/onramp-session$/);
      if (req.method === "POST" && onrampMatch) {
        rateLimitOrThrow(ip, "public", context.config.rateLimit.publicPerIpPerSecond);
        await createOnrampSession(req, res, context, decodeURIComponent(onrampMatch[1]));
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
      if (statusCode === 410 && typeof error === "object" && error && "code" in error) {
        const e = error as {
          code?: string;
          lockedSettlement?: string;
          liveSettlement?: string;
          slippageBps?: number;
          driftBps?: number;
        };
        sendJson(res, 410, {
          error: error instanceof Error ? error.message : "Gone",
          code: e.code,
          lockedSettlement: e.lockedSettlement,
          liveSettlement: e.liveSettlement,
          slippageBps: e.slippageBps,
          driftBps: e.driftBps,
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

  if (body.invoiceSeed != null || body.invoice_seed != null) {
    throw Object.assign(new Error("invoiceSeed is server-assigned; do not provide it in the request"), {
      statusCode: 400,
    });
  }

  const paymentMode = parsePaymentMode(body.paymentMode ?? body.payment_mode);
  // Fiat invoices may omit price; settlement USDC is derived from the create-time quote.
  const baseFields = normalizePayLinkFields(
    paymentMode === "fiat" && (body.price == null || body.price === "")
      ? { ...body, price: "0" }
      : body
  );
  assertPaymentModeAllowed(paymentMode, baseFields, config);

  const displayFiat = String(body.displayFiat ?? body.display_fiat ?? "").trim().toUpperCase() || undefined;
  const displayAmount = String(body.displayAmount ?? body.display_amount ?? "").trim() || undefined;
  const quoteCountry = String(body.quoteCountry ?? body.quote_country ?? "us").trim().toLowerCase();
  const quotePaymentMethod = String(body.quotePaymentMethod ?? body.quote_payment_method ?? "creditcard")
    .trim()
    .toLowerCase();
  let quoteProvider = String(body.quoteProvider ?? body.quote_provider ?? "").trim().toLowerCase() || undefined;
  const quoteSlippageBps = parseSlippageBps(body.quoteSlippageBps ?? body.quote_slippage_bps);

  let price = baseFields.price;
  let resolvedDisplayFiat = displayFiat;
  let resolvedDisplayAmount = displayAmount;

  if (paymentMode === "fiat") {
    if (!resolvedDisplayFiat) {
      throw Object.assign(
        new Error("displayFiat is required for fiat-only invoices (e.g. SEK). Quote at create time so the widget shows the correct fiat amount."),
        { statusCode: 400 }
      );
    }
    if (!config.onramper.fiats.includes(resolvedDisplayFiat)) {
      throw Object.assign(new Error(`Unsupported display fiat: ${resolvedDisplayFiat}`), { statusCode: 400 });
    }
    const chainIdForQuote = String(body.chainId ?? body.chain_id ?? baseFields.chains[0]);
    const tokenForQuote = String(body.token ?? baseFields.tokens[0]).toUpperCase();

    const quoteBase = {
      apiKey: config.onramper.apiKey ?? "",
      demo: config.onramper.demo || !config.onramper.apiKey,
      widgetOrigin: config.onramper.widgetOrigin,
      fiat: resolvedDisplayFiat,
      chainId: chainIdForQuote,
      token: tokenForQuote,
      country: quoteCountry,
      paymentMethod: quotePaymentMethod,
      provider: quoteProvider,
    };

    let quote;
    if (resolvedDisplayAmount) {
      // Customer pays X fiat → lock settlement from quote (source of truth for slippage).
      quote = await fetchOnrampQuote({
        ...quoteBase,
        direction: "pay",
        fiatAmount: resolvedDisplayAmount,
      });
      price = settlementAmountFromQuote(quote.cryptoAmount);
      resolvedDisplayAmount = quote.fiatAmount;
    } else if (price && price !== "0") {
      // Merchant wants N USDC → derive charge fiat.
      quote = await fetchOnrampQuote({
        ...quoteBase,
        direction: "receive",
        cryptoAmount: price,
      });
      resolvedDisplayAmount = quote.fiatAmount;
    } else {
      quote = undefined;
    }

    if (!resolvedDisplayAmount || !quote) {
      throw Object.assign(
        new Error("displayAmount is required for fiat-only invoices (or provide price to quote it)"),
        { statusCode: 400 }
      );
    }
    quoteProvider = (quoteProvider || quote.recommended.provider).toLowerCase();
  }

  if (!price || price === "0") {
    throw Object.assign(new Error("price is required"), { statusCode: 400 });
  }

  const invoiceSeed = randomInvoiceSeed();
  const fields: PayLinkFields = {
    ...baseFields,
    price,
    invoiceSeed,
    paymentMode,
    ...(resolvedDisplayFiat ? { displayFiat: resolvedDisplayFiat } : {}),
    ...(resolvedDisplayAmount ? { displayAmount: resolvedDisplayAmount } : {}),
    ...(resolvedDisplayFiat || resolvedDisplayAmount
      ? { quoteCountry, quotePaymentMethod, quoteProvider, quoteSlippageBps }
      : {}),
  };
  const chainId = String(body.chainId ?? body.chain_id ?? fields.chains[0]);
  const token = String(body.token ?? fields.tokens[0]).toUpperCase();
  assertTokenChainPair(chainId, token, config);
  if (paymentModeAllowsFiat(paymentMode) && !onramperSupportedPair(chainId, token)) {
    throw Object.assign(
      new Error(`Card/bank payments are not available for ${token} on chain ${chainId}`),
      { statusCode: 400 }
    );
  }
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
    payLink: `/pay?${encodeInvoiceResumeLink(invoice.id)}`,
    checkoutLink: `/pay?${encodePayLink({ ...baseFields, paymentMode })}`,
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
  if (body.invoiceSeed != null || body.invoice_seed != null) {
    throw Object.assign(new Error("invoiceSeed is server-assigned; do not provide it in the request"), {
      statusCode: 400,
    });
  }
  const baseFields = normalizePayLinkFields(body);
  const paymentMode = parsePaymentMode(body.paymentMode ?? body.payment_mode ?? baseFields.paymentMode);
  assertPaymentModeAllowed(paymentMode, baseFields, context.config);
  const invoiceSeed = randomInvoiceSeed();
  const fields: PayLinkFields = { ...baseFields, invoiceSeed, paymentMode };
  const paySessionId = randomUUID();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const chainId = String(body.chainId ?? body.chain_id ?? fields.chains[0]);
  const token = String(body.token ?? fields.tokens[0]).toUpperCase();
  assertTokenChainPair(chainId, token, context.config);
  if (paymentModeAllowsFiat(paymentMode) && !onramperSupportedPair(chainId, token)) {
    throw Object.assign(
      new Error(`Card/bank payments are not available for ${token} on chain ${chainId}`),
      { statusCode: 400 }
    );
  }
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
    payLink: `/pay?${encodeInvoiceResumeLink(invoice.id)}`,
    invoice,
    deprecated: true,
    notice: "Use POST /api/invoices instead of /api/sessions",
  });
}

async function getOnrampQuote(
  res: ServerResponse,
  { config }: RouteContext,
  url: URL
): Promise<void> {
  if (!config.onramper.enabled) {
    throw Object.assign(new Error("Card and bank payments are not enabled on this instance"), {
      statusCode: 503,
    });
  }

  const fiat = String(url.searchParams.get("fiat") ?? "").trim().toUpperCase();
  const chainId = String(url.searchParams.get("chainId") ?? url.searchParams.get("chain_id") ?? "").trim();
  const token = String(url.searchParams.get("token") ?? "").trim().toUpperCase();
  const country = String(url.searchParams.get("country") ?? "us").trim().toLowerCase();
  const paymentMethod = String(url.searchParams.get("paymentMethod") ?? url.searchParams.get("payment_method") ?? "creditcard")
    .trim()
    .toLowerCase();
  const provider = String(url.searchParams.get("provider") ?? "").trim().toLowerCase() || undefined;
  const direction = (String(url.searchParams.get("direction") ?? "receive").trim().toLowerCase() ||
    "receive") as QuoteDirection;
  if (direction !== "receive" && direction !== "pay") {
    throw Object.assign(new Error("direction must be receive or pay"), { statusCode: 400 });
  }
  const cryptoAmount = url.searchParams.get("cryptoAmount") ?? url.searchParams.get("crypto_amount") ?? undefined;
  const fiatAmount = url.searchParams.get("fiatAmount") ?? url.searchParams.get("fiat_amount") ?? undefined;

  if (!fiat) throw Object.assign(new Error("fiat is required"), { statusCode: 400 });
  if (!chainId) throw Object.assign(new Error("chainId is required"), { statusCode: 400 });
  if (!token) throw Object.assign(new Error("token is required"), { statusCode: 400 });
  if (!config.onramper.fiats.includes(fiat)) {
    throw Object.assign(new Error(`Unsupported fiat currency: ${fiat}`), { statusCode: 400 });
  }
  if (!onramperSupportedPair(chainId, token)) {
    throw Object.assign(new Error(`Card/bank payments are not available for ${token} on chain ${chainId}`), {
      statusCode: 400,
    });
  }

  const quote = await fetchOnrampQuote({
    apiKey: config.onramper.apiKey ?? "",
    demo: config.onramper.demo || !config.onramper.apiKey,
    widgetOrigin: config.onramper.widgetOrigin,
    fiat,
    chainId,
    token,
    country,
    paymentMethod,
    provider,
    direction,
    cryptoAmount: cryptoAmount ?? undefined,
    fiatAmount: fiatAmount ?? undefined,
  });

  sendJson(res, 200, quote);
}

async function getOnrampMethods(
  res: ServerResponse,
  { config }: RouteContext,
  url: URL
): Promise<void> {
  if (!config.onramper.enabled) {
    throw Object.assign(new Error("Card and bank payments are not enabled on this instance"), {
      statusCode: 503,
    });
  }

  const fiat = String(url.searchParams.get("fiat") ?? "").trim().toUpperCase();
  const chainId = String(url.searchParams.get("chainId") ?? url.searchParams.get("chain_id") ?? "").trim();
  const token = String(url.searchParams.get("token") ?? "").trim().toUpperCase();
  const country = String(url.searchParams.get("country") ?? "us").trim().toLowerCase();

  if (!fiat) throw Object.assign(new Error("fiat is required"), { statusCode: 400 });
  if (!chainId) throw Object.assign(new Error("chainId is required"), { statusCode: 400 });
  if (!token) throw Object.assign(new Error("token is required"), { statusCode: 400 });

  const methods = await fetchOnrampPaymentMethods({
    apiKey: config.onramper.apiKey ?? "",
    demo: config.onramper.demo || !config.onramper.apiKey,
    widgetOrigin: config.onramper.widgetOrigin,
    fiat,
    chainId,
    token,
    country,
  });

  sendJson(res, 200, { fiat, chainId, token, country, methods });
}

async function createOnrampSession(
  req: IncomingMessage,
  res: ServerResponse,
  { config, db }: RouteContext,
  invoiceId: string
): Promise<void> {
  if (!config.onramper.enabled) {
    throw Object.assign(new Error("Card and bank payments are not enabled on this instance"), {
      statusCode: 503,
    });
  }

  const invoice = db.getInvoice(invoiceId);
  if (!invoice) {
    throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
  }
  if (!paymentModeAllowsFiat(invoice.paymentMode)) {
    throw Object.assign(new Error("This invoice does not accept card or bank payment"), {
      statusCode: 400,
    });
  }
  if (!invoice.invoiceAddress || !invoice.chainId || !invoice.token) {
    throw Object.assign(new Error("Invoice is not ready for payment"), { statusCode: 409 });
  }
  if (isPaidLikeStatus(invoice.status)) {
    throw Object.assign(new Error("Invoice is already paid"), { statusCode: 409 });
  }

  const body = await readJson(req);
  const lockedFiat = invoice.displayFiat?.trim().toUpperCase();
  const fiat = (
    lockedFiat ??
    String(body.fiat ?? body.currency ?? invoice.payerFiat ?? "").trim().toUpperCase()
  );
  if (!fiat) {
    throw Object.assign(new Error("fiat is required"), { statusCode: 400 });
  }
  if (!config.onramper.fiats.includes(fiat)) {
    throw Object.assign(new Error(`Unsupported fiat currency: ${fiat}`), { statusCode: 400 });
  }

  if (!lockedFiat) {
    db.setPayerFiat(invoice.id, fiat);
  }

  const themeRaw = String(body.theme ?? "").trim().toLowerCase();
  const theme = themeRaw === "dark" ? "dark" : "light";

  let displayAmount = invoice.displayAmount;
  const lockedDisplayFiat = invoice.displayFiat?.trim().toUpperCase();
  const isFiatInvoice = invoice.paymentMode === "fiat" || Boolean(lockedDisplayFiat && displayAmount);

  if (isFiatInvoice && displayAmount && invoice.chainId && invoice.token) {
    const slippageBps = parseSlippageBps(invoice.quoteSlippageBps);
    const liveQuote = await fetchOnrampQuote({
      apiKey: config.onramper.apiKey ?? "",
      demo: config.onramper.demo || !config.onramper.apiKey,
      widgetOrigin: config.onramper.widgetOrigin,
      fiat,
      chainId: invoice.chainId,
      token: invoice.token,
      country: invoice.quoteCountry ?? "us",
      paymentMethod: invoice.quotePaymentMethod ?? "creditcard",
      provider: invoice.quoteProvider ?? undefined,
      direction: "pay",
      fiatAmount: displayAmount,
      skipCache: true,
    });
    if (!isSettlementWithinSlippage(invoice.priceUsd, liveQuote.cryptoAmount, slippageBps)) {
      const drift = settlementDriftBps(invoice.priceUsd, liveQuote.cryptoAmount);
      throw Object.assign(
        new Error(
          `Invoice quote expired: settlement moved ${drift} bps (limit ${slippageBps} bps). Create a new invoice and try again.`
        ),
        {
          statusCode: 410,
          code: "quote_expired",
          lockedSettlement: invoice.priceUsd,
          liveSettlement: liveQuote.cryptoAmount,
          slippageBps,
          driftBps: drift,
        }
      );
    }
    displayAmount = liveQuote.fiatAmount;
  }

  // Testnet demo: no Onramper keys — serve a local stub page so create/pay UX can be exercised.
  if (config.onramper.demo || !config.onramper.apiKey || !config.onramper.signingKey) {
    const demo = new URLSearchParams({
      invoiceId: invoice.id,
      fiat,
      price: invoice.priceUsd,
      token: invoice.token,
      chainId: invoice.chainId,
    });
    if (displayAmount) demo.set("displayAmount", displayAmount);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    sendJson(res, 200, {
      // Relative so browser uses the same API origin (gateway or Vite proxy).
      widgetUrl: `/api/public/onramp-demo?${demo.toString()}`,
      expiresAt,
      fiat,
      displayAmount: displayAmount ?? null,
      demo: true,
    });
    return;
  }

  const resumePath = `/pay?${encodeInvoiceResumeLink(invoice.id)}`;
  const successRedirectUrl = new URL(resumePath, config.baseUrl).toString();

  if (!displayAmount && fiat !== "USD") {
    const quote = await fetchOnrampQuote({
      apiKey: config.onramper.apiKey ?? "",
      demo: false,
      widgetOrigin: config.onramper.widgetOrigin,
      fiat,
      chainId: invoice.chainId,
      token: invoice.token,
      country: invoice.quoteCountry ?? "us",
      paymentMethod: invoice.quotePaymentMethod ?? "creditcard",
      direction: "receive",
      cryptoAmount: invoice.priceUsd,
      skipCache: true,
    });
    displayAmount = quote.fiatAmount;
  }

  const session = buildOnrampWidgetSession({
    apiKey: config.onramper.apiKey ?? "",
    signingKeyPem: config.onramper.signingKey,
    widgetOrigin: config.onramper.widgetOrigin,
    invoiceId: invoice.id,
    invoiceAddress: invoice.invoiceAddress,
    chainId: invoice.chainId,
    token: invoice.token,
    priceUsd: invoice.priceUsd,
    fiat,
    displayAmount,
    defaultPaymentMethod: invoice.quotePaymentMethod,
    onlyOnramps: invoice.quoteProvider,
    theme,
    lockFiat: invoice.paymentMode === "fiat" || Boolean(lockedFiat),
    successRedirectUrl,
    failureRedirectUrl: successRedirectUrl,
  });

  sendJson(res, 200, {
    widgetUrl: session.widgetUrl,
    expiresAt: session.expiresAt,
    fiat,
    displayAmount: displayAmount ?? null,
    quoteProvider: invoice.quoteProvider,
    quoteSlippageBps: invoice.quoteSlippageBps,
  });
}

function assertPaymentModeAllowed(
  paymentMode: PaymentMode,
  fields: PayLinkFields,
  config: AppConfig
): void {
  if (paymentMode === "crypto") return;
  if (!config.onramper.enabled) {
    throw Object.assign(new Error("Card and bank payments are not enabled on this instance"), {
      statusCode: 400,
    });
  }
  if (paymentMode === "fiat") {
    if (fields.chains.length !== 1 || fields.tokens.length !== 1) {
      throw Object.assign(
        new Error("Fiat-only invoices require exactly one chain and one token"),
        { statusCode: 400 }
      );
    }
  }
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
  const before = db.getInvoice(body.invoiceId);
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

  // Callback on first transition into paid / paid_partial / swept (not on every re-track).
  const becamePaidLike =
    isPaidLikeStatus(invoice.status) && (!before || !isPaidLikeStatus(before.status) || before.status !== invoice.status);
  if (becamePaidLike && invoice.callbackUrl) {
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
): Promise<string> {
  const kind = chainKind(chainId);
  if (kind === "tron") {
    if (!config.tronInvoiceMasterSecret) {
      throw Object.assign(
        new Error("TRON_INVOICE_MASTER_SECRET is required to create Tron invoices"),
        { statusCode: 503 }
      );
    }
    const fullHost = config.tronFullHost ?? defaultTronFullHost(chainId);
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

  const evm = resolveEvmChain(config.evmChains, chainId);
  if (!evm?.sweeperAddress) {
    throw Object.assign(
      new Error(
        `EVM chain ${chainId} is not configured — set EVM_${chainId}_SWEEPER_ADDRESS and EVM_${chainId}_FORWARDER_IMPLEMENTATION (or legacy SWEEPER_ADDRESS for Sepolia)`
      ),
      { statusCode: 503 }
    );
  }
  // Prefer offline CREATE2 via forwarderImplementation. RPC lookup is a fallback when only sweeper is set.
  if (evm.forwarderImplementation) {
    return predictCommerceInvoiceAddress(
      evm.sweeperAddress,
      evm.forwarderImplementation,
      selectedTo,
      invoiceId
    );
  }
  if (!evm.rpcUrl) {
    throw Object.assign(
      new Error(
        `EVM_${chainId}_FORWARDER_IMPLEMENTATION (preferred) or EVM_${chainId}_RPC_URL is required when sweeper address is set`
      ),
      { statusCode: 503 }
    );
  }
  const provider = new JsonRpcProvider(evm.rpcUrl);
  const sdk = new CommerceInvoiceSdk({ provider, sweeperAddress: evm.sweeperAddress });
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

function assertTokenChainPair(chainId: string, token: string, config?: AppConfig): void {
  if (!tokenAllowedOnChain(chainId, token)) {
    throw Object.assign(
      new Error(`Token ${token} is not allowed on chain ${chainId}`),
      { statusCode: 400 }
    );
  }
  if (!config || chainKind(chainId) !== "evm") return;
  const chain = config.evmChains[String(chainId)];
  const tokens = chain?.tokens;
  if (!tokens || Object.keys(tokens).length === 0) return;
  const symbol = token.trim().toUpperCase();
  if (!tokens[symbol]?.address) {
    throw Object.assign(
      new Error(`Token ${symbol} is not configured for EVM chain ${chainId}`),
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

async function readRawBody(req: IncomingMessage, maxBytes = 64_000): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) {
      throw Object.assign(new Error("Request body too large"), { statusCode: 413 });
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const raw = await readRawBody(req);
  if (raw.length === 0) return {};
  return JSON.parse(raw.toString("utf8")) as Record<string, unknown>;
}

async function handleOnrampWebhook(
  req: IncomingMessage,
  res: ServerResponse,
  { config }: RouteContext
): Promise<void> {
  const secret = config.onramper.webhookSecret;
  if (!secret) {
    throw Object.assign(new Error("Onramper webhooks are not configured"), { statusCode: 503 });
  }
  const raw = await readRawBody(req);
  const signature = String(
    req.headers["x-onramper-webhook-signature"] ?? req.headers["x-onramper-signature"] ?? ""
  );
  if (!verifyOnramperWebhookSignature(secret, signature, raw.toString("utf8"))) {
    throw Object.assign(new Error("Invalid Onramper webhook signature"), { statusCode: 401 });
  }
  sendJson(res, 200, { received: true });
}

function sendOnrampDemoHtml(res: ServerResponse, url: URL): void {
  const fiat = escapeHtmlAttr(url.searchParams.get("fiat") ?? "USD");
  const price = escapeHtmlAttr(url.searchParams.get("price") ?? "");
  const token = escapeHtmlAttr(url.searchParams.get("token") ?? "USDC");
  const chainId = escapeHtmlAttr(url.searchParams.get("chainId") ?? "");
  const invoiceId = escapeHtmlAttr(url.searchParams.get("invoiceId") ?? "");
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sandbox card checkout</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, sans-serif; }
    body { margin: 0; padding: 1.5rem; background: #f6f9fc; color: #0a2540; }
    .panel { background: #fff; border: 1px solid #e3e8ee; border-radius: 12px; padding: 1.25rem 1.35rem; max-width: 28rem; }
    h1 { font-size: 1.15rem; margin: 0 0 0.5rem; }
    p { margin: 0.4rem 0; line-height: 1.45; color: #425466; font-size: 0.95rem; }
    .amount { font-size: 1.5rem; font-weight: 650; color: #0a2540; margin: 0.75rem 0; }
    .badge { display: inline-block; background: #eef3ff; color: #0a6cff; font-size: 0.75rem; font-weight: 600; padding: 0.2rem 0.5rem; border-radius: 999px; }
    code { font-size: 0.8rem; word-break: break-all; }
  </style>
</head>
<body>
  <div class="panel">
    <span class="badge">Sandbox demo</span>
    <h1>Card or bank checkout</h1>
    <p class="amount">$${price} · ${fiat}</p>
    <p>Settles as <strong>${token}</strong> on chain <code>${chainId}</code>.</p>
    <p>This is a local stub — no real card charge and no on-chain funding. On mainnet, set Onramper API + signing keys to load the live widget.</p>
    <p>Invoice <code>${invoiceId}</code></p>
  </div>
</body>
</html>`;
  res.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-frame-options": "SAMEORIGIN",
    "content-security-policy": "frame-ancestors 'self'",
  });
  res.end(html);
}

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

function isPaidLikeStatus(status: InvoiceStatus): boolean {
  return status === "paid" || status === "paid_partial" || status === "swept";
}

function bigintReplacer(_: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

// silence unused PayLinkFields import warning in some tsc configs
export type { PayLinkFields };
