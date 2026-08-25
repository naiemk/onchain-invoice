import { expect } from "chai";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import {
  resetRateLimitBuckets,
  resolveRateLimit,
  takeToken,
} from "../commerce/server/rate-limit.js";

describe("commerce central rate limiting", function () {
  async function withApp(
    env: Record<string, string>,
    fn: (baseUrl: string) => Promise<void>
  ): Promise<void> {
    const dir = await mkdtemp(join(tmpdir(), "commerce-rl-"));
    resetRateLimitBuckets();
    const config = loadConfig({
      PORT: "0",
      DB_PATH: join(dir, "test.db"),
      ADMIN_API_KEY: "admin-test",
      SWEEPER_API_KEY: "sweeper-test",
      RATE_LIMIT_CREATE_PER_SECOND: "1",
      RATE_LIMIT_PUBLIC_PER_SECOND: "2",
      RATE_LIMIT_QUOTE_PER_SECOND: "1",
      RATE_LIMIT_QUOTE_BURST: "2",
      ONRAMPER_ENABLED: "1",
      ...env,
    } as NodeJS.ProcessEnv);

    const app = createApp(config);
    await new Promise<void>((resolve) => {
      app.server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP address");
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      await fn(baseUrl);
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
      resetRateLimitBuckets();
    }
  }

  it("resolveRateLimit exempts health, admin, and internal", function () {
    const cfg = loadConfig({
      PORT: "0",
      DB_PATH: ":memory:",
      ADMIN_API_KEY: "a",
      SWEEPER_API_KEY: "s",
    } as NodeJS.ProcessEnv).rateLimit;
    expect(resolveRateLimit("GET", "/api/health", cfg)).to.equal(null);
    expect(resolveRateLimit("GET", "/api/ready", cfg)).to.equal(null);
    expect(resolveRateLimit("GET", "/api/admin/stats", cfg)).to.equal(null);
    expect(resolveRateLimit("POST", "/api/internal/track", cfg)).to.equal(null);
    expect(resolveRateLimit("PATCH", "/api/wallet/accounts/0xabc/deployed", cfg)).to.equal(null);
  });

  it("resolveRateLimit maps quote and create buckets", function () {
    const cfg = loadConfig({
      PORT: "0",
      DB_PATH: ":memory:",
      ADMIN_API_KEY: "a",
      SWEEPER_API_KEY: "s",
      RATE_LIMIT_QUOTE_PER_SECOND: "3",
      RATE_LIMIT_QUOTE_BURST: "15",
    } as NodeJS.ProcessEnv).rateLimit;
    const quote = resolveRateLimit("GET", "/api/public/onramp-quote", cfg);
    expect(quote?.bucket).to.equal("quote");
    expect(quote?.perSecond).to.equal(3);
    expect(quote?.burst).to.equal(15);
    const create = resolveRateLimit("POST", "/api/invoices", cfg);
    expect(create?.bucket).to.equal("create");
    const pub = resolveRateLimit("GET", "/api/public/onramp", cfg);
    expect(pub?.bucket).to.equal("public");
  });

  it("takeToken supports burst above sustained rate", function () {
    resetRateLimitBuckets();
    expect(takeToken("t:burst", 1, 3).ok).to.equal(true);
    expect(takeToken("t:burst", 1, 3).ok).to.equal(true);
    expect(takeToken("t:burst", 1, 3).ok).to.equal(true);
    const denied = takeToken("t:burst", 1, 3);
    expect(denied.ok).to.equal(false);
    expect(denied.remaining).to.equal(0);
  });

  it("returns 429 with Retry-After on public routes", async function () {
    await withApp({}, async (baseUrl) => {
      const statuses: number[] = [];
      let retryAfter: string | null = null;
      for (let i = 0; i < 5; i++) {
        const res = await fetch(`${baseUrl}/api/public/onramp`);
        statuses.push(res.status);
        if (res.status === 429) {
          retryAfter = res.headers.get("retry-after");
          expect(res.headers.get("ratelimit-remaining")).to.equal("0");
          const body = (await res.json()) as { error?: string };
          expect(body.error).to.match(/rate limit/i);
          break;
        }
      }
      expect(statuses).to.include(429);
      expect(retryAfter).to.not.equal(null);
      expect(Number(retryAfter)).to.be.at.least(1);
    });
  });

  it("does not rate-limit admin with API key", async function () {
    await withApp({}, async (baseUrl) => {
      for (let i = 0; i < 8; i++) {
        const res = await fetch(`${baseUrl}/api/admin/stats`, {
          headers: { "x-api-key": "admin-test" },
        });
        expect(res.status).to.equal(200);
      }
    });
  });

  it("applies the quote bucket to onramp-quote", async function () {
    await withApp({}, async (baseUrl) => {
      const url =
        `${baseUrl}/api/public/onramp-quote?fiat=USD&chainId=11155111&token=USDC&direction=receive&cryptoAmount=10`;
      const first = await fetch(url);
      expect(first.status).to.equal(200);
      const second = await fetch(url);
      expect(second.status).to.equal(200);
      const third = await fetch(url);
      expect(third.status).to.equal(429);
    });
  });
});
