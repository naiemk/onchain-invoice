import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import type {
  AdminStats,
  InvoiceEvent,
  InvoiceEventKind,
  InvoiceRecord,
  InvoiceStatus,
  PayLinkFields,
  PaymentMode,
  SweeperRecord,
} from "../shared/types.js";
import type { WalletDeviceRecord, WalletPairingRecord, BundlerRecord } from "../shared/wallet.js";
import type { PackedUserOperationJson, UserOpStatus, WalletUserOpRecord } from "../shared/userop.js";
import { parsePaymentMode } from "../shared/onramper.js";

interface InvoiceRow {
  id: string;
  invoice_seed: string | null;
  client_invoice_id: string;
  price_usd: string;
  to_addresses: string;
  selected_to: string | null;
  chain_id: string | null;
  token: string | null;
  invoice_address: string | null;
  title: string | null;
  description: string | null;
  callback_url: string | null;
  allow_partial: 0 | 1;
  payment_mode: string | null;
  payer_fiat: string | null;
  display_fiat: string | null;
  display_amount: string | null;
  quote_country: string | null;
  quote_payment_method: string | null;
  quote_provider: string | null;
  quote_slippage_bps: number | null;
  lang: string | null;
  status: InvoiceStatus;
  amount_paid: string;
  amount_swept: string;
  fee_collected: string;
  gas_spent_wei: string;
  sweep_tx: string | null;
  pay_session_id: string | null;
  version: number;
  claimed_by: string | null;
  claimed_until: string | null;
  created_at: string;
  updated_at: string;
  paid_at: string | null;
  swept_at: string | null;
}

interface EventRow {
  id: number;
  invoice_id: string;
  kind: InvoiceEventKind;
  payload: string;
  created_at: string;
}

interface SweeperRow {
  address: string;
  label: string;
  chains: string;
  enabled: 0 | 1;
  created_at: string;
  last_seen_at: string | null;
}

interface WalletDeviceRow {
  wallet_address: string;
  chain_id: string;
  owner_qx: string;
  owner_qy: string;
  label: string;
  credential_id: string | null;
  created_at: string;
  last_used_at: string | null;
}

interface WalletPairingRow {
  nonce: string;
  wallet_address: string;
  chain_id: string;
  new_owner_qx: string | null;
  new_owner_qy: string | null;
  device_label: string | null;
  status: WalletPairingRecord["status"];
  expires_at: string;
  created_at: string;
}

interface WalletUserOpRow {
  id: string;
  wallet_address: string;
  chain_id: string;
  user_op_hash: string;
  user_op_json: string;
  status: UserOpStatus;
  claimed_by: string | null;
  claimed_until: string | null;
  version: number;
  tx_hash: string | null;
  reject_reason: string | null;
  gas_spent_wei: string | null;
  created_at: string;
  updated_at: string;
}

interface BundlerRow {
  address: string;
  label: string;
  chains: string;
  enabled: 0 | 1;
  created_at: string;
  last_seen_at: string | null;
}

