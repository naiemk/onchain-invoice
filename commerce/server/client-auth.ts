import type { IncomingMessage } from "node:http";
import { createHmac, createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { CommerceDb } from "./db.js";
import type { WalletClientRecord } from "../shared/wallet.js";

const SKEW_MS = 5 * 60 * 1000;
const NONCE_TTL_MS = 10 * 60 * 1000;

export interface WalletClientAuth {
  client: WalletClientRecord;
  /** Full row including secret — never return to HTTP clients. */
  hmacSecret: string;
}

export function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function canonicalClientMessage(input: {
  method: string;
  path: string;
  bodyHash: string;
  timestamp: string;
  nonce: string;
}): string {
  return [
    "Trustless Commerce client request",
    `Method: ${input.method}`,
    `Path: ${input.path}`,
    `Body-SHA256: ${input.bodyHash}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
  ].join("\n");
}

export function signClientCanonical(hmacSecret: string, message: string): string {
  return createHmac("sha256", hmacSecret).update(message).digest("hex");
}

/** Build signed headers for a wallet-client HTTP caller (tests / partner SDKs). */
export function signClientRequest(
  clientId: string,
  hmacSecret: string,
  input: { method: string; path: string; body?: string }
): Record<string, string> {
  const body = input.body ?? "";
  const bodyHash = hashBody(body);
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const message = canonicalClientMessage({
    method: input.method.toUpperCase(),
    path: input.path,
    bodyHash,
    timestamp,
    nonce,
  });
  const signature = signClientCanonical(hmacSecret, message);
  return {
    "x-client-id": clientId,
    "x-client-timestamp": timestamp,
    "x-client-nonce": nonce,
    "x-client-body-hash": bodyHash,
    "x-client-signature": signature,
  };
}

export function generateHmacSecret(): string {
  return randomBytes(32).toString("hex");
}

/**
 * Verify HMAC client request headers.
 * Pass `rawBody` when available so body-hash is checked against the actual payload.
 */
export function requireWalletClient(
  req: IncomingMessage,
  db: CommerceDb,
  rawBody?: string
): WalletClientAuth {
  const clientId = header(req, "x-client-id");
  const timestamp = header(req, "x-client-timestamp");
  const nonce = header(req, "x-client-nonce");
  const signature = header(req, "x-client-signature");
  if (!clientId || !timestamp || !nonce || !signature) {
    throw Object.assign(new Error("Missing client HMAC headers"), { statusCode: 401 });
  }

  const row = db.getWalletClientSecret(clientId);
  if (!row || !row.enabled) {
    throw Object.assign(new Error("Client not registered or disabled"), { statusCode: 401 });
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > SKEW_MS) {
    throw Object.assign(new Error("Client timestamp skew too large"), { statusCode: 401 });
  }

  if (!db.consumeWalletClientNonce(clientId, nonce, NONCE_TTL_MS)) {
    throw Object.assign(new Error("Client nonce already used"), { statusCode: 401 });
  }

  const method = (req.method ?? "GET").toUpperCase();
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const claimedHash = header(req, "x-client-body-hash") ?? hashBody("");
  if (rawBody !== undefined) {
    const actual = hashBody(rawBody);
    if (!safeEqualHex(actual, claimedHash)) {
      throw Object.assign(new Error("Client body hash mismatch"), { statusCode: 401 });
    }
  }

  const message = canonicalClientMessage({
    method,
    path,
    bodyHash: claimedHash,
    timestamp,
    nonce,
  });
  const expected = signClientCanonical(row.hmacSecret, message);
  if (!safeEqualHex(expected, signature)) {
    throw Object.assign(new Error("Invalid client signature"), { statusCode: 401 });
  }

  db.touchWalletClient(clientId);
  return {
    client: {
      id: row.id,
      label: row.label,
      rpId: row.rpId,
      origins: row.origins,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
    hmacSecret: row.hmacSecret,
  };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}

function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a.toLowerCase());
  const right = Buffer.from(b.toLowerCase());
  return left.length === right.length && timingSafeEqual(left, right);
}
