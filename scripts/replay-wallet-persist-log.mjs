#!/usr/bin/env node
/**
 * Rebuild wallet + invoice SQLite tables from persist-log events.
 * Usage: PERSIST_LOG_DIR=./persist-logs DB_PATH=./data/trustless-commerce-restored.db node scripts/replay-wallet-persist-log.mjs
 */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const dbPath = resolve(process.env.DB_PATH ?? resolve(repoRoot, "data/trustless-commerce-restored.db"));
  const logDir = resolve(process.env.PERSIST_LOG_DIR ?? resolve(repoRoot, "persist-logs"));
  await mkdir(dirname(dbPath), { recursive: true });

  const { CommerceDb } = await import("../commerce/server/db.js");
  const { replayPersistLogsToDb } = await import("../commerce/server/persist-replay.js");

  const db = new CommerceDb(dbPath);
  const state = await replayPersistLogsToDb(db, logDir);
  db.close();

  console.log(
    JSON.stringify(
      {
        logDir,
        dbPath,
        accounts: state.wallets.accounts.size,
        devices: state.wallets.devices.size,
        emails: state.wallets.emails.size,
        entities: state.wallets.entities.size,
        entityKeys: state.wallets.entityKeys.size,
        invoices: state.invoices.invoices.size,
      },
      null,
      2
    )
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
