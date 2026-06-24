import Database from "better-sqlite3";
import type {
  FastSwapChainTx,
  FastSwapInvoice,
  FastSwapInvoiceTrackPatch,
  FastSwapPayoutInfo,
  FastSwapQuote,
  FastSwapRecentSwap,
  FastSwapRelayInfo,
  FastSwapSweepInfo,
} from "../shared/types.js";

export class FastSwapStore {
  private readonly db: Database.Database;

  constructor(sqlitePath: string) {
    this.db = new Database(sqlitePath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS quotes (
        quote_id TEXT PRIMARY KEY,
        quote_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invoices (
        invoice_id TEXT PRIMARY KEY,
        invoice_json TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS recent_swaps (
        swap_id TEXT PRIMARY KEY,
        swap_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  saveQuote(quote: FastSwapQuote) {
    this.db
      .prepare(
        `
          INSERT INTO quotes (quote_id, quote_json, created_at, expires_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(quote_id) DO UPDATE SET quote_json = excluded.quote_json, expires_at = excluded.expires_at
        `
      )
      .run(quote.quoteId, JSON.stringify(quote), Date.now(), quote.expiresAt);
  }

  getQuote(quoteId: string): FastSwapQuote | undefined {
    const row = this.db.prepare("SELECT quote_json FROM quotes WHERE quote_id = ?").get(quoteId) as
      | { quote_json: string }
      | undefined;
    return row ? (JSON.parse(row.quote_json) as FastSwapQuote) : undefined;
  }

  saveInvoice(invoice: FastSwapInvoice) {
    this.db
      .prepare(
        `
          INSERT INTO invoices (invoice_id, invoice_json, status, updated_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(invoice_id) DO UPDATE SET
            invoice_json = excluded.invoice_json,
            status = excluded.status,
            updated_at = excluded.updated_at
        `
      )
      .run(invoice.invoiceId, JSON.stringify(invoice), invoice.status, Date.now());
  }

  getInvoice(invoiceId: string): FastSwapInvoice | undefined {
    const row = this.db.prepare("SELECT invoice_json FROM invoices WHERE invoice_id = ?").get(invoiceId) as
      | { invoice_json: string }
      | undefined;
    return row ? (JSON.parse(row.invoice_json) as FastSwapInvoice) : undefined;
  }

  applyInvoiceTrackPatch(invoiceId: string, patch: FastSwapInvoiceTrackPatch): FastSwapInvoice | undefined {
    const existing = this.getInvoice(invoiceId);
    if (!existing) return undefined;
    const merged = mergeInvoiceTrack(existing, patch);
    this.saveInvoice(merged);
    return merged;
  }

  listInvoices(limit: number, cursor?: string): Array<{ invoice: FastSwapInvoice; updatedAt: number }> {
    const rows = this.db
      .prepare(
        cursor
          ? "SELECT invoice_json, updated_at FROM invoices WHERE updated_at < ? ORDER BY updated_at DESC LIMIT ?"
          : "SELECT invoice_json, updated_at FROM invoices ORDER BY updated_at DESC LIMIT ?"
      )
      .all(...(cursor ? [Number(cursor), limit] : [limit])) as Array<{ invoice_json: string; updated_at: number }>;
    return rows.map((row) => ({
      invoice: JSON.parse(row.invoice_json) as FastSwapInvoice,
      updatedAt: row.updated_at,
    }));
  }

  listRecentSwaps(limit: number): FastSwapRecentSwap[] {
    const rows = this.db
      .prepare("SELECT swap_json FROM recent_swaps ORDER BY updated_at DESC LIMIT ?")
      .all(limit) as Array<{ swap_json: string }>;
    return rows.map((row) => JSON.parse(row.swap_json) as FastSwapRecentSwap);
  }

  close() {
    this.db.close();
  }
}

function mergeChainTx(
  base: FastSwapChainTx | undefined,
  patch: Partial<FastSwapChainTx> | undefined
): FastSwapChainTx | undefined {
  if (patch === undefined) return base;
  if (base === undefined) {
    if (!patch.chainId || !patch.txHash || !patch.status) return patch as FastSwapChainTx;
    return { ...patch } as FastSwapChainTx;
  }
  return { ...base, ...patch };
}

function mergeSweep(base: FastSwapSweepInfo | undefined, patch: FastSwapInvoiceTrackPatch["sweep"]): FastSwapSweepInfo | undefined {
  if (patch === undefined) return base;
  const next: FastSwapSweepInfo = { ...(base ?? {}), ...patch };
  if (patch.tx !== undefined || base?.tx !== undefined) next.tx = mergeChainTx(base?.tx, patch.tx);
  if (patch.sourcePayment !== undefined || base?.sourcePayment !== undefined) {
    next.sourcePayment = mergeChainTx(base?.sourcePayment, patch.sourcePayment);
  }
  return next;
}

function mergeRelay(base: FastSwapRelayInfo | undefined, patch: FastSwapInvoiceTrackPatch["relay"]): FastSwapRelayInfo | undefined {
  if (patch === undefined) return base;
  const next: FastSwapRelayInfo = { ...(base ?? {}), ...patch };
  if (patch.tx !== undefined || base?.tx !== undefined) next.tx = mergeChainTx(base?.tx, patch.tx);
  if (patch.swapRequestedTx !== undefined || base?.swapRequestedTx !== undefined) {
    next.swapRequestedTx = mergeChainTx(base?.swapRequestedTx, patch.swapRequestedTx);
  }
  return next;
}

function mergePayout(base: FastSwapPayoutInfo | undefined, patch: FastSwapInvoiceTrackPatch["payout"]): FastSwapPayoutInfo | undefined {
  if (patch === undefined) return base;
  const next: FastSwapPayoutInfo = { ...(base ?? {}), ...patch };
  if (patch.tx !== undefined || base?.tx !== undefined) next.tx = mergeChainTx(base?.tx, patch.tx);
  return next;
}

function mergeInvoiceTrack(existing: FastSwapInvoice, patch: FastSwapInvoiceTrackPatch): FastSwapInvoice {
  return {
    ...existing,
    status: patch.status ?? existing.status,
    sweep: mergeSweep(existing.sweep, patch.sweep),
    relay: mergeRelay(existing.relay, patch.relay),
    payout: mergePayout(existing.payout, patch.payout),
  };
}
