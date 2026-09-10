import { createHmac, timingSafeEqual } from "node:crypto";

const TTL_MS = 15 * 60 * 1000;

export function issueRecoveryEmailSession(secret: string, email: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ email: email.trim().toLowerCase(), exp: now + TTL_MS })).toString(
    "base64url"
  );
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyRecoveryEmailSession(secret: string, token: string | undefined): string | null {
  if (!token || !secret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      email?: string;
      exp?: number;
    };
    if (!parsed.email?.includes("@") || typeof parsed.exp !== "number" || parsed.exp < Date.now()) {
      return null;
    }
    return parsed.email;
  } catch {
    return null;
  }
}

export function emailLookupOtpWallet(email: string): string {
  return `email:${email.trim().toLowerCase()}`;
}
