import Database from "better-sqlite3";
import { hexlify } from "ethers";
import type { SweepNodeInvoice } from "./config.js";

/** Normalize `bytes32` invoice ids for SQLite keys and joins (lowercase `0x` + 64 hex). */
export function normalizeInvoiceId(invoiceId: string | Uint8Array): string {
  return hexlify(invoiceId).toLowerCase();
}

export type PaidInvoice = {
  chainId: string;
  invoiceId: string;
  token: string;
  amount: string;
  forwarder: string;
  txHash: string;
  logIndex: number;
  blockNumber?: number;
  timestamp?: number;
};

export type SweepAttempt = {
  chainId: string;
  invoiceId: string;
  status: "swept" | "skipped" | "failed";
  txId?: string;
  error?: string;
};

export class SweepNodeCache {
  private readonly db: Database.Database;

  constructor(sqlitePath: string) {
    this.db = new Database(sqlitePath);
    this.db.pragma("foreign_keys = ON");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS invoices (
        chain_id TEXT NOT NULL,
        invoice_id TEXT NOT NULL,
        invoice_address TEXT NOT NULL,
        data TEXT NOT NULL,
        token TEXT,
        amount TEXT,
        min_amount TEXT,
        source_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        last_checked_at INTEGER,
        PRIMARY KEY (chain_id, invoice_id)
      );

      CREATE TABLE IF NOT EXISTS paid_invoices (
        chain_id TEXT NOT NULL,
        invoice_id TEXT NOT NULL,
        token TEXT NOT NULL,
        amount TEXT NOT NULL,
        forwarder TEXT NOT NULL,
        tx_hash TEXT NOT NULL,
        log_index INTEGER NOT NULL,
        block_number INTEGER,
        timestamp INTEGER,
        PRIMARY KEY (chain_id, invoice_id)
      );

      CREATE TABLE IF NOT EXISTS chain_progress (
        chain_id TEXT PRIMARY KEY,
        last_scanned_block INTEGER,
        last_scanned_timestamp INTEGER
      );

      CREATE TABLE IF NOT EXISTS sweep_attempts (
        chain_id TEXT NOT NULL,
        invoice_id TEXT NOT NULL,
        status TEXT NOT NULL,
        tx_id TEXT,
        error TEXT,
        attempted_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_invoices_chain_updated ON invoices(chain_id, updated_at DESC);
      CREATE INDEX IF NOT EXISTS idx_paid_invoices_chain ON paid_invoices(chain_id);
    `);
  }

  close() {
    this.db.close();
  }

  upsertInvoice(invoice: SweepNodeInvoice) {
    const invoiceId = normalizeInvoiceId(invoice.invoiceId);
    const row: SweepNodeInvoice = { ...invoice, invoiceId };
    this.db
      .prepare(
        `
          INSERT INTO invoices (
            chain_id, invoice_id, invoice_address, data, token, amount, min_amount, source_json, updated_at
          )
          VALUES (@chainId, @invoiceId, @invoiceAddress, @data, @token, @amount, @minAmount, @sourceJson, @updatedAt)
          ON CONFLICT(chain_id, invoice_id) DO UPDATE SET
            invoice_address = excluded.invoice_address,
            data = excluded.data,
            token = excluded.token,
            amount = excluded.amount,
            min_amount = excluded.min_amount,
            source_json = excluded.source_json,
            updated_at = excluded.updated_at
        `
      )
      .run({
        chainId: invoice.chainId,
        invoiceId,
        invoiceAddress: row.invoiceAddress,
        data: row.data,
        token: row.token ?? null,
        amount: row.amount?.toString() ?? null,
        minAmount: row.minAmount?.toString() ?? null,
        sourceJson: JSON.stringify(row),
        updatedAt: Date.now(),
      });
  }

  getInvoice(chainId: string, invoiceId: string): SweepNodeInvoice | undefined {
    const id = normalizeInvoiceId(invoiceId);
    const row = this.db
      .prepare("SELECT source_json FROM invoices WHERE chain_id = ? AND invoice_id = ?")
      .get(chainId, id) as { source_json: string } | undefined;
    return row ? (JSON.parse(row.source_json) as SweepNodeInvoice) : undefined;
  }

  listInvoicesByChain(chainId: string, limit: number): SweepNodeInvoice[] {
    const rows = this.db
      .prepare("SELECT source_json FROM invoices WHERE chain_id = ? ORDER BY updated_at DESC LIMIT ?")
      .all(chainId, limit) as Array<{ source_json: string }>;
    return rows.map((row) => JSON.parse(row.source_json) as SweepNodeInvoice);
  }

  hasSuccessfulSweep(chainId: string, invoiceId: string): boolean {
    const id = normalizeInvoiceId(invoiceId);
    const row = this.db
      .prepare(
        `SELECT 1 FROM sweep_attempts WHERE chain_id = ? AND invoice_id = ? AND status = 'swept' LIMIT 1`
      )
      .get(chainId, id);
    return row !== undefined;
  }

  /** Invoices that have not yet been successfully swept. The sweeper verifies balances before submitting txs. */
  listAwaitingSweepInvoices(chainId: string, limit: number): SweepNodeInvoice[] {
    const rows = this.db
      .prepare(
        `
          SELECT i.source_json
          FROM invoices i
          WHERE i.chain_id = ?
            AND NOT EXISTS (
              SELECT 1 FROM sweep_attempts sa
              WHERE sa.chain_id = i.chain_id
                AND LOWER(sa.invoice_id) = LOWER(i.invoice_id)
                AND sa.status = 'swept'
            )
          ORDER BY i.updated_at DESC
          LIMIT ?
        `
      )
      .all(chainId, limit) as Array<{ source_json: string }>;

    return rows.map((row) => JSON.parse(row.source_json) as SweepNodeInvoice);
  }

  markInvoiceChecked(chainId: string, invoiceId: string) {
    const id = normalizeInvoiceId(invoiceId);
    this.db
      .prepare("UPDATE invoices SET last_checked_at = ? WHERE chain_id = ? AND invoice_id = ?")
      .run(Date.now(), chainId, id);
  }

  upsertPaidInvoice(paid: PaidInvoice) {
    const invoiceId = normalizeInvoiceId(paid.invoiceId);
    this.db
      .prepare(
        `
          INSERT INTO paid_invoices (
            chain_id, invoice_id, token, amount, forwarder, tx_hash, log_index, block_number, timestamp
          )
          VALUES (@chainId, @invoiceId, @token, @amount, @forwarder, @txHash, @logIndex, @blockNumber, @timestamp)
          ON CONFLICT(chain_id, invoice_id) DO UPDATE SET
            token = excluded.token,
            amount = excluded.amount,
            forwarder = excluded.forwarder,
            tx_hash = excluded.tx_hash,
            log_index = excluded.log_index,
            block_number = excluded.block_number,
            timestamp = excluded.timestamp
        `
      )
      .run({
        ...paid,
        invoiceId,
        blockNumber: paid.blockNumber ?? null,
        timestamp: paid.timestamp ?? null,
      });
  }

  isPaid(chainId: string, invoiceId: string): boolean {
    const id = normalizeInvoiceId(invoiceId);
    const row = this.db
      .prepare("SELECT 1 FROM paid_invoices WHERE chain_id = ? AND invoice_id = ?")
      .get(chainId, id);
    return row !== undefined;
  }

  getPaidInvoice(chainId: string, invoiceId: string): PaidInvoice | undefined {
    const id = normalizeInvoiceId(invoiceId);
    const row = this.db
      .prepare(
        `
          SELECT chain_id, invoice_id, token, amount, forwarder, tx_hash, log_index, block_number, timestamp
          FROM paid_invoices
          WHERE chain_id = ? AND invoice_id = ?
        `
      )
      .get(chainId, id) as
      | {
          chain_id: string;
          invoice_id: string;
          token: string;
          amount: string;
          forwarder: string;
          tx_hash: string;
          log_index: number;
          block_number: number | null;
          timestamp: number | null;
        }
      | undefined;
    if (!row) return undefined;
    return {
      chainId: row.chain_id,
      invoiceId: row.invoice_id,
      token: row.token,
      amount: row.amount,
      forwarder: row.forwarder,
      txHash: row.tx_hash,
      logIndex: row.log_index,
      blockNumber: row.block_number ?? undefined,
      timestamp: row.timestamp ?? undefined,
    };
  }

  getLastScannedBlock(chainId: string, fallback: number): number {
    const row = this.db
      .prepare("SELECT last_scanned_block FROM chain_progress WHERE chain_id = ?")
      .get(chainId) as { last_scanned_block: number | null } | undefined;
    return row?.last_scanned_block ?? fallback;
  }

  setLastScannedBlock(chainId: string, block: number) {
    this.db
      .prepare(
        `
          INSERT INTO chain_progress (chain_id, last_scanned_block)
          VALUES (?, ?)
          ON CONFLICT(chain_id) DO UPDATE SET last_scanned_block = excluded.last_scanned_block
        `
      )
      .run(chainId, block);
  }

  getLastScannedTimestamp(chainId: string, fallback: number): number {
    const row = this.db
      .prepare("SELECT last_scanned_timestamp FROM chain_progress WHERE chain_id = ?")
      .get(chainId) as { last_scanned_timestamp: number | null } | undefined;
    return row?.last_scanned_timestamp ?? fallback;
  }

  setLastScannedTimestamp(chainId: string, timestamp: number) {
    this.db
      .prepare(
        `
          INSERT INTO chain_progress (chain_id, last_scanned_timestamp)
          VALUES (?, ?)
          ON CONFLICT(chain_id) DO UPDATE SET last_scanned_timestamp = excluded.last_scanned_timestamp
        `
      )
      .run(chainId, timestamp);
  }

  recordSweepAttempt(attempt: SweepAttempt) {
    const invoiceId = normalizeInvoiceId(attempt.invoiceId);
    this.db
      .prepare(
        `
          INSERT INTO sweep_attempts (chain_id, invoice_id, status, tx_id, error, attempted_at)
          VALUES (@chainId, @invoiceId, @status, @txId, @error, @attemptedAt)
        `
      )
      .run({
        ...attempt,
        invoiceId,
        txId: attempt.txId ?? null,
        error: attempt.error ?? null,
        attemptedAt: Date.now(),
      });
  }
}