export class CommerceDb {
  private readonly db: Database.Database;

  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  ready(): boolean {
    try {
      this.db.prepare("SELECT 1").get();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Create invoice by primary key `invoiceId`.
   * Duplicate invoice ids are always rejected (409) unless the same Idempotency-Key
   * is retried (returns the prior invoice).
   */
  createInvoice(input: {
    invoiceId: string;
    fields: PayLinkFields;
    chainId: string;
    token: string;
    selectedTo: string;
    invoiceAddress: string | null;
    paySessionId?: string | null;
    idempotencyKey?: string | null;
  }): { invoice: InvoiceRecord; created: boolean } {
    const now = new Date().toISOString();

    if (input.idempotencyKey) {
      const prior = this.db
        .prepare("SELECT invoice_id FROM idempotency_keys WHERE key = ?")
        .get(input.idempotencyKey) as { invoice_id: string } | undefined;
      if (prior) {
        const inv = this.getInvoice(prior.invoice_id);
        if (inv) return { invoice: inv, created: false };
      }
    }

    const existing = this.getInvoice(input.invoiceId);
    if (existing) {
      throw Object.assign(new Error("Invoice id already exists"), {
        statusCode: 409,
        invoice: existing,
      });
    }

    if (!input.fields.invoiceSeed) {
      throw Object.assign(new Error("invoiceSeed is required"), { statusCode: 500 });
    }

    const tx = this.db.transaction(() => {
      try {
        this.db
          .prepare(
            `INSERT INTO invoices (
              id, invoice_seed, client_invoice_id, price_usd, to_addresses, selected_to, chain_id, token,
              invoice_address, title, description, callback_url, allow_partial, payment_mode, payer_fiat,
              display_fiat, display_amount, quote_country, quote_payment_method, quote_provider, quote_slippage_bps, lang, status,
              amount_paid, amount_swept, fee_collected, gas_spent_wei, sweep_tx,
              pay_session_id, version, claimed_by, claimed_until,
              created_at, updated_at, paid_at, swept_at
            ) VALUES (
              @id, @invoiceSeed, @clientInvoiceId, @priceUsd, @toAddresses, @selectedTo, @chainId, @token,
              @invoiceAddress, @title, @description, @callbackUrl, @allowPartial, @paymentMode, NULL,
              @displayFiat, @displayAmount, @quoteCountry, @quotePaymentMethod, @quoteProvider, @quoteSlippageBps, @lang, 'awaiting_payment',
              '0', '0', '0', '0', NULL,
              @paySessionId, 1, NULL, NULL,
              @now, @now, NULL, NULL
            )`
          )
          .run({
            id: input.invoiceId,
            invoiceSeed: input.fields.invoiceSeed,
            clientInvoiceId: input.fields.clientInvoiceId ?? "",
            priceUsd: input.fields.price,
            toAddresses: JSON.stringify(input.fields.to),
            selectedTo: input.selectedTo,
            chainId: input.chainId,
            token: input.token,
            invoiceAddress: input.invoiceAddress,
            title: input.fields.title ?? null,
            description: input.fields.description ?? null,
            callbackUrl: input.fields.callback ?? null,
            allowPartial: input.fields.allowPartial ? 1 : 0,
            paymentMode: input.fields.paymentMode ?? "crypto",
            displayFiat: input.fields.displayFiat?.trim().toUpperCase() ?? null,
            displayAmount: input.fields.displayAmount?.trim() ?? null,
            quoteCountry: input.fields.quoteCountry?.trim().toLowerCase() ?? null,
            quotePaymentMethod: input.fields.quotePaymentMethod?.trim().toLowerCase() ?? null,
            quoteProvider: input.fields.quoteProvider?.trim().toLowerCase() ?? null,
            quoteSlippageBps:
              typeof input.fields.quoteSlippageBps === "number" && Number.isFinite(input.fields.quoteSlippageBps)
                ? Math.round(input.fields.quoteSlippageBps)
                : null,
            lang: input.fields.lang?.trim() || null,
            paySessionId: input.paySessionId ?? null,
            now,
          });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (/UNIQUE|constraint/i.test(message)) {
          const raced = this.getInvoice(input.invoiceId);
          throw Object.assign(new Error("Invoice id already exists"), {
            statusCode: 409,
            invoice: raced ?? undefined,
          });
        }
        throw error;
      }

      this.addEvent(
        input.invoiceId,
        "created",
        {
          activated: true,
          chainId: input.chainId,
          token: input.token,
          selectedTo: input.selectedTo,
          invoiceAddress: input.invoiceAddress,
        },
        now
      );

      if (input.idempotencyKey) {
        this.db
          .prepare(
            `INSERT INTO idempotency_keys (key, invoice_id, created_at) VALUES (?, ?, ?)
             ON CONFLICT(key) DO NOTHING`
          )
          .run(input.idempotencyKey, input.invoiceId, now);
      }

      const invoice = this.getInvoice(input.invoiceId);
      if (!invoice) throw new Error("Failed to create invoice");
      return { invoice, created: true };
    });
    return tx();
  }

  /** @deprecated Prefer createInvoice */
  createSession(input: {
    paySessionId: string;
    invoiceId: string;
    fields: PayLinkFields;
    expiresAt: string;
  }): InvoiceRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sessions (id, invoice_id, payload, created_at, expires_at)
         VALUES (@paySessionId, @invoiceId, @payload, @createdAt, @expiresAt)
         ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, expires_at = excluded.expires_at`
      )
      .run({
        paySessionId: input.paySessionId,
        invoiceId: input.invoiceId,
        payload: JSON.stringify(input.fields),
        createdAt: now,
        expiresAt: input.expiresAt,
      });
    return this.createInvoice({
      invoiceId: input.invoiceId,
      fields: input.fields,
      chainId: input.fields.chains[0],
      token: input.fields.tokens[0],
      selectedTo: input.fields.to[0],
      invoiceAddress: null,
      paySessionId: input.paySessionId,
    }).invoice;
  }

  /** @deprecated Prefer createInvoice */
  activateInvoice(input: {
    invoiceId: string;
    fields: PayLinkFields;
    paySessionId?: string;
    chainId: string;
    token: string;
    selectedTo: string;
    invoiceAddress: string | null;
  }): InvoiceRecord {
    return this.createInvoice({
      ...input,
      paySessionId: input.paySessionId ?? null,
    }).invoice;
  }

  getInvoice(invoiceId: string): InvoiceRecord | null {
    const row = this.db.prepare("SELECT * FROM invoices WHERE id = ?").get(invoiceId) as InvoiceRow | undefined;
    if (row) return mapInvoice(row);
    const byAddress = this.db
      .prepare("SELECT * FROM invoices WHERE lower(invoice_address) = lower(?) ORDER BY updated_at DESC LIMIT 1")
      .get(invoiceId) as InvoiceRow | undefined;
    return byAddress ? mapInvoice(byAddress) : null;
  }

  getEvents(invoiceId: string): InvoiceEvent[] {
    return (this.db.prepare("SELECT * FROM events WHERE invoice_id = ? ORDER BY id ASC").all(invoiceId) as EventRow[]).map(
      mapEvent
    );
  }

  listInvoices(filters: { status?: string; to?: string } = {}): InvoiceRecord[] {
    const clauses: string[] = [];
    const params: Record<string, string> = {};
    if (filters.status) {
      clauses.push("status = @status");
      params.status = filters.status;
    }
    if (filters.to) {
      clauses.push("(selected_to = @to OR to_addresses LIKE @toLike)");
      params.to = filters.to;
      params.toLike = `%${filters.to}%`;
    }
    const sql = `SELECT * FROM invoices ${clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""} ORDER BY created_at DESC`;
    return (this.db.prepare(sql).all(params) as InvoiceRow[]).map(mapInvoice);
  }

  listWorkerInvoices(
    statuses: InvoiceStatus[] = ["awaiting_payment", "paid", "paid_partial"],
    chains?: string[]
  ): InvoiceRecord[] {
    const placeholders = statuses.map((_, index) => `@status${index}`).join(",");
    const params: Record<string, string> = Object.fromEntries(statuses.map((status, index) => [`status${index}`, status]));
    let sql = `SELECT * FROM invoices WHERE status IN (${placeholders})`;
    if (chains && chains.length > 0) {
      const chainPh = chains.map((_, i) => `@chain${i}`).join(",");
      sql += ` AND chain_id IN (${chainPh})`;
      chains.forEach((c, i) => {
        params[`chain${i}`] = c;
      });
    }
    sql += " ORDER BY updated_at ASC LIMIT 250";
    return (this.db.prepare(sql).all(params) as InvoiceRow[]).map(mapInvoice);
  }

  claimInvoice(input: {
    invoiceId: string;
    sweeperAddress: string;
    expectedVersion: number;
    leaseMs: number;
  }): InvoiceRecord {
    const now = new Date();
    const until = new Date(now.getTime() + input.leaseMs).toISOString();
    const nowIso = now.toISOString();
    const result = this.db
      .prepare(
        `UPDATE invoices SET
           claimed_by = @sweeper,
           claimed_until = @until,
           version = version + 1,
           updated_at = @now
         WHERE id = @id
           AND version = @version
           AND status IN ('awaiting_payment', 'paid', 'paid_partial')
           AND (
             claimed_by IS NULL
             OR claimed_by = @sweeper
             OR claimed_until IS NULL
             OR claimed_until < @now
           )`
      )
      .run({
        id: input.invoiceId,
        sweeper: input.sweeperAddress,
        until,
        now: nowIso,
        version: input.expectedVersion,
      });
    if (result.changes === 0) {
      const current = this.getInvoice(input.invoiceId);
      throw Object.assign(new Error("Claim conflict"), { statusCode: 409, invoice: current });
    }
    this.addEvent(input.invoiceId, "claimed", { claimedBy: input.sweeperAddress, claimedUntil: until }, nowIso);
    const invoice = this.getInvoice(input.invoiceId);
    if (!invoice) throw new Error("Failed to claim invoice");
    return invoice;
  }

  trackInvoice(input: {
    invoiceId: string;
    status?: InvoiceStatus;
    amountPaid?: string;
    amountSwept?: string;
    feeCollected?: string;
    gasSpentWei?: string;
    sweepTx?: string;
    error?: unknown;
    payload?: unknown;
    expectedVersion?: number;
    sweeperAddress?: string;
  }): InvoiceRecord {
    const current = this.getInvoice(input.invoiceId);
    if (!current) {
      throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
    }
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw Object.assign(new Error("Version conflict"), { statusCode: 409, invoice: current });
    }
    if (input.status === "swept" && input.sweeperAddress) {
      const now = new Date().toISOString();
      if (
        current.claimedBy &&
        current.claimedBy.toLowerCase() !== input.sweeperAddress.toLowerCase() &&
        current.claimedUntil &&
        current.claimedUntil > now
      ) {
        throw Object.assign(new Error("Invoice claimed by another sweeper"), { statusCode: 409, invoice: current });
      }
    }

    const status = input.status ?? current.status;
    const now = new Date().toISOString();
    const paidAt =
      (status === "paid" || status === "paid_partial" || status === "swept") && !current.paidAt ? now : current.paidAt;
    const sweptAt = status === "swept" && !current.sweptAt ? now : current.sweptAt;

    const clauses = [
      "status = @status",
      "amount_paid = COALESCE(@amountPaid, amount_paid)",
      "amount_swept = COALESCE(@amountSwept, amount_swept)",
      "fee_collected = COALESCE(@feeCollected, fee_collected)",
      "gas_spent_wei = COALESCE(@gasSpentWei, gas_spent_wei)",
      "sweep_tx = COALESCE(@sweepTx, sweep_tx)",
      "paid_at = @paidAt",
      "swept_at = @sweptAt",
      "version = version + 1",
      "updated_at = @now",
    ];
    if (status === "swept") {
      clauses.push("claimed_by = NULL", "claimed_until = NULL");
    }

    let where = "id = @invoiceId";
    if (input.expectedVersion !== undefined) {
      where += " AND version = @expectedVersion";
    }

    const result = this.db
      .prepare(
        `UPDATE invoices SET ${clauses.join(", ")} WHERE ${where}`
      )
      .run({
        invoiceId: input.invoiceId,
        status,
        amountPaid: input.amountPaid ?? null,
        amountSwept: input.amountSwept ?? null,
        feeCollected: input.feeCollected ?? null,
        gasSpentWei: input.gasSpentWei ?? null,
        sweepTx: input.sweepTx ?? null,
        paidAt,
        sweptAt,
        now,
        expectedVersion: input.expectedVersion ?? null,
      });

    if (result.changes === 0) {
      const fresh = this.getInvoice(input.invoiceId);
      throw Object.assign(new Error("Version conflict"), { statusCode: 409, invoice: fresh });
    }

    this.addEvent(
      input.invoiceId,
      eventKindForStatus(status, input.error),
      input.error ? { error: input.error } : (input.payload ?? { status }),
      now
    );
    const updated = this.getInvoice(input.invoiceId);
    if (!updated) throw new Error("Failed to update invoice");
    return updated;
  }

  addEvent(invoiceId: string, kind: InvoiceEventKind, payload: unknown, createdAt = new Date().toISOString()): void {
    this.db
      .prepare("INSERT INTO events (invoice_id, kind, payload, created_at) VALUES (?, ?, ?, ?)")
      .run(invoiceId, kind, JSON.stringify(payload ?? null), createdAt);
  }

  upsertSweeper(input: { address: string; label: string; chains: string[]; enabled?: boolean }): SweeperRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO sweepers (address, label, chains, enabled, created_at, last_seen_at)
         VALUES (@address, @label, @chains, @enabled, @now, NULL)
         ON CONFLICT(address) DO UPDATE SET
           label = excluded.label,
           chains = excluded.chains,
           enabled = excluded.enabled`
      )
      .run({
        address: input.address.toLowerCase(),
        label: input.label,
        chains: JSON.stringify(input.chains),
        enabled: input.enabled === false ? 0 : 1,
        now,
      });
    const row = this.db.prepare("SELECT * FROM sweepers WHERE address = ?").get(input.address.toLowerCase()) as SweeperRow;
    return mapSweeper(row);
  }

