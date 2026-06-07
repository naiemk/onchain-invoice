import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { URL } from "node:url";
import Database from "better-sqlite3";

export interface WebSession {
  id: string;
  createdAt: number;
  lastAccessedAt: number;
  metadata?: JsonObject;
}

export interface WebInvoiceRecord<TInput = JsonValue, TInvoice extends JsonObject = JsonObject> {
  id: string;
  sessionId: string;
  input: TInput;
  invoice: TInvoice;
  createdAt: number;
  updatedAt: number;
  lastAccessedAt: number;
}

export interface WebRequestContext {
  headers: IncomingMessage["headers"];
  ip?: string;
  userAgent?: string;
  cfConnectingIp?: string;
  cfRay?: string;
}

export interface CalculateInvoiceContext {
  session: WebSession;
  request: WebRequestContext;
}

export interface CaptchaContext {
  request: WebRequestContext;
  action: "session" | "registerInvoice";
  session?: WebSession;
}

export interface RegisterInvoiceBody<TInput = JsonValue> {
  input: TInput;
  captchaToken?: string;
}

export interface CreateSessionBody {
  captchaToken?: string;
  metadata?: JsonObject;
}

export interface CreateSessionResponse {
  token: string;
  session: WebSession;
}

export interface ListInvoicesResponse<TInput = JsonValue, TInvoice extends JsonObject = JsonObject> {
  invoices: Array<WebInvoiceRecord<TInput, TInvoice>>;
  nextCursor?: string;
}

export interface InvoiceWebServerOptions<TInput = JsonValue, TInvoice extends JsonObject = JsonObject> {
  jwtSecret: string;
  calculateInvoice: (input: TInput, context: CalculateInvoiceContext) => Promise<TInvoice> | TInvoice;
  verifyCaptcha?: (token: string | undefined, context: CaptchaContext) => Promise<boolean> | boolean;
  requireCaptchaForSession?: boolean;
  requireCaptchaForRegisterInvoice?: boolean;
  sessionTtlMs?: number;
  corsOrigin?: string | string[];
  nodeApiKey?: string;
  sqlitePath?: string;
  maxBodyBytes?: number;
  maxInvoices?: number;
  maxInvoicesPerSession?: number;
}

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  [key: string]: JsonValue | undefined;
}

interface JwtPayload {
  sub: string;
  type: "ui";
  iat: number;
  exp: number;
}

interface AuthContext {
  session?: WebSession;
  isNode: boolean;
}

const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_MAX_BODY_BYTES = 64 * 1024;
const DEFAULT_MAX_INVOICES = 10_000;
const DEFAULT_MAX_INVOICES_PER_SESSION = 1_000;

export class InvoiceWebServer<TInput = JsonValue, TInvoice extends JsonObject = JsonObject> {
  private readonly store: SqliteInvoiceStore<TInput, TInvoice>;
  private readonly options: Required<
    Pick<
      InvoiceWebServerOptions<TInput, TInvoice>,
      "sessionTtlMs" | "maxBodyBytes" | "maxInvoices" | "maxInvoicesPerSession"
    >
  > &
    InvoiceWebServerOptions<TInput, TInvoice>;

  private server?: Server;

  constructor(options: InvoiceWebServerOptions<TInput, TInvoice>) {
    this.options = {
      sessionTtlMs: DEFAULT_SESSION_TTL_MS,
      maxBodyBytes: DEFAULT_MAX_BODY_BYTES,
      maxInvoices: DEFAULT_MAX_INVOICES,
      maxInvoicesPerSession: DEFAULT_MAX_INVOICES_PER_SESSION,
      ...options,
    };
    this.store = new SqliteInvoiceStore<TInput, TInvoice>(options.sqlitePath ?? "onchain-invoice.sqlite");
  }

  async run(host: string, port: number): Promise<AddressInfo> {
    if (this.server) throw new Error("Invoice web server is already running");

    this.server = createServer((request, response) => {
      void this.handle(request, response);
    });

    await new Promise<void>((resolve) => {
      this.server?.listen(port, host, resolve);
    });

    return this.server.address() as AddressInfo;
  }

  async close(): Promise<void> {
    if (!this.server) return;

    await new Promise<void>((resolve, reject) => {
      this.server?.close((error) => (error ? reject(error) : resolve()));
    });
    this.server = undefined;
    this.store.close();
  }

