import type { CommerceDb } from "./db.js";
import { replayInvoicePersistLogToDb, type InvoicePersistState } from "./invoice-persist-replay.js";
import { replayWalletPersistLogToDb, type WalletPersistState } from "./wallet-persist-replay.js";

export async function replayPersistLogsToDb(
  db: CommerceDb,
  logDir: string
): Promise<{ wallets: WalletPersistState; invoices: InvoicePersistState }> {
  const wallets = await replayWalletPersistLogToDb(db, logDir);
  const invoices = await replayInvoicePersistLogToDb(db, logDir);
  return { wallets, invoices };
}