  getSweeper(address: string): SweeperRecord | null {
    const row = this.db.prepare("SELECT * FROM sweepers WHERE address = ?").get(address.toLowerCase()) as
      | SweeperRow
      | undefined;
    return row ? mapSweeper(row) : null;
  }

  touchSweeper(address: string): void {
    this.db
      .prepare("UPDATE sweepers SET last_seen_at = ? WHERE address = ?")
      .run(new Date().toISOString(), address.toLowerCase());
  }

  consumeNonce(address: string, nonce: string, ttlMs: number): boolean {
    const now = Date.now();
    this.db.prepare("DELETE FROM sweeper_nonces WHERE expires_at < ?").run(now);
    try {
      this.db
        .prepare("INSERT INTO sweeper_nonces (address, nonce, expires_at) VALUES (?, ?, ?)")
        .run(address.toLowerCase(), nonce, now + ttlMs);
      return true;
    } catch {
      return false;
    }
  }

  stats(): AdminStats {
    const invoices = this.listInvoices();
    const byTo = new Map<string, { count: number; amountPaid: bigint; amountSwept: bigint; feeCollected: bigint }>();
    let fees = 0n;
    let gas = 0n;
    let inFlight = 0;

    for (const invoice of invoices) {
      fees += BigInt(invoice.feeCollected);
      gas += BigInt(invoice.gasSpentWei);
      if (invoice.status === "created" || invoice.status === "awaiting_payment" || invoice.status === "paid_partial") {
        inFlight += 1;
      }
      const key = invoice.selectedTo ?? invoice.toAddresses[0] ?? "unassigned";
      const bucket = byTo.get(key) ?? { count: 0, amountPaid: 0n, amountSwept: 0n, feeCollected: 0n };
      bucket.count += 1;
      bucket.amountPaid += BigInt(invoice.amountPaid);
      bucket.amountSwept += BigInt(invoice.amountSwept);
      bucket.feeCollected += BigInt(invoice.feeCollected);
      byTo.set(key, bucket);
    }

    return {
      fees: fees.toString(),
      gas: gas.toString(),
      inFlight,
      byTo: [...byTo.entries()].map(([to, value]) => ({
        to,
        count: value.count,
        amountPaid: value.amountPaid.toString(),
        amountSwept: value.amountSwept.toString(),
        feeCollected: value.feeCollected.toString(),
      })),
    };
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        invoice_seed TEXT NOT NULL DEFAULT '',
        client_invoice_id TEXT NOT NULL,
        price_usd TEXT NOT NULL,
        to_addresses TEXT NOT NULL,
        selected_to TEXT,
        chain_id TEXT,
        token TEXT,
        invoice_address TEXT,
        title TEXT,
        description TEXT,
        callback_url TEXT,
        allow_partial INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL CHECK (status IN ('created','awaiting_payment','paid','paid_partial','swept')),
        amount_paid TEXT NOT NULL DEFAULT '0',
        amount_swept TEXT NOT NULL DEFAULT '0',
        fee_collected TEXT NOT NULL DEFAULT '0',
        gas_spent_wei TEXT NOT NULL DEFAULT '0',
        sweep_tx TEXT,
        pay_session_id TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        claimed_by TEXT,
        claimed_until TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        paid_at TEXT,
        swept_at TEXT
      );

      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        invoice_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (invoice_id) REFERENCES invoices(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sweepers (
        address TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        chains TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_seen_at TEXT
      );

      CREATE TABLE IF NOT EXISTS sweeper_nonces (
        address TEXT NOT NULL,
        nonce TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (address, nonce)
      );

      CREATE TABLE IF NOT EXISTS idempotency_keys (
        key TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
      CREATE INDEX IF NOT EXISTS idx_invoices_selected_to ON invoices(selected_to);
      CREATE INDEX IF NOT EXISTS idx_events_invoice_id ON events(invoice_id);

      CREATE TABLE IF NOT EXISTS wallet_devices (
        wallet_address TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        owner_qx TEXT NOT NULL,
        owner_qy TEXT NOT NULL,
        label TEXT NOT NULL,
        credential_id TEXT,
        created_at TEXT NOT NULL,
        last_used_at TEXT,
        PRIMARY KEY (wallet_address, chain_id, owner_qx, owner_qy)
      );

      CREATE TABLE IF NOT EXISTS wallet_pairings (
        nonce TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        new_owner_qx TEXT,
        new_owner_qy TEXT,
        device_label TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending','approved','consumed','expired')),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_pairings_wallet ON wallet_pairings(wallet_address, chain_id);

      CREATE TABLE IF NOT EXISTS wallet_user_ops (
        id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        user_op_hash TEXT NOT NULL UNIQUE,
        user_op_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending','claimed','submitted','included','failed','rejected')),
        claimed_by TEXT,
        claimed_until TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        tx_hash TEXT,
        reject_reason TEXT,
        gas_spent_wei TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_user_ops_status ON wallet_user_ops(status, chain_id);

      CREATE TABLE IF NOT EXISTS bundlers (
        address TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        chains TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        last_seen_at TEXT
      );

      CREATE TABLE IF NOT EXISTS bundler_nonces (
        address TEXT NOT NULL,
        nonce TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (address, nonce)
      );
    `);

    this.ensureColumn("invoices", "version", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("invoices", "claimed_by", "TEXT");
    this.ensureColumn("invoices", "claimed_until", "TEXT");
    this.ensureColumn("invoices", "invoice_seed", "TEXT NOT NULL DEFAULT ''");
    this.ensureColumn("invoices", "payment_mode", "TEXT NOT NULL DEFAULT 'crypto'");
    this.ensureColumn("invoices", "payer_fiat", "TEXT");
    this.ensureColumn("invoices", "display_fiat", "TEXT");
    this.ensureColumn("invoices", "display_amount", "TEXT");
    this.ensureColumn("invoices", "quote_country", "TEXT");
    this.ensureColumn("invoices", "quote_payment_method", "TEXT");
    this.ensureColumn("invoices", "quote_provider", "TEXT");
    this.ensureColumn("invoices", "quote_slippage_bps", "INTEGER");
    this.ensureColumn("invoices", "lang", "TEXT");
  }

  listWalletDevices(walletAddress: string, chainId: string): WalletDeviceRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM wallet_devices WHERE wallet_address = ? AND chain_id = ? ORDER BY created_at ASC`
      )
      .all(walletAddress.toLowerCase(), chainId) as WalletDeviceRow[];
    return rows.map(mapWalletDevice);
  }

  upsertWalletDevice(input: {
    walletAddress: string;
    chainId: string;
    ownerQx: string;
    ownerQy: string;
    label: string;
    credentialId: string | null;
  }): WalletDeviceRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO wallet_devices (wallet_address, chain_id, owner_qx, owner_qy, label, credential_id, created_at, last_used_at)
         VALUES (@walletAddress, @chainId, @ownerQx, @ownerQy, @label, @credentialId, @now, @now)
         ON CONFLICT(wallet_address, chain_id, owner_qx, owner_qy) DO UPDATE SET
           label = excluded.label,
           credential_id = COALESCE(excluded.credential_id, credential_id),
           last_used_at = @now`
      )
      .run({
        walletAddress: input.walletAddress.toLowerCase(),
        chainId: input.chainId,
        ownerQx: input.ownerQx,
        ownerQy: input.ownerQy,
        label: input.label,
        credentialId: input.credentialId,
        now,
      });
    return this.listWalletDevices(input.walletAddress, input.chainId).find(
      (d) => d.ownerQx === input.ownerQx && d.ownerQy === input.ownerQy
    )!;
  }

  deleteWalletDevice(walletAddress: string, chainId: string, ownerQx: string, ownerQy: string): void {
    this.db
      .prepare(
        `DELETE FROM wallet_devices WHERE wallet_address = ? AND chain_id = ? AND owner_qx = ? AND owner_qy = ?`
      )
      .run(walletAddress.toLowerCase(), chainId, ownerQx, ownerQy);
  }

  createWalletPairing(walletAddress: string, chainId: string): WalletPairingRecord {
    const now = new Date();
    const expires = new Date(now.getTime() + 5 * 60 * 1000);
    const nonce = randomUUID();
    this.db
      .prepare(
        `INSERT INTO wallet_pairings (nonce, wallet_address, chain_id, status, expires_at, created_at)
         VALUES (?, ?, ?, 'pending', ?, ?)`
      )
      .run(nonce, walletAddress.toLowerCase(), chainId, expires.toISOString(), now.toISOString());
    return this.getWalletPairing(nonce)!;
  }

  submitWalletPairing(
    nonce: string,
    newOwnerQx: string,
    newOwnerQy: string,
    deviceLabel: string | null
  ): WalletPairingRecord | null {
    const row = this.getWalletPairing(nonce);
    if (!row || row.status !== "pending") return null;
    if (new Date(row.expiresAt).getTime() < Date.now()) {
      this.db.prepare(`UPDATE wallet_pairings SET status = 'expired' WHERE nonce = ?`).run(nonce);
      return null;
    }
    this.db
      .prepare(
        `UPDATE wallet_pairings SET new_owner_qx = ?, new_owner_qy = ?, device_label = ?, status = 'approved' WHERE nonce = ?`
      )
      .run(newOwnerQx, newOwnerQy, deviceLabel, nonce);
    return this.getWalletPairing(nonce);
  }

  getWalletPairing(nonce: string): WalletPairingRecord | null {
    const row = this.db.prepare(`SELECT * FROM wallet_pairings WHERE nonce = ?`).get(nonce) as
      | WalletPairingRow
      | undefined;
    return row ? mapWalletPairing(row) : null;
  }

  createWalletUserOp(input: {
    walletAddress: string;
    chainId: string;
    userOpHash: string;
    userOp: PackedUserOperationJson;
  }): WalletUserOpRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO wallet_user_ops (
           id, wallet_address, chain_id, user_op_hash, user_op_json, status,
           version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, 'pending', 1, ?, ?)`
      )
      .run(
        id,
        input.walletAddress.toLowerCase(),
        input.chainId,
        input.userOpHash.toLowerCase(),
        JSON.stringify(input.userOp),
        now,
        now
      );
    return this.getWalletUserOpByHash(input.userOpHash)!;
  }

