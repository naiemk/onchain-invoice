import type { IncomingMessage } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { getAddress, verifyMessage } from "ethers";

export interface MerchantAuth {
  address: string;
  message: string;
  signature: string;
}

export function readBearerOrApiKey(req: IncomingMessage): string | undefined {
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string") return apiKey;
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) return auth.slice("Bearer ".length);
  return undefined;
}

export function requireApiKey(req: IncomingMessage, expected: string, label: string): void {
  if (!expected) {
    throw Object.assign(new Error(`${label} is not configured`), { statusCode: 503 });
  }
  const supplied = readBearerOrApiKey(req);
  if (!supplied || !safeEqual(supplied, expected)) {
    throw Object.assign(new Error("Unauthorized"), { statusCode: 401 });
  }
}

export function readMerchantAuth(req: IncomingMessage): MerchantAuth {
  const address = header(req, "x-merchant-address");
  const message = header(req, "x-merchant-message");
  const signature = header(req, "x-merchant-signature");
  if (!address || !message || !signature) {
    throw Object.assign(new Error("Missing merchant signature headers"), { statusCode: 401 });
  }
  return { address, message, signature };
}

export function verifyMerchantAuth(auth: MerchantAuth): string {
  const expected = getAddress(auth.address);
  const recovered = getAddress(verifyMessage(auth.message, auth.signature));
  if (recovered !== expected) {
    throw Object.assign(new Error("Invalid merchant signature"), { statusCode: 401 });
  }
  const lowerMessage = auth.message.toLowerCase();
  if (!lowerMessage.includes("trustless commerce") || !lowerMessage.includes(expected.toLowerCase())) {
    throw Object.assign(new Error("Merchant signature message is not scoped to this app"), { statusCode: 401 });
  }
  return expected;
}

export function requireMerchant(req: IncomingMessage): string {
  return verifyMerchantAuth(readMerchantAuth(req));
}

export function merchantLoginMessage(address: string, nonce: string, issuedAt = new Date()): string {
  return [
    "Trustless Commerce merchant login",
    `Address: ${getAddress(address)}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt.toISOString()}`,
  ].join("\n");
}

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
