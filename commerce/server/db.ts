import Database from "better-sqlite3";
import type {
  AdminStats,
  InvoiceEvent,
  InvoiceEventKind,
  InvoiceRecord,
  InvoiceStatus,
  PayLinkFields,
  SweeperRecord,
} from "../shared/types.js";

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
              invoice_address, title, description, callback_url, allow_partial, status,
              amount_paid, amount_swept, fee_collected, gas_spent_wei, sweep_tx,
              pay_session_id, version, claimed_by, claimed_until,
              created_at, updated_at, paid_at, swept_at
            ) VALUES (
              @id, @invoiceSeed, @clientInvoiceId, @priceUsd, @toAddresses, @selectedTo, @chainId, @token,
              @invoiceAddress, @title, @description, @callbackUrl, @allowPartial, 'awaiting_payment',
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
    `);

    this.ensureColumn("invoices", "version", "INTEGER NOT NULL DEFAULT 1");
    this.ensureColumn("invoices", "claimed_by", "TEXT");
    this.ensureColumn("invoices", "claimed_until", "TEXT");
    this.ensureColumn("invoices", "invoice_seed", "TEXT NOT NULL DEFAULT ''");
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

function mapInvoice(row: InvoiceRow): InvoiceRecord {
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

function eventKindForStatus(status: InvoiceStatus, error: unknown): InvoiceEventKind {
  if (error) return "error";
  if (status === "swept") return "swept";
  if (status === "paid" || status === "paid_partial") return "paid";
  return "created";
}
