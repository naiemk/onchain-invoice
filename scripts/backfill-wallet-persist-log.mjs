#!/usr/bin/env node
/**
 * One-time export of existing wallet SQLite rows into the persist-log WAL.
 * Usage: PERSIST_LOG_DIR=./persist-logs DB_PATH=./data/trustless-commerce.db node scripts/backfill-wallet-persist-log.mjs
 */
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const dbPath = resolve(process.env.DB_PATH ?? resolve(repoRoot, "data/trustless-commerce.db"));
  const logDir = resolve(process.env.PERSIST_LOG_DIR ?? resolve(repoRoot, "persist-logs"));
  await mkdir(logDir, { recursive: true });

  const { PersistLog } = await import("../commerce/server/persist-log.js");
  const Database = require("better-sqlite3");
  const raw = new Database(dbPath, { readonly: true });
  const log = new PersistLog(logDir);

  let count = 0;
  const append = async (type, payload, id) => {
    await log.appendSync("wallet", type, payload, id ? `backfill-${id}` : undefined);
    count++;
  };

  for (const row of raw.prepare("SELECT * FROM wallet_accounts ORDER BY created_at ASC").all()) {
    await append(
      "account.created",
      {
        address: row.address,
        salt: row.salt,
        ownerQx: row.owner_qx,
        ownerQy: row.owner_qy,
        credentialId: row.credential_id,
      },
      row.address
    );
    for (const chainId of JSON.parse(row.deployed_chains || "[]")) {
      await append("account.deployed", { address: row.address, chainId }, `${row.address}-${chainId}`);
    }
  }

  for (const row of raw.prepare("SELECT * FROM wallet_devices ORDER BY created_at ASC").all()) {
    await append(
      "device.registered",
      {
        walletAddress: row.wallet_address,
        chainId: row.chain_id,
        ownerQx: row.owner_qx,
        ownerQy: row.owner_qy,
        label: row.label,
        credentialId: row.credential_id,
      },
      `${row.wallet_address}-${row.owner_qx}-${row.owner_qy}`
    );
  }

  for (const row of raw.prepare("SELECT * FROM wallet_emails WHERE verified_at IS NOT NULL").all()) {
    await append(
      "email.verified",
      { walletAddress: row.wallet_address, email: row.email, verifiedAt: row.verified_at },
      row.wallet_address
    );
  }

  for (const row of raw.prepare("SELECT * FROM wallet_entities ORDER BY created_at ASC").all()) {
    await append(
      "entity.registered",
      { walletAddress: row.wallet_address, entityId: row.entity_id, label: row.label },
      `${row.wallet_address}-${row.entity_id}`
    );
  }

  for (const row of raw.prepare("SELECT * FROM wallet_entity_keys ORDER BY created_at ASC").all()) {
    await append(
      "entity_key.registered",
      {
        walletAddress: row.wallet_address,
        entityId: row.entity_id,
        keyId: row.key_id,
        keyType: row.key_type,
        qx: row.qx,
        qy: row.qy,
        eoa: row.eoa,
        credentialId: row.credential_id,
      },
      `${row.wallet_address}-${row.key_id}`
    );
  }

  raw.close();
  console.log(`Backfilled ${count} wallet persist-log events to ${logDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
