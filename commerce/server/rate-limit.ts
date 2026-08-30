/** In-process token buckets keyed by IP + bucket name, with optional burst. */

import type { RateLimitConfig } from "./config.js";

interface Bucket {
  tokens: number;
  updatedAt: number;
  capacity: number;
}

const buckets = new Map<string, Bucket>();

export type RateLimitDecision = {
  bucket: string;
  perSecond: number;
  burst: number;
};

export type RateLimitTakeResult = {
  ok: boolean;
  remaining: number;
  resetMs: number;
};

/**
 * Take one token from the bucket.
 * `perSecond` is the sustained refill rate; `burst` (default = perSecond) is the
 * max tokens that may accumulate.
 */
export function takeToken(
  key: string,
  perSecond: number,
  burst?: number
): RateLimitTakeResult {
  if (perSecond <= 0) {
    return { ok: true, remaining: Number.POSITIVE_INFINITY, resetMs: 0 };
  }
  const capacity = Math.max(1, burst ?? perSecond);
  const now = Date.now();
  const existing = buckets.get(key) ?? { tokens: capacity, updatedAt: now, capacity };
  const elapsed = (now - existing.updatedAt) / 1000;
  const refilled = Math.min(capacity, existing.tokens + elapsed * perSecond);
  if (refilled < 1) {
    const need = 1 - refilled;
    const resetMs = Math.ceil((need / perSecond) * 1000);
    buckets.set(key, { tokens: refilled, updatedAt: now, capacity });
    return { ok: false, remaining: 0, resetMs };
  }
  const next = refilled - 1;
  buckets.set(key, { tokens: next, updatedAt: now, capacity });
  return { ok: true, remaining: Math.floor(next), resetMs: 0 };
}

/** Test helper — clear all buckets between cases. */
export function resetRateLimitBuckets(): void {
  buckets.clear();
}

export function clientIp(req: {
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
}): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}

/**
 * Resolve the rate-limit bucket for a request.
 * Returns `null` when the route is exempt (health, admin, internal, deployer).
 * Unmatched paths default to the `public` bucket so new routes are limited by default.
 */
export function resolveRateLimit(
  method: string,
  pathname: string,
  config: RateLimitConfig
): RateLimitDecision | null {
  const m = method.toUpperCase();
  const quote: RateLimitDecision = {
    bucket: "quote",
    perSecond: config.quotePerSecond,
    burst: config.quoteBurst,
  };
  const create: RateLimitDecision = {
    bucket: "create",
    perSecond: config.createPerSecond,
    burst: Math.max(1, config.createPerSecond),
  };
  const publicBucket: RateLimitDecision = {
    bucket: "public",
    perSecond: config.publicPerIpPerSecond,
    burst: Math.max(1, config.publicPerIpPerSecond),
  };
  const sweeper: RateLimitDecision = {
    bucket: "sweeper",
    perSecond: config.sweeperPerIpPerSecond,
    burst: Math.max(1, config.sweeperPerIpPerSecond),
  };
  const walletClient: RateLimitDecision = {
    bucket: "wallet_client",
    perSecond: config.walletClientPerIpPerSecond,
    burst: Math.max(1, config.walletClientPerIpPerSecond),
  };

  // Exemptions — key-authenticated / health probes
  if (pathname === "/api/health" || pathname === "/api/ready") return null;
  if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) return null;
  if (pathname === "/api/internal" || pathname.startsWith("/api/internal/")) return null;
  if (pathname.startsWith("/api/wallet/deployer/")) return null;
  if (m === "PATCH" && /^\/api\/wallet\/accounts\/[^/]+\/deployed$/.test(pathname)) return null;

  // Quote (paid upstream)
  if (pathname === "/api/public/onramp-quote" || pathname === "/api/public/onramp-methods") {
    return quote;
  }

  // Create
  if (
    m === "POST" &&
    (pathname === "/api/invoices" ||
      pathname === "/api/sessions" ||
      pathname === "/api/invoices/activate")
  ) {
    return create;
  }
  if (m === "POST" && /^\/api\/invoices\/[^/]+\/faucet$/.test(pathname)) {
    const capped = Math.max(1, Math.min(5, config.createPerSecond));
    return { bucket: "create", perSecond: capped, burst: capped };
  }

  // HMAC wallet client API
  if (pathname === "/api/client/wallets" || pathname.startsWith("/api/client/wallets/")) {
    return walletClient;
  }

  // Sweeper / bundler
  if (
    pathname === "/api/sweeper" ||
    pathname.startsWith("/api/sweeper/") ||
    pathname === "/api/bundler" ||
    pathname.startsWith("/api/bundler/")
  ) {
    return sweeper;
  }

  return publicBucket;
}
