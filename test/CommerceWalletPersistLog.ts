import { expect } from "chai";
import { ethers as ethersLib, getAddress, Wallet } from "ethers";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { CommerceDb } from "../commerce/server/db.js";
import { collectPersistEvents } from "../commerce/server/persist-log.js";
import { replayPersistLogsToDb } from "../commerce/server/persist-replay.js";
import { replayWalletPersistLogToDb } from "../commerce/server/wallet-persist-replay.js";
import { resetRateLimitBuckets } from "../commerce/server/rate-limit.js";
import { deriveWalletSalt, predictWalletAddress } from "../commerce/shared/wallet-address.js";

const FACTORY = "0x06964dE197ed29A4DC2D34F68aD4510Afa25f537";
const IMPL = "0xe024cE8ed1878dBdd3ca8E73B1e586c4E46dC85C";
const QX = ethersLib.zeroPadValue("0x0a", 32);
const QY = ethersLib.zeroPadValue("0x0b", 32);
const SWEEPER = "0x5bcbEF31E3DcE37235CF8B2900ca7a1439e46cB9";
const FORWARDER = "0x0bA4bb324eB41d9c0f1c4Ac7a3876dEfcc4d72b9";

const BASE_ENV = {
  PORT: "0",
  ADMIN_API_KEY: "admin-wallet-persist",
  SWEEPER_API_KEY: "sweeper-wallet-persist",
  WALLET_FACTORY_ADDRESS: FACTORY,
  WALLET_IMPLEMENTATION_ADDRESS: IMPL,
  WALLET_RECOVERY_ADDRESS: "0x72739889bcce2B08a23212bae6C7B9F1C29e7873",
  WALLET_RPC_URL: "",
  EVM_RPC_URL: "https://sepolia.example",
  SWEEPER_ADDRESS: SWEEPER,
  FORWARDER_IMPLEMENTATION: FORWARDER,
  TURNSTILE_SECRET: "",
  RATE_LIMIT_CREATE_PER_SECOND: "100",
  RATE_LIMIT_PUBLIC_PER_SECOND: "100",
} as const;