  private async handle(request: IncomingMessage, response: ServerResponse) {
    try {
      setCorsHeaders(response, request, this.options.corsOrigin);
      if (request.method === "OPTIONS") {
        response.writeHead(204);
        response.end();
        return;
      }

      const url = new URL(request.url ?? "/", "http://localhost");
      const context = getRequestContext(request);

      if (request.method === "POST" && url.pathname === "/sessions") {
        await this.handleCreateSession(request, response, context);
        return;
      }

      if (request.method === "POST" && url.pathname === "/invoices") {
        const auth = this.requireAuth(request);
        if (!auth.session) throw new HttpError(401, "UI session token required");
        await this.handleRegisterInvoice(request, response, context, auth.session);
        return;
      }

      if (request.method === "GET" && url.pathname === "/me/invoices") {
        const auth = this.requireAuth(request);
        if (!auth.session) throw new HttpError(401, "UI session token required");
        this.handleMyInvoices(response, url, auth.session);
        return;
      }

      if (request.method === "GET" && url.pathname.startsWith("/invoices/")) {
        const auth = this.requireAuth(request);
        this.handleFetchInvoice(response, decodeURIComponent(url.pathname.slice("/invoices/".length)), auth);
        return;
      }

      if (request.method === "GET" && url.pathname === "/invoices") {
        const auth = this.requireAuth(request);
        this.handleListInvoices(response, url, auth);
        return;
      }

      throw new HttpError(404, "Not found");
    } catch (error) {
      writeError(response, error);
    }
  }

  private async handleCreateSession(
    request: IncomingMessage,
    response: ServerResponse,
    context: WebRequestContext
  ) {
    const body = await readJsonBody<CreateSessionBody>(request, this.options.maxBodyBytes);

    if (this.options.requireCaptchaForSession) {
      await this.verifyCaptcha(body.captchaToken, { request: context, action: "session" });
    }

    const now = Date.now();
    const session: WebSession = {
      id: randomUUID(),
      createdAt: now,
      lastAccessedAt: now,
      metadata: body.metadata,
    };

    this.store.saveSession(session);

    writeJson<CreateSessionResponse>(response, 201, {
      token: this.signJwt(session),
      session,
    });
  }

  private async handleRegisterInvoice(
    request: IncomingMessage,
    response: ServerResponse,
    context: WebRequestContext,
    session: WebSession
  ) {
    const body = await readJsonBody<RegisterInvoiceBody<TInput>>(request, this.options.maxBodyBytes);
    if (!("input" in body)) throw new HttpError(400, "input is required");

    if (this.options.requireCaptchaForRegisterInvoice) {
      await this.verifyCaptcha(body.captchaToken, { request: context, action: "registerInvoice", session });
    }

    const invoice = await this.options.calculateInvoice(body.input, { session, request: context });
    const invoiceId = extractInvoiceId(invoice);
    const now = Date.now();
    const record: WebInvoiceRecord<TInput, TInvoice> = {
      id: invoiceId,
      sessionId: session.id,
      input: body.input,
      invoice,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
    };

    this.store.saveInvoice(record);
    this.store.trackSessionInvoice(session.id, invoiceId, this.options.maxInvoicesPerSession);
    this.store.pruneInvoices(this.options.maxInvoices);
    touchSession(session);
    this.store.saveSession(session);

    writeJson(response, 201, record);
  }

  private handleMyInvoices(response: ServerResponse, url: URL, session: WebSession) {
    const limit = getLimit(url, 100);
    const records = this.store.listSessionInvoices(session.id, limit);

    touchSession(session);
    this.store.saveSession(session);
    writeJson<ListInvoicesResponse<TInput, TInvoice>>(response, 200, { invoices: records });
  }

  private handleFetchInvoice(response: ServerResponse, invoiceId: string, auth: AuthContext) {
    const record = this.store.getInvoice(invoiceId);
    if (!record) throw new HttpError(404, "Invoice not found");

    touchInvoice(record);
    this.store.saveInvoice(record);
    if (auth.session) {
      this.store.trackSessionInvoice(auth.session.id, invoiceId, this.options.maxInvoicesPerSession);
      touchSession(auth.session);
      this.store.saveSession(auth.session);
    }

    writeJson(response, 200, record);
  }

