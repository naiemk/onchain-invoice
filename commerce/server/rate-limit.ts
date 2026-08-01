/** Simple in-process token buckets keyed by IP + bucket name. */

interface Bucket {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, Bucket>();

export function takeToken(key: string, perSecond: number): boolean {
  if (perSecond <= 0) return true;
  const now = Date.now();
  const existing = buckets.get(key) ?? { tokens: perSecond, updatedAt: now };
  const elapsed = (now - existing.updatedAt) / 1000;
  const refilled = Math.min(perSecond, existing.tokens + elapsed * perSecond);
  if (refilled < 1) {
    buckets.set(key, { tokens: refilled, updatedAt: now });
    return false;
  }
  buckets.set(key, { tokens: refilled - 1, updatedAt: now });
  return true;
}

export function clientIp(req: { headers: Record<string, string | string[] | undefined>; socket: { remoteAddress?: string } }): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0]!.trim();
  }
  return req.socket.remoteAddress ?? "unknown";
}
