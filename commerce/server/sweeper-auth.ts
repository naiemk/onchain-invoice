import type { IncomingMessage } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { getAddress, verifyMessage, type Wallet } from "ethers";
import type { CommerceDb } from "./db.js";

const SKEW_MS = 5 * 60 * 1000;
const NONCE_TTL_MS = 10 * 60 * 1000;

export interface SweeperAuth {
  address: string;
}

export function requireSweeper(req: IncomingMessage, db: CommerceDb): SweeperAuth {
  const addressHeader = header(req, "x-sweeper-address");
  const timestamp = header(req, "x-sweeper-timestamp");
  const nonce = header(req, "x-sweeper-nonce");
  const signature = header(req, "x-sweeper-signature");
  if (!addressHeader || !timestamp || !nonce || !signature) {
    throw Object.assign(new Error("Missing sweeper signature headers"), { statusCode: 401 });
  }

  const address = getAddress(addressHeader);
  const sweeper = db.getSweeper(address);
  if (!sweeper || !sweeper.enabled) {
    throw Object.assign(new Error("Sweeper not registered or disabled"), { statusCode: 401 });
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > SKEW_MS) {
    throw Object.assign(new Error("Sweeper timestamp skew too large"), { statusCode: 401 });
  }

  if (!db.consumeNonce(address, nonce, NONCE_TTL_MS)) {
    throw Object.assign(new Error("Sweeper nonce already used"), { statusCode: 401 });
  }

  const method = (req.method ?? "GET").toUpperCase();
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const bodyHash = header(req, "x-sweeper-body-hash") ?? hashBody("");
  const message = canonicalMessage({ method, path, bodyHash, timestamp, nonce });
  const recovered = getAddress(verifyMessage(message, signature));
  if (recovered !== address) {
    throw Object.assign(new Error("Invalid sweeper signature"), { statusCode: 401 });
  }

  db.touchSweeper(address);
  return { address };
}

export function hashBody(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

export function canonicalMessage(input: {
  method: string;
  path: string;
  bodyHash: string;
  timestamp: string;
  nonce: string;
}): string {
  return [
    "Trustless Commerce sweeper request",
    `Method: ${input.method}`,
    `Path: ${input.path}`,
    `Body-SHA256: ${input.bodyHash}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
  ].join("\n");
}

/** Build signed headers for a sweeper HTTP client. */
export async function signSweeperRequest(
  wallet: Wallet,
  input: { method: string; path: string; body?: string }
): Promise<Record<string, string>> {
  const body = input.body ?? "";
  const bodyHash = hashBody(body);
  const timestamp = String(Date.now());
  const nonce = randomUUID();
  const message = canonicalMessage({
    method: input.method.toUpperCase(),
    path: input.path,
    bodyHash,
    timestamp,
    nonce,
  });
  const signature = await wallet.signMessage(message);
  return {
    "x-sweeper-address": wallet.address,
    "x-sweeper-timestamp": timestamp,
    "x-sweeper-nonce": nonce,
    "x-sweeper-body-hash": bodyHash,
    "x-sweeper-signature": signature,
  };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}