  private handleListInvoices(response: ServerResponse, url: URL, auth: AuthContext) {
    if (!auth.isNode && !auth.session) throw new HttpError(401, "Authorization required");

    const limit = getLimit(url, 500);
    const cursor = Number(url.searchParams.get("cursor") ?? "0");
    const lookbackMs = url.searchParams.has("lookbackMs")
      ? Number(url.searchParams.get("lookbackMs"))
      : undefined;
    const cutoff = lookbackMs === undefined ? undefined : Date.now() - lookbackMs;
    const { invoices, nextCursor } = this.store.listInvoices({ cutoff, cursor, limit });

    writeJson<ListInvoicesResponse<TInput, TInvoice>>(response, 200, { invoices, nextCursor });
  }

  private requireAuth(request: IncomingMessage): AuthContext {
    const apiKey = request.headers["x-api-key"];
    if (
      this.options.nodeApiKey &&
      typeof apiKey === "string" &&
      constantTimeEqual(apiKey, this.options.nodeApiKey)
    ) {
      return { isNode: true };
    }

    const authorization = request.headers.authorization;
    if (!authorization?.startsWith("Bearer ")) throw new HttpError(401, "Bearer token required");

    const payload = this.verifyJwt(authorization.slice("Bearer ".length));
    const session = this.store.getSession(payload.sub);
    if (!session) throw new HttpError(401, "Session not found");

    touchSession(session);
    this.store.saveSession(session);
    return { session, isNode: false };
  }

  private async verifyCaptcha(token: string | undefined, context: CaptchaContext) {
    if (!this.options.verifyCaptcha) throw new HttpError(400, "Captcha verifier is not configured");
    const ok = await this.options.verifyCaptcha(token, context);
    if (!ok) throw new HttpError(403, "Captcha verification failed");
  }

  private signJwt(session: WebSession): string {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const payload: JwtPayload = {
      sub: session.id,
      type: "ui",
      iat: nowSeconds,
      exp: nowSeconds + Math.floor(this.options.sessionTtlMs / 1000),
    };
    return signJwt(payload, this.options.jwtSecret);
  }

  private verifyJwt(token: string): JwtPayload {
    const payload = verifyJwt(token, this.options.jwtSecret);
    if (payload.type !== "ui") throw new HttpError(401, "Invalid token type");
    if (payload.exp * 1000 < Date.now()) throw new HttpError(401, "Token expired");
    return payload;
  }

}

interface SessionRow {
  id: string;
  created_at: number;
  last_accessed_at: number;
  metadata_json: string | null;
}

interface InvoiceRow {
  id: string;
  session_id: string;
  input_json: string;
  invoice_json: string;
  created_at: number;
  updated_at: number;
  last_accessed_at: number;
}

class SqliteInvoiceStore<TInput, TInvoice extends JsonObject> {
  private readonly db: Database.Database;