  getWalletUserOpByHash(userOpHash: string): WalletUserOpRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM wallet_user_ops WHERE user_op_hash = ?`)
      .get(userOpHash.toLowerCase()) as WalletUserOpRow | undefined;
    return row ? mapWalletUserOp(row) : null;
  }

  listBundlerUserOps(statuses: UserOpStatus[] = ["pending"], chains?: string[]): WalletUserOpRecord[] {
    let sql = `SELECT * FROM wallet_user_ops WHERE status IN (${statuses.map(() => "?").join(",")})`;
    const params: unknown[] = [...statuses];
    if (chains?.length) {
      sql += ` AND chain_id IN (${chains.map(() => "?").join(",")})`;
      params.push(...chains);
    }
    sql += " ORDER BY created_at ASC LIMIT 100";
    return (this.db.prepare(sql).all(...params) as WalletUserOpRow[]).map(mapWalletUserOp);
  }

  claimWalletUserOp(input: {
    userOpHash: string;
    bundlerAddress: string;
    expectedVersion: number;
    leaseMs: number;
  }): WalletUserOpRecord {
    const now = new Date();
    const until = new Date(now.getTime() + input.leaseMs).toISOString();
    const nowIso = now.toISOString();
    const result = this.db
      .prepare(
        `UPDATE wallet_user_ops SET
           claimed_by = @bundler,
           claimed_until = @until,
           status = 'claimed',
           version = version + 1,
           updated_at = @now
         WHERE user_op_hash = @hash
           AND version = @version
           AND status IN ('pending', 'claimed')
           AND (claimed_by IS NULL OR claimed_by = @bundler OR claimed_until < @now)`
      )
      .run({
        bundler: input.bundlerAddress.toLowerCase(),
        until,
        now: nowIso,
        hash: input.userOpHash.toLowerCase(),
        version: input.expectedVersion,
      });
    if (result.changes === 0) {
      const current = this.getWalletUserOpByHash(input.userOpHash);
      throw Object.assign(new Error("UserOp claim conflict"), { statusCode: 409, userOp: current });
    }
    return this.getWalletUserOpByHash(input.userOpHash)!;
  }

  trackWalletUserOp(input: {
    userOpHash: string;
    status?: UserOpStatus;
    txHash?: string | null;
    rejectReason?: string | null;
    gasSpentWei?: string | null;
    expectedVersion?: number;
    bundlerAddress?: string;
  }): WalletUserOpRecord {
    const current = this.getWalletUserOpByHash(input.userOpHash);
    if (!current) throw Object.assign(new Error("UserOp not found"), { statusCode: 404 });
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw Object.assign(new Error("UserOp version conflict"), { statusCode: 409, userOp: current });
    }
    if (input.bundlerAddress && current.claimedBy && current.claimedBy !== input.bundlerAddress.toLowerCase()) {
      throw Object.assign(new Error("UserOp claimed by another bundler"), { statusCode: 409, userOp: current });
    }
    const now = new Date().toISOString();
    const terminal = input.status === "included" || input.status === "failed" || input.status === "rejected";
    this.db
      .prepare(
        `UPDATE wallet_user_ops SET
           status = COALESCE(@status, status),
           tx_hash = COALESCE(@txHash, tx_hash),
           reject_reason = COALESCE(@rejectReason, reject_reason),
           gas_spent_wei = COALESCE(@gasSpentWei, gas_spent_wei),
           version = version + 1,
           claimed_by = CASE WHEN @clearClaim = 1 THEN NULL ELSE claimed_by END,
           claimed_until = CASE WHEN @clearClaim = 1 THEN NULL ELSE claimed_until END,
           updated_at = @now
         WHERE user_op_hash = @hash`
      )
      .run({
        status: input.status ?? null,
        txHash: input.txHash ?? null,
        rejectReason: input.rejectReason ?? null,
        gasSpentWei: input.gasSpentWei ?? null,
        clearClaim: terminal ? 1 : 0,
        now,
        hash: input.userOpHash.toLowerCase(),
      });
    return this.getWalletUserOpByHash(input.userOpHash)!;
  }

  upsertBundler(input: { address: string; label: string; chains: string[]; enabled?: boolean }): BundlerRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO bundlers (address, label, chains, enabled, created_at, last_seen_at)
         VALUES (@address, @label, @chains, @enabled, @now, NULL)
         ON CONFLICT(address) DO UPDATE SET
           label = excluded.label,
           chains = excluded.chains,
           enabled = excluded.enabled`
      )
      .run({
        address: input.address.toLowerCase(),
        label: input.label,
        chains: JSON.stringify(input.chains),
        enabled: input.enabled === false ? 0 : 1,
        now,
      });
    const row = this.db.prepare("SELECT * FROM bundlers WHERE address = ?").get(input.address.toLowerCase()) as BundlerRow;
    return mapBundler(row);
  }

  getBundler(address: string): BundlerRecord | null {
    const row = this.db.prepare("SELECT * FROM bundlers WHERE address = ?").get(address.toLowerCase()) as
      | BundlerRow
      | undefined;
    return row ? mapBundler(row) : null;
  }

  touchBundler(address: string): void {
    this.db
      .prepare("UPDATE bundlers SET last_seen_at = ? WHERE address = ?")
      .run(new Date().toISOString(), address.toLowerCase());
  }

  consumeBundlerNonce(address: string, nonce: string, ttlMs: number): boolean {
    const now = Date.now();
    this.db.prepare("DELETE FROM bundler_nonces WHERE expires_at < ?").run(now);
    try {
      this.db
        .prepare("INSERT INTO bundler_nonces (address, nonce, expires_at) VALUES (?, ?, ?)")
        .run(address.toLowerCase(), nonce, now + ttlMs);
      return true;
    } catch {
      return false;
    }
  }

  setPayerFiat(invoiceId: string, fiat: string): InvoiceRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE invoices SET payer_fiat = ?, updated_at = ? WHERE id = ?`)
      .run(fiat.trim().toUpperCase(), now, invoiceId);
    const invoice = this.getInvoice(invoiceId);
    if (!invoice) throw Object.assign(new Error("Invoice not found"), { statusCode: 404 });
    return invoice;
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

function mapInvoice(row: InvoiceRow): InvoiceRecord {
  let paymentMode: PaymentMode = "crypto";
  try {
    paymentMode = parsePaymentMode(row.payment_mode);
  } catch {
    paymentMode = "crypto";
  }
  return {
    id: row.id,
    invoiceSeed: row.invoice_seed ?? "",
    clientInvoiceId: row.client_invoice_id,
    priceUsd: row.price_usd,
    toAddresses: JSON.parse(row.to_addresses) as string[],
    selectedTo: row.selected_to,
    chainId: row.chain_id,
    token: row.token,
    invoiceAddress: row.invoice_address,
    title: row.title,
    description: row.description,
    callbackUrl: row.callback_url,
    allowPartial: row.allow_partial === 1,
    paymentMode,
    payerFiat: row.payer_fiat ?? null,
    displayFiat: row.display_fiat ?? null,
    displayAmount: row.display_amount ?? null,
    quoteCountry: row.quote_country ?? null,
    quotePaymentMethod: row.quote_payment_method ?? null,
    quoteProvider: row.quote_provider ?? null,
    quoteSlippageBps: row.quote_slippage_bps ?? null,
    lang: row.lang ?? null,
    status: row.status,
    amountPaid: row.amount_paid,
    amountSwept: row.amount_swept,
    feeCollected: row.fee_collected,
    gasSpentWei: row.gas_spent_wei,
    sweepTx: row.sweep_tx,
    paySessionId: row.pay_session_id,
    version: row.version ?? 1,
    claimedBy: row.claimed_by,
    claimedUntil: row.claimed_until,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    paidAt: row.paid_at,
    sweptAt: row.swept_at,
  };
}

function mapEvent(row: EventRow): InvoiceEvent {
  return {
    id: row.id,
    invoiceId: row.invoice_id,
    kind: row.kind,
    payload: JSON.parse(row.payload) as unknown,
    createdAt: row.created_at,
  };
}

function mapSweeper(row: SweeperRow): SweeperRecord {
  return {
    address: row.address,
    label: row.label,
    chains: JSON.parse(row.chains) as string[],
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function mapWalletDevice(row: WalletDeviceRow): WalletDeviceRecord {
  return {
    walletAddress: row.wallet_address,
    chainId: row.chain_id,
    ownerQx: row.owner_qx,
    ownerQy: row.owner_qy,
    label: row.label,
    credentialId: row.credential_id,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
  };
}

function mapWalletPairing(row: WalletPairingRow): WalletPairingRecord {
  return {
    nonce: row.nonce,
    walletAddress: row.wallet_address,
    chainId: row.chain_id,
    newOwnerQx: row.new_owner_qx,
    newOwnerQy: row.new_owner_qy,
    deviceLabel: row.device_label,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function mapWalletUserOp(row: WalletUserOpRow): WalletUserOpRecord {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    chainId: row.chain_id,
    userOpHash: row.user_op_hash,
    userOp: JSON.parse(row.user_op_json) as PackedUserOperationJson,
    status: row.status,
    claimedBy: row.claimed_by,
    claimedUntil: row.claimed_until,
    version: row.version,
    txHash: row.tx_hash,
    rejectReason: row.reject_reason,
    gasSpentWei: row.gas_spent_wei,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapBundler(row: BundlerRow): BundlerRecord {
  return {
    address: row.address,
    label: row.label,
    chains: JSON.parse(row.chains) as string[],
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  };
}

function eventKindForStatus(status: InvoiceStatus, error: unknown): InvoiceEventKind {
  if (error) return "error";
  if (status === "swept") return "swept";
  if (status === "paid" || status === "paid_partial") return "paid";
  return "created";
}
