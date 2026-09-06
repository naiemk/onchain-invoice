import { test, expect, type Page } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommerceDb } from "../../commerce/server/db.js";
import { replayPersistLogsToDb } from "../../commerce/server/persist-replay.js";

const API_PORT = process.env.E2E_API_PORT ?? "8080";
const API = `http://127.0.0.1:${API_PORT}`;
const PERSIST_LOG_DIR = process.env.PERSIST_LOG_DIR ?? "/tmp/tc-e2e-persist-logs";
const WALLET_COUNT = 16;
const INVOICES_PER_WALLET = 10;

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("no port"));
        return;
      }
      const port = addr.port;
      server.close(() => resolve(port));
    });
  });
}

async function waitForHealth(url: string, timeoutMs = 30_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${url}/api/health`);
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`restored API did not become healthy at ${url}`);
}

async function startRestoredApi(dbPath: string): Promise<{ url: string; child: ChildProcess }> {
  const port = await freePort();
  const child = spawn("node", ["commerce-dist/server/index.js"], {
    env: {
      ...process.env,
      PORT: String(port),
      DB_PATH: dbPath,
      PERSIST_LOG_DIR,
      SWEEPER_ADDRESS: process.env.SWEEPER_ADDRESS ?? "0x0000000000000000000000000000000000000001",
      FORWARDER_IMPLEMENTATION:
        process.env.FORWARDER_IMPLEMENTATION ?? "0x0000000000000000000000000000000000000002",
      TURNSTILE_SECRET: "",
      RATE_LIMIT_CREATE_PER_SECOND: "500",
      RATE_LIMIT_PUBLIC_PER_SECOND: "500",
    },
    stdio: "pipe",
  });
  const url = `http://127.0.0.1:${port}`;
  try {
    await waitForHealth(url);
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }
  return { url, child };
}

async function addVirtualAuthenticator(page: Page): Promise<void> {
  const client = await page.context().newCDPSession(page);
  await client.send("WebAuthn.enable");
  await client.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

async function createPasskeyWallet(page: Page, label: string): Promise<string> {
  await addVirtualAuthenticator(page);
  await page.goto("/wallet/create");
  await page.getByTestId("device-name").fill(label);
  await page.getByTestId("wallet-accept-terms").click();
  await page.getByTestId("wallet-accept-security-checks").click();
  await expect(page.getByTestId("wallet-create-btn")).toBeEnabled({ timeout: 15_000 });
  const created = page.waitForResponse(
    (res) =>
      res.url().includes("/api/wallet/accounts") &&
      res.request().method() === "POST" &&
      res.status() === 201
  );
  await page.getByTestId("wallet-create-btn").click();
  await page.getByTestId("wallet-create-disclaimer-skip").click();
  await page.getByTestId("wallet-create-disclaimer-finish").click();
  const res = await created;
  const body = (await res.json()) as { account?: { address?: string } };
  const address = body.account?.address;
  if (!address) throw new Error("wallet create did not return address");
  return address;
}

test.describe("persist-log recovery (WebAuthn)", () => {
  test.setTimeout(300_000);

  test("creates 16 passkey wallets × 10 invoices, replays persist-log, then uses wallets again", async ({
    browser,
    request,
  }) => {
    const wallets: string[] = [];
    for (let i = 0; i < WALLET_COUNT; i++) {
      const context = await browser.newContext();
      const page = await context.newPage();
      try {
        const address = await createPasskeyWallet(page, `E2E Persist ${i}`);
        expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
        wallets.push(address);
      } finally {
        await context.close();
      }
    }

    const invoiceIds: string[] = [];
    for (const wallet of wallets) {
      for (let j = 0; j < INVOICES_PER_WALLET; j++) {
        const res = await request.post(`${API}/api/invoices`, {
          data: {
            price: "1.00",
            to: [wallet],
            chains: ["11155111"],
            tokens: ["USDC"],
            chainId: "11155111",
            token: "USDC",
            selectedTo: wallet,
          },
        });
        expect(res.status(), `invoice create for ${wallet}`).toBe(201);
        const body = (await res.json()) as {
          invoice?: { id?: string; invoiceAddress?: string; selectedTo?: string; invoiceSeed?: string };
        };
        expect(body.invoice?.invoiceAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(body.invoice?.selectedTo?.toLowerCase()).toBe(wallet.toLowerCase());
        expect(body.invoice?.invoiceSeed).toMatch(/^0x[0-9a-fA-F]{64}$/);
        invoiceIds.push(body.invoice!.id!);
      }
    }

    const dir = await mkdtemp(join(tmpdir(), "pw-persist-replay-"));
    let restored: { url: string; child: ChildProcess } | undefined;
    try {
      const replayPath = join(dir, "replayed.db");
      const replayDb = new CommerceDb(replayPath);
      const state = await replayPersistLogsToDb(replayDb, PERSIST_LOG_DIR);
      expect(state.wallets.accounts.size).toBeGreaterThanOrEqual(WALLET_COUNT);
      expect(state.invoices.invoices.size).toBeGreaterThanOrEqual(WALLET_COUNT * INVOICES_PER_WALLET);

      for (const wallet of wallets) {
        const account = replayDb.getWalletAccount(wallet);
        expect(account, `replayed wallet ${wallet}`).toBeTruthy();
        expect(account?.ownerQx).toMatch(/^0x[0-9a-fA-F]{64}$/);
        expect(account?.ownerQy).toMatch(/^0x[0-9a-fA-F]{64}$/);
        expect(account?.salt).toMatch(/^0x[0-9a-fA-F]{64}$/);
      }
      for (const id of invoiceIds) {
        const invoice = replayDb.getInvoice(id);
        expect(invoice?.invoiceAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
        expect(invoice?.invoiceSeed).toMatch(/^0x[0-9a-fA-F]{64}$/);
        expect(wallets.some((w) => invoice?.selectedTo?.toLowerCase() === w.toLowerCase())).toBe(true);
      }
      replayDb.close();

      restored = await startRestoredApi(replayPath);
      for (const wallet of wallets) {
        const acc = await fetch(`${restored.url}/api/wallet/accounts/${wallet}`);
        expect(acc.status, `restored GET ${wallet}`).toBe(200);
        const body = (await acc.json()) as { account?: { ownerQx?: string; ownerQy?: string } };
        expect(body.account?.ownerQx).toMatch(/^0x[0-9a-fA-F]{64}$/);

        const reuse = await fetch(`${restored.url}/api/invoices`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            price: "1.00",
            to: [wallet],
            chains: ["11155111"],
            tokens: ["USDC"],
            chainId: "11155111",
            token: "USDC",
            selectedTo: wallet,
          }),
        });
        expect(reuse.status, `reuse invoice for ${wallet}`).toBe(201);
        const created = (await reuse.json()) as { invoice?: { selectedTo?: string; invoiceAddress?: string } };
        expect(created.invoice?.selectedTo?.toLowerCase()).toBe(wallet.toLowerCase());
        expect(created.invoice?.invoiceAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
      }
    } finally {
      restored?.child.kill("SIGTERM");
      await rm(dir, { recursive: true, force: true });
    }
  });
});
