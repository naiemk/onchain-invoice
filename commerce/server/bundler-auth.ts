import type { IncomingMessage } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { getAddress, verifyMessage, type Wallet } from "ethers";
import type { CommerceDb } from "./db.js";

const SKEW_MS = 5 * 60 * 1000;
const NONCE_TTL_MS = 10 * 60 * 1000;

export interface BundlerAuth {
  address: string;
}

export function requireBundler(req: IncomingMessage, db: CommerceDb): BundlerAuth {
  const addressHeader = header(req, "x-bundler-address");
  const timestamp = header(req, "x-bundler-timestamp");
  const nonce = header(req, "x-bundler-nonce");
  const signature = header(req, "x-bundler-signature");
  if (!addressHeader || !timestamp || !nonce || !signature) {
    throw Object.assign(new Error("Missing bundler signature headers"), { statusCode: 401 });
  }

  const address = getAddress(addressHeader);
  const bundler = db.getBundler(address);
  if (!bundler || !bundler.enabled) {
    throw Object.assign(new Error("Bundler not registered or disabled"), { statusCode: 401 });
  }

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > SKEW_MS) {
    throw Object.assign(new Error("Bundler timestamp skew too large"), { statusCode: 401 });
  }

  if (!db.consumeBundlerNonce(address, nonce, NONCE_TTL_MS)) {
    throw Object.assign(new Error("Bundler nonce already used"), { statusCode: 401 });
  }

  const method = (req.method ?? "GET").toUpperCase();
  const path = new URL(req.url ?? "/", "http://localhost").pathname;
  const bodyHash = header(req, "x-bundler-body-hash") ?? hashBody("");
  const message = canonicalMessage({ method, path, bodyHash, timestamp, nonce });
  const recovered = getAddress(verifyMessage(message, signature));
  if (recovered !== address) {
    throw Object.assign(new Error("Invalid bundler signature"), { statusCode: 401 });
  }

  db.touchBundler(address);
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
    "Trustless Commerce bundler request",
    `Method: ${input.method}`,
    `Path: ${input.path}`,
    `Body-SHA256: ${input.bodyHash}`,
    `Timestamp: ${input.timestamp}`,
    `Nonce: ${input.nonce}`,
  ].join("\n");
}

export async function signBundlerRequest(
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
    "x-bundler-address": wallet.address,
    "x-bundler-timestamp": timestamp,
    "x-bundler-nonce": nonce,
    "x-bundler-body-hash": bodyHash,
    "x-bundler-signature": signature,
  };
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}
