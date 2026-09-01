import { expect } from "chai";
import { ethers as ethersLib } from "ethers";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../commerce/server/app.js";
import { loadConfig } from "../commerce/server/config.js";
import { CommerceDb } from "../commerce/server/db.js";
import { collectPersistEvents } from "../commerce/server/persist-log.js";
import { replayWalletPersistLogToDb } from "../commerce/server/wallet-persist-replay.js";
import { resetRateLimitBuckets } from "../commerce/server/rate-limit.js";
import { deriveWalletSalt, predictWalletAddress } from "../commerce/shared/wallet-address.js";

const FACTORY = "0x06964dE197ed29A4DC2D34F68aD4510Afa25f537";
const IMPL = "0xe024cE8ed1878dBdd3ca8E73B1e586c4E46dC85C";
const QX = ethersLib.zeroPadValue("0x0a", 32);
const QY = ethersLib.zeroPadValue("0x0b", 32);

const BASE_ENV = {
  PORT: "0",
  ADMIN_API_KEY: "admin-wallet-persist",
  SWEEPER_API_KEY: "sweeper-wallet-persist",
  WALLET_FACTORY_ADDRESS: FACTORY,
  WALLET_IMPLEMENTATION_ADDRESS: IMPL,
  WALLET_RECOVERY_ADDRESS: "0x72739889bcce2B08a23212bae6C7B9F1C29e7873",
  WALLET_RPC_URL: "",
  EVM_RPC_URL: "",
  TURNSTILE_SECRET: "",
} as const;

describe("commerce wallet persist-log", function () {
  it("appends account.created on register and replays into fresh SQLite", async function () {
    resetRateLimitBuckets();
    const dir = await mkdtemp(join(tmpdir(), "commerce-wallet-persist-"));
    const logDir = join(dir, "persist-logs");
    const dbPath = join(dir, "test.db");
    const salt = deriveWalletSalt(QX, QY);
    const address = predictWalletAddress(FACTORY, IMPL, salt);

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

      await app.close();

      const events = await collectPersistEvents(logDir, "wallet");
      expect(events.some((e) => e.type === "account.created")).to.equal(true);

      const replayDbPath = join(dir, "replayed.db");
      const replayDb = new CommerceDb(replayDbPath);
      await replayWalletPersistLogToDb(replayDb, logDir);
      const account = replayDb.getWalletAccount(address);
      expect(account?.ownerQx).to.equal(QX);
      replayDb.close();

      const wal = await readFile(join(logDir, "wallet", "wal.ndjson"), "utf8");
      expect(wal.trim().length).to.be.greaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