  constructor(sqlitePath: string) {
    this.db = new Database(sqlitePath);
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        created_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        metadata_json TEXT
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        input_json TEXT NOT NULL,
        invoice_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_accessed_at INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS session_invoices (
        session_id TEXT NOT NULL,
        invoice_id TEXT NOT NULL,
        position INTEGER NOT NULL,
        PRIMARY KEY (session_id, invoice_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_invoices_updated_at ON invoices(updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_invoices_last_accessed_at ON invoices(last_accessed_at DESC);
      CREATE INDEX IF NOT EXISTS idx_session_invoices_position ON session_invoices(session_id, position DESC);
    `);
  }

  close() {
    this.db.close();
  }

  saveSession(session: WebSession) {
    this.db
      .prepare(
        `
          INSERT INTO sessions (id, created_at, last_accessed_at, metadata_json)
          VALUES (@id, @createdAt, @lastAccessedAt, @metadataJson)
          ON CONFLICT(id) DO UPDATE SET
            last_accessed_at = excluded.last_accessed_at,
            metadata_json = excluded.metadata_json
        `
      )
      .run({
        id: session.id,
        createdAt: session.createdAt,
        lastAccessedAt: session.lastAccessedAt,
        metadataJson: session.metadata === undefined ? null : JSON.stringify(session.metadata, jsonReplacer),
      });
  }

  getSession(sessionId: string): WebSession | undefined {
    const row = this.db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as SessionRow | undefined;
    if (!row) return undefined;

    return {
      id: row.id,
      createdAt: row.created_at,
      lastAccessedAt: row.last_accessed_at,
      metadata: row.metadata_json === null ? undefined : (JSON.parse(row.metadata_json) as JsonObject),
    };
  }

  saveInvoice(record: WebInvoiceRecord<TInput, TInvoice>) {
    this.db
      .prepare(
        `
          INSERT INTO invoices (
            id, session_id, input_json, invoice_json, created_at, updated_at, last_accessed_at
          )
          VALUES (@id, @sessionId, @inputJson, @invoiceJson, @createdAt, @updatedAt, @lastAccessedAt)
          ON CONFLICT(id) DO UPDATE SET
            session_id = excluded.session_id,
            input_json = excluded.input_json,
            invoice_json = excluded.invoice_json,
            updated_at = excluded.updated_at,
            last_accessed_at = excluded.last_accessed_at
        `
      )
      .run({
        id: record.id,
        sessionId: record.sessionId,
        inputJson: JSON.stringify(record.input, jsonReplacer),
        invoiceJson: JSON.stringify(record.invoice, jsonReplacer),
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        lastAccessedAt: record.lastAccessedAt,
      });
  }

  getInvoice(invoiceId: string): WebInvoiceRecord<TInput, TInvoice> | undefined {
    const row = this.db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as InvoiceRow | undefined;
    return row ? this.invoiceFromRow(row) : undefined;
  }

  listSessionInvoices(sessionId: string, limit: number): Array<WebInvoiceRecord<TInput, TInvoice>> {
    const rows = this.db
      .prepare(
        `
          SELECT invoices.*
          FROM session_invoices
          JOIN invoices ON invoices.id = session_invoices.invoice_id
          WHERE session_invoices.session_id = ?
          ORDER BY session_invoices.position DESC
          LIMIT ?
        `
      )
      .all(sessionId, limit) as InvoiceRow[];

    return rows.map((row) => this.invoiceFromRow(row));
  }

  listInvoices(options: {
    cutoff?: number;
    cursor: number;
    limit: number;
  }): { invoices: Array<WebInvoiceRecord<TInput, TInvoice>>; nextCursor?: string } {
    const rows = this.db
      .prepare(
        options.cutoff === undefined
          ? `
              SELECT *
              FROM invoices
              ORDER BY updated_at DESC
              LIMIT ? OFFSET ?
            `
          : `
              SELECT *
              FROM invoices
              WHERE updated_at >= ? OR last_accessed_at >= ?
              ORDER BY updated_at DESC
              LIMIT ? OFFSET ?
            `
      )
      .all(
        ...(options.cutoff === undefined
          ? [options.limit + 1, options.cursor]
          : [options.cutoff, options.cutoff, options.limit + 1, options.cursor])
      ) as InvoiceRow[];

    const hasNext = rows.length > options.limit;
    const invoices = rows.slice(0, options.limit).map((row) => this.invoiceFromRow(row));
    return {
      invoices,
      nextCursor: hasNext ? String(options.cursor + options.limit) : undefined,
    };
  }

  trackSessionInvoice(sessionId: string, invoiceId: string, maxInvoicesPerSession: number) {
    const now = Date.now();
    const transaction = this.db.transaction(() => {
      this.db
        .prepare(
          `
            INSERT INTO session_invoices (session_id, invoice_id, position)
            VALUES (?, ?, ?)
            ON CONFLICT(session_id, invoice_id) DO UPDATE SET position = excluded.position
          `
        )
        .run(sessionId, invoiceId, now);

      this.db
        .prepare(
          `
            DELETE FROM session_invoices
            WHERE session_id = ?
              AND invoice_id NOT IN (
                SELECT invoice_id
                FROM session_invoices
                WHERE session_id = ?
                ORDER BY position DESC
                LIMIT ?
              )
          `
        )
        .run(sessionId, sessionId, maxInvoicesPerSession);
    });

    transaction();
  }

  pruneInvoices(maxInvoices: number) {
    this.db
      .prepare(
        `
          DELETE FROM invoices
          WHERE id NOT IN (
            SELECT id
            FROM invoices
            ORDER BY last_accessed_at DESC
            LIMIT ?
          )
        `
      )
      .run(maxInvoices);
  }

  private invoiceFromRow(row: InvoiceRow): WebInvoiceRecord<TInput, TInvoice> {
    return {
      id: row.id,
      sessionId: row.session_id,
      input: JSON.parse(row.input_json) as TInput,
      invoice: JSON.parse(row.invoice_json) as TInvoice,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      lastAccessedAt: row.last_accessed_at,
    };
  }
}

export function createCloudflareTurnstileVerifier(secret: string) {
  return async (token: string | undefined, context: CaptchaContext): Promise<boolean> => {
    if (!token) return false;

    const form = new URLSearchParams();
    form.set("secret", secret);
    form.set("response", token);
    if (context.request.ip) form.set("remoteip", context.request.ip);

    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: form,
    });
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  };
}

function signJwt(payload: JwtPayload, secret: string): string {
  const header = { alg: "HS256", typ: "JWT" };
  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = hmac(`${encodedHeader}.${encodedPayload}`, secret);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyJwt(token: string, secret: string): JwtPayload {
  const [encodedHeader, encodedPayload, signature] = token.split(".");
  if (!encodedHeader || !encodedPayload || !signature) throw new HttpError(401, "Invalid token");

  const expected = hmac(`${encodedHeader}.${encodedPayload}`, secret);
  if (!constantTimeEqual(signature, expected)) throw new HttpError(401, "Invalid token signature");

  return JSON.parse(base64UrlDecode(encodedPayload)) as JwtPayload;
}

function hmac(value: string, secret: string) {
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function base64UrlEncode(value: string) {
  return Buffer.from(value).toString("base64url");
}

function base64UrlDecode(value: string) {
  return Buffer.from(value, "base64url").toString();
}

async function readJsonBody<T>(request: IncomingMessage, maxBodyBytes: number): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new HttpError(413, "Request body too large");
    chunks.push(buffer);
  }

  if (chunks.length === 0) return {} as T;

  try {
    return JSON.parse(Buffer.concat(chunks).toString()) as T;
  } catch {
    throw new HttpError(400, "Invalid JSON body");
  }
}

function writeJson<T>(response: ServerResponse, statusCode: number, body: T) {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(JSON.stringify(body, jsonReplacer));
}

function writeError(response: ServerResponse, error: unknown) {
  const statusCode = error instanceof HttpError ? error.statusCode : 500;
  const message = error instanceof Error ? error.message : "Internal server error";
  writeJson(response, statusCode, { error: message });
}

function jsonReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}

function setCorsHeaders(response: ServerResponse, request: IncomingMessage, corsOrigin?: string | string[]) {
  const origin = request.headers.origin;
  const allowedOrigin = Array.isArray(corsOrigin)
    ? origin && corsOrigin.includes(origin)
      ? origin
      : undefined
    : corsOrigin;

  if (allowedOrigin) response.setHeader("access-control-allow-origin", allowedOrigin);
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type,authorization,x-api-key");
}

function getRequestContext(request: IncomingMessage): WebRequestContext {
  const forwardedFor = request.headers["x-forwarded-for"];
  const ip = typeof forwardedFor === "string" ? forwardedFor.split(",")[0]?.trim() : request.socket.remoteAddress;

  return {
    headers: request.headers,
    ip,
    userAgent: request.headers["user-agent"],
    cfConnectingIp: stringHeader(request.headers["cf-connecting-ip"]),
    cfRay: stringHeader(request.headers["cf-ray"]),
  };
}

function extractInvoiceId(invoice: JsonObject) {
  const invoiceId = invoice.invoiceId;
  if (typeof invoiceId === "string" && invoiceId.length > 0) return invoiceId;
  return randomUUID();
}

function getLimit(url: URL, defaultLimit: number) {
  const raw = Number(url.searchParams.get("limit") ?? defaultLimit);
  if (!Number.isFinite(raw)) return defaultLimit;
  return Math.max(1, Math.min(1_000, Math.floor(raw)));
}

function touchSession(session: WebSession) {
  session.lastAccessedAt = Date.now();
}

function touchInvoice(invoice: { lastAccessedAt: number }) {
  invoice.lastAccessedAt = Date.now();
}

function stringHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function constantTimeEqual(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string
  ) {
    super(message);
  }
}
