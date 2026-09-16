import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  GOOGLE_OAUTH_COOKIE_NAME,
  IDENTITY_COOKIE_NAME,
  IDENTITY_RECOVER_COOKIE_NAME,
} from "../shared/identity.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const OAUTH_TTL_MS = 15 * 60 * 1000;
const RECOVER_TTL_MS = 15 * 60 * 1000;

export type IdentitySessionPayload = {
  identityId: string;
  email: string;
  exp: number;
};

export type IdentityRecoverSessionPayload = {
  identityId: string;
  email: string;
  kind: "yubikey" | "eoa";
  methodId: string;
  credentialId?: string;
  qx?: string;
  qy?: string;
  eoa?: string;
  exp: number;
};

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (!key) continue;
    try {
      out[key] = decodeURIComponent(value);
    } catch {
      out[key] = value;
    }
  }
  return out;
}

export function issueIdentitySession(secret: string, identityId: string, email: string, now = Date.now()): string {
  const payload: IdentitySessionPayload = {
    identityId,
    email: email.trim().toLowerCase(),
    exp: now + SESSION_TTL_MS,
  };
  return signPayload(secret, payload);
}

export function verifyIdentitySession(secret: string, token: string | undefined): IdentitySessionPayload | null {
  const parsed = verifyPayload(secret, token) as IdentitySessionPayload | null;
  if (!parsed?.identityId || !parsed.email?.includes("@") || typeof parsed.exp !== "number") return null;
  if (parsed.exp < Date.now()) return null;
  return parsed;
}

export function issueOAuthState(secret: string, now = Date.now()): string {
  return signPayload(secret, { nonce: randomBytes(16).toString("hex"), exp: now + OAUTH_TTL_MS });
}

export function verifyOAuthState(secret: string, token: string | undefined): boolean {
  const parsed = verifyPayload(secret, token) as { nonce?: string; exp?: number } | null;
  return Boolean(parsed?.nonce && typeof parsed.exp === "number" && parsed.exp >= Date.now());
}

export function readIdentitySessionFromRequest(
  secret: string,
  req: IncomingMessage
): IdentitySessionPayload | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  return verifyIdentitySession(secret, cookies[IDENTITY_COOKIE_NAME]);
}

export function appendSetCookie(res: ServerResponse, cookie: string): void {
  const prev = res.getHeader("set-cookie");
  if (!prev) {
    res.setHeader("set-cookie", cookie);
    return;
  }
  const list = Array.isArray(prev) ? prev : [String(prev)];
  res.setHeader("set-cookie", [...list, cookie]);
}

export function setIdentityCookie(res: ServerResponse, token: string, secure: boolean): void {
  appendSetCookie(res, cookieString(IDENTITY_COOKIE_NAME, token, SESSION_TTL_MS / 1000, secure));
}

export function clearIdentityCookie(res: ServerResponse, secure: boolean): void {
  appendSetCookie(res, cookieString(IDENTITY_COOKIE_NAME, "", 0, secure));
  appendSetCookie(res, cookieString(IDENTITY_RECOVER_COOKIE_NAME, "", 0, secure));
}

export function issueIdentityRecoverSession(
  secret: string,
  payload: Omit<IdentityRecoverSessionPayload, "exp">,
  now = Date.now()
): string {
  return signPayload(secret, { ...payload, exp: now + RECOVER_TTL_MS });
}

export function verifyIdentityRecoverSession(
  secret: string,
  token: string | undefined
): IdentityRecoverSessionPayload | null {
  const parsed = verifyPayload(secret, token) as IdentityRecoverSessionPayload | null;
  if (!parsed?.identityId || !parsed.email?.includes("@") || typeof parsed.exp !== "number") return null;
  if (parsed.kind !== "yubikey" && parsed.kind !== "eoa") return null;
  if (!parsed.methodId || parsed.exp < Date.now()) return null;
  return parsed;
}

export function readIdentityRecoverSessionFromRequest(
  secret: string,
  req: IncomingMessage
): IdentityRecoverSessionPayload | null {
  const cookies = parseCookieHeader(req.headers.cookie);
  return verifyIdentityRecoverSession(secret, cookies[IDENTITY_RECOVER_COOKIE_NAME]);
}

export function setIdentityRecoverCookie(res: ServerResponse, token: string, secure: boolean): void {
  appendSetCookie(res, cookieString(IDENTITY_RECOVER_COOKIE_NAME, token, RECOVER_TTL_MS / 1000, secure));
}

export function clearIdentityRecoverCookie(res: ServerResponse, secure: boolean): void {
  appendSetCookie(res, cookieString(IDENTITY_RECOVER_COOKIE_NAME, "", 0, secure));
}

export function setOAuthStateCookie(res: ServerResponse, token: string, secure: boolean): void {
  appendSetCookie(res, cookieString(GOOGLE_OAUTH_COOKIE_NAME, token, OAUTH_TTL_MS / 1000, secure));
}

export function clearOAuthStateCookie(res: ServerResponse, secure: boolean): void {
  appendSetCookie(res, cookieString(GOOGLE_OAUTH_COOKIE_NAME, "", 0, secure));
}

export function cookieHeaderFromResponse(res: { headers: Headers }): string {
  const parts =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];
  return parts
    .map((c) => c.split(";")[0]?.trim() ?? "")
    .filter(Boolean)
    .join("; ");
}

function cookieString(name: string, value: string, maxAgeSec: number, secure: boolean): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.max(0, Math.floor(maxAgeSec))}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

function signPayload(secret: string, payload: object): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function verifyPayload(secret: string, token: string | undefined): object | null {
  if (!token || !secret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  const expected = createHmac("sha256", secret).update(payload).digest("base64url");
  const left = Buffer.from(sig);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as object;
  } catch {
    return null;
  }
}