describe("commerce persist-log", function () {
  async function withPersistApp(
    fn: (args: { baseUrl: string; app: ReturnType<typeof createApp>; logDir: string; dir: string }) => Promise<void>
  ): Promise<void> {
    resetRateLimitBuckets();
    const dir = await mkdtemp(join(tmpdir(), "commerce-persist-"));
    const logDir = join(dir, "persist-logs");
    const dbPath = join(dir, "test.db");
    const config = loadConfig({
      ...process.env,
      ...BASE_ENV,
      DB_PATH: dbPath,
      PERSIST_LOG_DIR: logDir,
    } as NodeJS.ProcessEnv);
    const app = createApp(config);
    await new Promise<void>((resolve) => {
      app.server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = app.server.address();
    if (!addr || typeof addr === "string") throw new Error("expected TCP address");
    const baseUrl = `http://127.0.0.1:${addr.port}`;
    try {
      await fn({ baseUrl, app, logDir, dir });
    } finally {
      await app.close();
      await rm(dir, { recursive: true, force: true });
    }
  }

  it("appends account.created on register and replays into fresh SQLite", async function () {
    await withPersistApp(async ({ baseUrl, logDir, dir }) => {
      const salt = deriveWalletSalt(QX, QY);
      const address = predictWalletAddress(FACTORY, IMPL, salt);
      const res = await fetch(`${baseUrl}/api/wallet/accounts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          address,
          salt,
          ownerQx: QX,
          ownerQy: QY,
          credentialId: "cred-persist",
        }),
      });
      expect(res.status).to.equal(201);

      const events = await collectPersistEvents(logDir, "wallet");
      expect(events.some((e) => e.type === "account.created")).to.equal(true);

      const replayDbPath = join(dir, "replayed.db");
      const replayDb = new CommerceDb(replayDbPath);
      await replayWalletPersistLogToDb(replayDb, logDir);
      const account = replayDb.getWalletAccount(address);
      expect(account?.ownerQx).to.equal(QX);
      expect(account?.ownerQy).to.equal(QY);
      expect(account?.salt).to.equal(salt);
      replayDb.close();

      const wal = await readFile(join(logDir, "wallet", "wal.ndjson"), "utf8");
      expect(wal.trim().length).to.be.greaterThan(0);
    });
  });

  it("appends invoice.created and replays invoiceAddress / seed / selectedTo", async function () {
    await withPersistApp(async ({ baseUrl, logDir, dir }) => {
      const merchant = getAddress(Wallet.createRandom().address);
      const res = await fetch(`${baseUrl}/api/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          price: "1.00",
          to: [merchant],
          chains: ["11155111"],
          tokens: ["USDC"],
          chainId: "11155111",
          token: "USDC",
          selectedTo: merchant,
        }),
      });
      expect(res.status).to.equal(201);
      const body = (await res.json()) as {
        invoice?: { id?: string; invoiceAddress?: string; invoiceSeed?: string; selectedTo?: string };
      };
      expect(body.invoice?.invoiceAddress).to.match(/^0x[0-9a-fA-F]{40}$/);
      const invoiceId = body.invoice!.id!;
      const invoiceAddress = body.invoice!.invoiceAddress!;
      const invoiceSeed = body.invoice!.invoiceSeed!;

      const events = await collectPersistEvents(logDir, "invoice");
      expect(events.some((e) => e.type === "invoice.created" && e.payload.invoiceId === invoiceId)).to.equal(true);

      const replayDb = new CommerceDb(join(dir, "replayed.db"));
      const restored = await replayPersistLogsToDb(replayDb, logDir);
      expect(restored.invoices.invoices.size).to.equal(1);
      const invoice = replayDb.getInvoice(invoiceId);
      expect(invoice?.invoiceAddress).to.equal(invoiceAddress);
      expect(invoice?.invoiceSeed).to.equal(invoiceSeed);
      expect(invoice?.selectedTo?.toLowerCase()).to.equal(merchant.toLowerCase());
      expect(invoice?.status).to.equal("awaiting_payment");
      replayDb.close();
    });
  });

  it("replays paid then swept invoice status into a fresh DB", async function () {
    await withPersistApp(async ({ baseUrl, app, logDir, dir }) => {
      const merchant = getAddress(Wallet.createRandom().address);
      const res = await fetch(`${baseUrl}/api/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          price: "2.00",
          to: [merchant],
          chains: ["11155111"],
          tokens: ["USDC"],
          chainId: "11155111",
          token: "USDC",
          selectedTo: merchant,
        }),
      });
      expect(res.status).to.equal(201);
      const created = (await res.json()) as { invoice: { id: string; version: number } };
      const invoiceId = created.invoice.id;

      app.db.trackInvoice({
        invoiceId,
        status: "paid",
        amountPaid: "2000000",
        expectedVersion: created.invoice.version,
      });
      const paid = app.db.getInvoice(invoiceId)!;
      app.db.trackInvoice({
        invoiceId,
        status: "swept",
        amountPaid: "2000000",
        amountSwept: "1990000",
        feeCollected: "10000",
        sweepTx: "0xabc",
        expectedVersion: paid.version,
      });

      const events = await collectPersistEvents(logDir, "invoice");
      expect(events.some((e) => e.type === "invoice.paid")).to.equal(true);
      expect(events.some((e) => e.type === "invoice.swept")).to.equal(true);

      const replayDb = new CommerceDb(join(dir, "replayed.db"));
      await replayPersistLogsToDb(replayDb, logDir);
      const invoice = replayDb.getInvoice(invoiceId);
      expect(invoice?.status).to.equal("swept");
      expect(invoice?.amountPaid).to.equal("2000000");
      expect(invoice?.amountSwept).to.equal("1990000");
      expect(invoice?.sweepTx).to.equal("0xabc");
      expect(invoice?.claimedBy).to.equal(null);
      replayDb.close();
    });
  });
});
