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

      CREATE TABLE IF NOT EXISTS node_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        level TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        metadata_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_node_logs_source_created ON node_logs(source, created_at DESC);

      CREATE TABLE IF NOT EXISTS node_health (
        source TEXT PRIMARY KEY,
        level TEXT NOT NULL DEFAULT 'info',
        message TEXT NOT NULL,
        metadata_json TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
  }

  appendNodeLog(entry: {
    source: string;
    level?: string;
    message: string;
    metadata?: Record<string, unknown>;
  }) {
    const level = entry.level ?? "info";
    const meta = entry.metadata !== undefined ? JSON.stringify(entry.metadata) : null;
    this.db
      .prepare(
        `
          INSERT INTO node_logs (source, level, message, metadata_json, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(entry.source, level, entry.message, meta, Date.now());
    this.pruneNodeLogs(5_000);
  }

  updateNodeHealth(entry: {
    source: string;
    level?: string;
    message: string;
    metadata?: Record<string, unknown>;
  }) {
    const level = entry.level ?? "info";
    const meta = entry.metadata !== undefined ? JSON.stringify(entry.metadata) : null;
    this.db
      .prepare(
        `
          INSERT INTO node_health (source, level, message, metadata_json, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(source) DO UPDATE SET
            level = excluded.level,
            message = excluded.message,
            metadata_json = excluded.metadata_json,
            updated_at = excluded.updated_at
        `
      )
      .run(entry.source, level, entry.message, meta, Date.now());
  }

  listNodeHealth(): Array<{
    source: string;
    level: string;
    message: string;
    metadata: Record<string, unknown> | null;
    updatedAt: number;
  }> {
    const rows = this.db
      .prepare(
        `
          SELECT source, level, message, metadata_json, updated_at
          FROM node_health
          ORDER BY source ASC
        `
      )
      .all() as Array<{
      source: string;
      level: string;
      message: string;
      metadata_json: string | null;
      updated_at: number;
    }>;
    return rows.map((row) => ({
      source: row.source,
      level: row.level,
      message: row.message,
      metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : null,
      updatedAt: row.updated_at,
    }));
  }

  listNodeLogs(source: string, limit: number): Array<{
    id: number;
    source: string;
    level: string;
    message: string;
    metadata: Record<string, unknown> | null;
    createdAt: number;
  }> {
    const cap = Math.min(Math.max(1, limit), 500);
    const rows = this.db
      .prepare(
        `
          SELECT id, source, level, message, metadata_json, created_at
          FROM node_logs
          WHERE source = ?
          ORDER BY id DESC
          LIMIT ?
        `
      )
      .all(source, cap) as Array<{
      id: number;
      source: string;
      level: string;
      message: string;
      metadata_json: string | null;
      created_at: number;
    }>;
    return rows.map((row) => ({
      id: row.id,
      source: row.source,
      level: row.level,
      message: row.message,
      metadata: row.metadata_json ? (JSON.parse(row.metadata_json) as Record<string, unknown>) : null,
      createdAt: row.created_at,
    }));
  }

  private pruneNodeLogs(maxRows: number) {
    const row = this.db.prepare("SELECT COUNT(*) as c FROM node_logs").get() as { c: number };
    if (row.c <= maxRows) return;
    const cutoff = this.db
      .prepare("SELECT id FROM node_logs ORDER BY id DESC LIMIT 1 OFFSET ?")
      .get(maxRows - 1) as { id: number } | undefined;
    if (cutoff?.id != null) {
      this.db.prepare("DELETE FROM node_logs WHERE id < ?").run(cutoff.id);
    }
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
