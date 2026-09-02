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
import { credentialIdLookupVariants, credentialIdsMatch } from "../shared/credential-id.js";
import type {
  WalletDeviceRecord,
  WalletPairingRecord,
  WalletAccountRecord,
  BundlerRecord,
  WalletClientRecord,
  WalletIdentityRecord,
  WalletChallengeRecord,
  WalletChallengePurpose,
  WalletRecoveryJobRecord,
  WalletRecoveryJobKind,
  WalletRecoveryJobStatus,
  WalletEmailRecord,
  WalletEmailOtpPurpose,
  WalletRecoveryRequestRecord,
  WalletRecoveryRequestStatus,
  HostedRecoveryChallengePurpose,
  HostedRecoveryChallengeRecord,
  WalletEntityRecord,
  WalletEntityKeyRecord,
  WalletKeyEnrollmentRequestRecord,
  WalletKeyEnrollmentStatus,
  WalletProposalRecord,
  WalletProposalSigRecord,
  WalletProposalStatus,
} from "../shared/wallet.js";
import type { PackedUserOperationJson, UserOpStatus, WalletUserOpRecord } from "../shared/userop.js";
import { parsePaymentMode } from "../shared/onramper.js";
import { PersistLog, WALLET_PERSIST_STREAM } from "./persist-log.js";

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

interface WalletAccountRow {
  address: string;
  salt: string;
  owner_qx: string;
  owner_qy: string;
  credential_id: string | null;
  webauthn_attestation: string | null;
  deployed_chains: string;
  activation_priority_at: string | null;
  activation_next_check_at: string | null;
  activation_last_check_at: string | null;
  activation_check_count: number;
  activation_status: string;
  activation_error: string | null;
  created_at: string;
  updated_at: string;
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

interface WalletEntityRow {
  wallet_address: string;
  entity_id: string;
  label: string | null;
  created_at: string;
}

interface WalletEntityKeyRow {
  wallet_address: string;
  entity_id: string;
  key_id: string;
  key_type: number;
  qx: string | null;
  qy: string | null;
  eoa: string | null;
  credential_id: string | null;
  created_at: string;
}

interface WalletKeyEnrollmentRequestRow {
  id: string;
  wallet_address: string;
  entity_id: string;
  key_type: number;
  qx: string | null;
  qy: string | null;
  eoa: string | null;
  credential_id: string | null;
  label: string | null;
  status: WalletKeyEnrollmentStatus;
  expires_at: string;
  created_at: string;
  resolved_at: string | null;
}

interface WalletProposalRow {
  id: string;
  wallet_address: string;
  chain_id: string;
  target: string;
  value: string;
  data: string;
  nonce: string | null;
  status: WalletProposalStatus;
  created_at: string;
  updated_at: string;
}

interface WalletProposalSigRow {
  proposal_id: string;
  entity_id: string;
  key_id: string;
  key_type: number;
  signature: string;
  created_at: string;
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
  private readonly persistLog: PersistLog | null;
  private skipPersistLog = false;

  constructor(path: string, options?: { persistLogDir?: string }) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.persistLog =
      options?.persistLogDir != null
        ? new PersistLog(options.persistLogDir)
        : PersistLog.fromEnv();
    this.migrate();
  }

  runWithoutPersistLog<T>(fn: () => T): T {
    const prev = this.skipPersistLog;
    this.skipPersistLog = true;
    try {
      return fn();
    } finally {
      this.skipPersistLog = prev;
    }
  }

  private walletPersist(type: string, payload: Record<string, unknown>, eventId?: string): void {
    if (this.skipPersistLog || !this.persistLog) return;
    this.persistLog.append(WALLET_PERSIST_STREAM, type, payload, eventId);
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

      CREATE TABLE IF NOT EXISTS wallet_accounts (
        address TEXT PRIMARY KEY,
        salt TEXT NOT NULL,
        owner_qx TEXT NOT NULL,
        owner_qy TEXT NOT NULL,
        credential_id TEXT,
        webauthn_attestation TEXT,
        deployed_chains TEXT NOT NULL DEFAULT '[]',
        activation_priority_at TEXT,
        activation_next_check_at TEXT,
        activation_last_check_at TEXT,
        activation_check_count INTEGER NOT NULL DEFAULT 0,
        activation_status TEXT NOT NULL DEFAULT 'pending',
        activation_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

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

      CREATE INDEX IF NOT EXISTS idx_wallet_accounts_credential ON wallet_accounts(credential_id);
      CREATE INDEX IF NOT EXISTS idx_wallet_devices_credential ON wallet_devices(credential_id);

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

      CREATE TABLE IF NOT EXISTS wallet_clients (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        rp_id TEXT NOT NULL,
        origins TEXT,
        hmac_secret TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_seen_at TEXT
      );

      CREATE TABLE IF NOT EXISTS wallet_client_nonces (
        client_id TEXT NOT NULL,
        nonce TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (client_id, nonce)
      );

      CREATE TABLE IF NOT EXISTS wallet_identities (
        client_id TEXT NOT NULL,
        email TEXT NOT NULL,
        wallet_address TEXT NOT NULL,
        contact_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (client_id, email, wallet_address)
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_identities_client_email
        ON wallet_identities(client_id, email);

      CREATE TABLE IF NOT EXISTS wallet_challenges (
        id TEXT PRIMARY KEY,
        client_id TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose IN ('create','recover','cancel')),
        challenge TEXT NOT NULL,
        email TEXT,
        wallet_address TEXT,
        consumed INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_challenges_client
        ON wallet_challenges(client_id, expires_at);

      CREATE TABLE IF NOT EXISTS wallet_recovery_jobs (
        id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('initiate','cancel','execute')),
        new_qx TEXT,
        new_qy TEXT,
        cancel_signature TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending','claimed','submitted','included','failed','rejected')),
        claimed_by TEXT,
        claimed_until TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        tx_hash TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_recovery_jobs_status
        ON wallet_recovery_jobs(status, chain_id);

      CREATE TABLE IF NOT EXISTS wallet_emails (
        wallet_address TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        verified_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_emails_email ON wallet_emails(email);

      CREATE TABLE IF NOT EXISTS wallet_email_otps (
        id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        email TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose IN ('attach','recover')),
        code_hash TEXT NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        consumed_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_email_otps_wallet
        ON wallet_email_otps(wallet_address, purpose, expires_at);

      CREATE TABLE IF NOT EXISTS wallet_hosted_challenges (
        id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL CHECK (purpose IN ('attach','recover','cancel','record')),
        challenge TEXT NOT NULL,
        wallet_address TEXT,
        consumed INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS wallet_recovery_requests (
        id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        email TEXT NOT NULL,
        new_qx TEXT NOT NULL,
        new_qy TEXT NOT NULL,
        credential_id TEXT NOT NULL,
        device_label TEXT,
        status TEXT NOT NULL CHECK (status IN (
          'awaiting_email','awaiting_guardian','queued','on_chain',
          'completed','cancelled','rejected','archived'
        )),
        email_verified_at TEXT,
        captcha_ok_at TEXT,
        guardian_address TEXT,
        guardian_acted_at TEXT,
        job_id TEXT,
        chain_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_recovery_requests_status
        ON wallet_recovery_requests(status, created_at);
      CREATE INDEX IF NOT EXISTS idx_wallet_recovery_requests_wallet
        ON wallet_recovery_requests(wallet_address, status);

      CREATE TABLE IF NOT EXISTS wallet_entities (
        wallet_address TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        label TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (wallet_address, entity_id)
      );

      CREATE TABLE IF NOT EXISTS wallet_entity_keys (
        wallet_address TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        key_id TEXT NOT NULL,
        key_type INTEGER NOT NULL,
        qx TEXT,
        qy TEXT,
        eoa TEXT,
        credential_id TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (wallet_address, key_id)
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_entity_keys_entity
        ON wallet_entity_keys(wallet_address, entity_id);

      CREATE TABLE IF NOT EXISTS wallet_key_enrollment_requests (
        id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        key_type INTEGER NOT NULL,
        qx TEXT,
        qy TEXT,
        eoa TEXT,
        credential_id TEXT,
        label TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending','approved','rejected','expired')),
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        resolved_at TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_key_enrollment_wallet
        ON wallet_key_enrollment_requests(wallet_address, status);

      CREATE TABLE IF NOT EXISTS wallet_proposals (
        id TEXT PRIMARY KEY,
        wallet_address TEXT NOT NULL,
        chain_id TEXT NOT NULL,
        target TEXT NOT NULL,
        value TEXT NOT NULL,
        data TEXT NOT NULL,
        nonce TEXT,
        status TEXT NOT NULL CHECK (status IN ('draft','signing','ready','executed','cancelled')),
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_wallet_proposals_wallet
        ON wallet_proposals(wallet_address, status);

      CREATE TABLE IF NOT EXISTS wallet_proposal_sigs (
        proposal_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        key_id TEXT NOT NULL,
        key_type INTEGER NOT NULL,
        signature TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (proposal_id, entity_id),
        FOREIGN KEY (proposal_id) REFERENCES wallet_proposals(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS guardian_nonces (
        address TEXT NOT NULL,
        nonce TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        PRIMARY KEY (address, nonce)
      );

      CREATE TABLE IF NOT EXISTS guardian_sessions (
        token_hash TEXT PRIMARY KEY,
        address TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
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
    this.ensureColumn("wallet_accounts", "activation_priority_at", "TEXT");
    this.ensureColumn("wallet_accounts", "activation_next_check_at", "TEXT");
    this.ensureColumn("wallet_accounts", "activation_last_check_at", "TEXT");
    this.ensureColumn("wallet_accounts", "activation_check_count", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("wallet_accounts", "activation_status", "TEXT NOT NULL DEFAULT 'pending'");
    this.ensureColumn("wallet_accounts", "activation_error", "TEXT");
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_wallet_accounts_activation
        ON wallet_accounts(activation_priority_at, activation_status, activation_next_check_at);
    `);
    this.migrateHostedChallengesRecordPurpose();
  }

  private migrateHostedChallengesRecordPurpose(): void {
    const row = this.db
      .prepare(
        `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'wallet_hosted_challenges'`
      )
      .get() as { sql: string } | undefined;
    if (!row?.sql || row.sql.includes("'record'")) return;
    this.db.exec(`
      PRAGMA foreign_keys = OFF;
      CREATE TABLE wallet_hosted_challenges_new (
        id TEXT PRIMARY KEY,
        purpose TEXT NOT NULL CHECK (purpose IN ('attach','recover','cancel','record')),
        challenge TEXT NOT NULL,
        wallet_address TEXT,
        consumed INTEGER NOT NULL DEFAULT 0,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO wallet_hosted_challenges_new
        SELECT id, purpose, challenge, wallet_address, consumed, expires_at, created_at
        FROM wallet_hosted_challenges;
      DROP TABLE wallet_hosted_challenges;
      ALTER TABLE wallet_hosted_challenges_new RENAME TO wallet_hosted_challenges;
      PRAGMA foreign_keys = ON;
    `);
  }

  upsertWalletAccount(input: {
    address: string;
    salt: string;
    ownerQx: string;
    ownerQy: string;
    credentialId: string | null;
    webauthnAttestation: string | null;
  }): WalletAccountRecord {
    const now = new Date().toISOString();
    const addr = input.address.toLowerCase();
    const existed = this.getWalletAccount(addr);
    this.db
      .prepare(
        `INSERT INTO wallet_accounts (
           address, salt, owner_qx, owner_qy, credential_id, webauthn_attestation,
           deployed_chains, created_at, updated_at
         ) VALUES (@address, @salt, @ownerQx, @ownerQy, @credentialId, @webauthnAttestation, '[]', @now, @now)
         ON CONFLICT(address) DO UPDATE SET
           credential_id = COALESCE(excluded.credential_id, credential_id),
           webauthn_attestation = COALESCE(excluded.webauthn_attestation, webauthn_attestation),
           updated_at = @now`
      )
      .run({
        address: addr,
        salt: input.salt,
        ownerQx: input.ownerQx,
        ownerQy: input.ownerQy,
        credentialId: input.credentialId,
        webauthnAttestation: input.webauthnAttestation,
        now,
      });
    if (!existed) {
      this.walletPersist("account.created", {
        address: addr,
        salt: input.salt,
        ownerQx: input.ownerQx,
        ownerQy: input.ownerQy,
        credentialId: input.credentialId,
      });
    } else if (input.credentialId && input.credentialId !== existed.credentialId) {
      this.walletPersist("account.credential_updated", {
        address: addr,
        credentialId: input.credentialId,
      });
    }
    return this.getWalletAccount(addr)!;
  }

  getWalletAccount(address: string): WalletAccountRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM wallet_accounts WHERE address = ?`)
      .get(address.toLowerCase()) as WalletAccountRow | undefined;
    return row ? mapWalletAccount(row) : null;
  }

  /** Lookup by WebAuthn credential id (account row or paired device). */
  getWalletAccountByCredentialId(credentialId: string): WalletAccountRecord | null {
    const variants = credentialIdLookupVariants(credentialId);
    for (const id of variants) {
      const byAccount = this.db
        .prepare(`SELECT * FROM wallet_accounts WHERE credential_id = ? LIMIT 1`)
        .get(id) as WalletAccountRow | undefined;
      if (byAccount) return mapWalletAccount(byAccount);
    }

    for (const id of variants) {
      const device = this.db
        .prepare(
          `SELECT wallet_address FROM wallet_devices WHERE credential_id = ? ORDER BY last_used_at DESC LIMIT 1`
        )
        .get(id) as { wallet_address: string } | undefined;
      if (device) return this.getWalletAccount(device.wallet_address);
    }

    const rows = this.db
      .prepare(`SELECT * FROM wallet_accounts WHERE credential_id IS NOT NULL AND credential_id != ''`)
      .all() as WalletAccountRow[];
    const accountRow = rows.find((row) => credentialIdsMatch(row.credential_id, credentialId));
    if (accountRow) return mapWalletAccount(accountRow);

    const deviceRows = this.db
      .prepare(`SELECT * FROM wallet_devices WHERE credential_id IS NOT NULL AND credential_id != ''`)
      .all() as WalletDeviceRow[];
    const deviceRow = deviceRows.find((row) => credentialIdsMatch(row.credential_id, credentialId));
    if (deviceRow) return this.getWalletAccount(deviceRow.wallet_address);

    return null;
  }

  getWalletDeviceByCredentialId(
    credentialId: string,
    walletAddress?: string
  ): WalletDeviceRecord | null {
    const id = credentialId.trim();
    if (!id) return null;
    if (walletAddress) {
      const row = this.db
        .prepare(
          `SELECT * FROM wallet_devices WHERE credential_id = ? AND wallet_address = ? LIMIT 1`
        )
        .get(id, walletAddress.toLowerCase()) as WalletDeviceRow | undefined;
      return row ? mapWalletDevice(row) : null;
    }
    const row = this.db
      .prepare(`SELECT * FROM wallet_devices WHERE credential_id = ? ORDER BY last_used_at DESC LIMIT 1`)
      .get(id) as WalletDeviceRow | undefined;
    return row ? mapWalletDevice(row) : null;
  }

  listUndeployedWalletAccounts(chainId: string, limit = 100): WalletAccountRecord[] {
    const now = new Date().toISOString();
    const rows = this.db
      .prepare(
        `SELECT * FROM wallet_accounts
         WHERE activation_priority_at IS NOT NULL
           AND activation_status != 'deployed'
           AND (activation_next_check_at IS NULL OR activation_next_check_at <= ?)
         ORDER BY
           CASE WHEN activation_status = 'funded' THEN 0 ELSE 1 END ASC,
           activation_next_check_at ASC,
           activation_priority_at DESC
         LIMIT ?`
      )
      .all(now, Math.max(1, Math.min(limit, 500))) as WalletAccountRow[];
    return rows
      .map(mapWalletAccount)
      .filter((a) => !a.deployedChains.includes(chainId));
  }

  touchWalletActivation(address: string, funded: boolean): WalletAccountRecord | null {
    const account = this.getWalletAccount(address);
    if (!account) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE wallet_accounts
         SET activation_priority_at = ?,
             activation_next_check_at = ?,
             activation_status = CASE WHEN ? THEN 'funded' ELSE activation_status END,
             activation_error = NULL,
             updated_at = ?
         WHERE address = ?`
      )
      .run(now, now, funded ? 1 : 0, now, address.toLowerCase());
    return this.getWalletAccount(address);
  }

  recordWalletActivationCheck(input: {
    address: string;
    funded: boolean;
    deployed?: boolean;
    error?: string;
  }): WalletAccountRecord | null {
    const account = this.getWalletAccount(input.address);
    if (!account) return null;
    const now = new Date();
    const checks = this.walletActivationCheckCount(input.address) + 1;
    const delayMs = input.deployed || input.funded
      ? 0
      : Math.min(24 * 60 * 60_000, Math.max(60_000, 60_000 * 2 ** Math.min(checks - 1, 10)));
    const next = new Date(now.getTime() + delayMs).toISOString();
    const status = input.deployed ? "deployed" : input.funded ? "funded" : input.error ? "error" : "pending";
    this.db
      .prepare(
        `UPDATE wallet_accounts
         SET activation_last_check_at = ?,
             activation_next_check_at = ?,
             activation_check_count = ?,
             activation_status = ?,
             activation_error = ?,
             updated_at = ?
         WHERE address = ?`
      )
      .run(now.toISOString(), next, checks, status, input.error ?? null, now.toISOString(), input.address.toLowerCase());
    return this.getWalletAccount(input.address);
  }

  private walletActivationCheckCount(address: string): number {
    const row = this.db
      .prepare(`SELECT activation_check_count FROM wallet_accounts WHERE address = ?`)
      .get(address.toLowerCase()) as { activation_check_count: number } | undefined;
    return Number(row?.activation_check_count ?? 0);
  }

  markWalletDeployed(address: string, chainId: string): WalletAccountRecord | null {
    const account = this.getWalletAccount(address);
    if (!account) return null;
    if (account.deployedChains.includes(chainId)) return account;
    const deployed = [...account.deployedChains, chainId];
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE wallet_accounts
         SET deployed_chains = ?,
             activation_status = 'deployed',
             activation_error = NULL,
             updated_at = ?
         WHERE address = ?`
      )
      .run(JSON.stringify(deployed), now, address.toLowerCase());
    this.walletPersist("account.deployed", {
      address: address.toLowerCase(),
      chainId,
    });
    return this.getWalletAccount(address);
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
    this.walletPersist("device.registered", {
      walletAddress: input.walletAddress.toLowerCase(),
      chainId: input.chainId,
      ownerQx: input.ownerQx,
      ownerQy: input.ownerQy,
      label: input.label,
      credentialId: input.credentialId,
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
    this.walletPersist("device.removed", {
      walletAddress: walletAddress.toLowerCase(),
      chainId,
      ownerQx,
      ownerQy,
    });
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

  /** Mark pairing complete after existing device addOwner succeeds. */
  consumeWalletPairing(nonce: string): WalletPairingRecord | null {
    const row = this.getWalletPairing(nonce);
    if (!row || row.status !== "approved") return null;
    this.db.prepare(`UPDATE wallet_pairings SET status = 'consumed' WHERE nonce = ?`).run(nonce);
    return this.getWalletPairing(nonce);
  }

  /** Reject or abandon pairing (pending or approved → expired). */
  rejectWalletPairing(nonce: string): WalletPairingRecord | null {
    const row = this.getWalletPairing(nonce);
    if (!row || (row.status !== "pending" && row.status !== "approved")) return null;
    this.db.prepare(`UPDATE wallet_pairings SET status = 'expired' WHERE nonce = ?`).run(nonce);
    return this.getWalletPairing(nonce);
  }

  /** Test helper: backdate expiry so the next get/poll lazy-expires. */
  setWalletPairingExpiresAt(nonce: string, expiresAtIso: string): void {
    this.db.prepare(`UPDATE wallet_pairings SET expires_at = ? WHERE nonce = ?`).run(expiresAtIso, nonce);
  }

  getWalletPairing(nonce: string): WalletPairingRecord | null {
    const row = this.db.prepare(`SELECT * FROM wallet_pairings WHERE nonce = ?`).get(nonce) as
      | WalletPairingRow
      | undefined;
    if (!row) return null;
    const mapped = mapWalletPairing(row);
    if (
      (mapped.status === "pending" || mapped.status === "approved") &&
      new Date(mapped.expiresAt).getTime() < Date.now()
    ) {
      this.db.prepare(`UPDATE wallet_pairings SET status = 'expired' WHERE nonce = ?`).run(nonce);
      return mapWalletPairing({ ...row, status: "expired" });
    }
    return mapped;
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

  upsertWalletEntity(input: {
    walletAddress: string;
    entityId: string;
    label?: string | null;
  }): WalletEntityRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO wallet_entities (wallet_address, entity_id, label, created_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(wallet_address, entity_id) DO UPDATE SET label = COALESCE(excluded.label, wallet_entities.label)`
      )
      .run(input.walletAddress.toLowerCase(), input.entityId, input.label ?? null, now);
    this.walletPersist("entity.registered", {
      walletAddress: input.walletAddress.toLowerCase(),
      entityId: input.entityId,
      label: input.label ?? null,
    });
    return this.getWalletEntity(input.walletAddress, input.entityId)!;
  }

  getWalletEntity(walletAddress: string, entityId: string): WalletEntityRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM wallet_entities WHERE wallet_address = ? AND entity_id = ?`)
      .get(walletAddress.toLowerCase(), entityId) as WalletEntityRow | undefined;
    return row ? mapWalletEntity(row) : null;
  }

  listWalletEntities(walletAddress: string): WalletEntityRecord[] {
    return (
      this.db
        .prepare(`SELECT * FROM wallet_entities WHERE wallet_address = ? ORDER BY created_at ASC`)
        .all(walletAddress.toLowerCase()) as WalletEntityRow[]
    ).map(mapWalletEntity);
  }

  upsertWalletEntityKey(input: {
    walletAddress: string;
    entityId: string;
    keyId: string;
    keyType: number;
    qx?: string | null;
    qy?: string | null;
    eoa?: string | null;
    credentialId?: string | null;
  }): WalletEntityKeyRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO wallet_entity_keys (
           wallet_address, entity_id, key_id, key_type, qx, qy, eoa, credential_id, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(wallet_address, key_id) DO UPDATE SET
           entity_id = excluded.entity_id,
           key_type = excluded.key_type,
           qx = excluded.qx,
           qy = excluded.qy,
           eoa = excluded.eoa,
           credential_id = excluded.credential_id`
      )
      .run(
        input.walletAddress.toLowerCase(),
        input.entityId,
        input.keyId,
        input.keyType,
        input.qx ?? null,
        input.qy ?? null,
        input.eoa ?? null,
        input.credentialId ?? null,
        now
      );
    this.walletPersist("entity_key.registered", {
      walletAddress: input.walletAddress.toLowerCase(),
      entityId: input.entityId,
      keyId: input.keyId,
      keyType: input.keyType,
      qx: input.qx ?? null,
      qy: input.qy ?? null,
      eoa: input.eoa ?? null,
      credentialId: input.credentialId ?? null,
    });
    return this.getWalletEntityKey(input.walletAddress, input.keyId)!;
  }

  getWalletEntityKey(walletAddress: string, keyId: string): WalletEntityKeyRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM wallet_entity_keys WHERE wallet_address = ? AND key_id = ?`)
      .get(walletAddress.toLowerCase(), keyId) as WalletEntityKeyRow | undefined;
    return row ? mapWalletEntityKey(row) : null;
  }

  listWalletEntityKeys(walletAddress: string, entityId?: string): WalletEntityKeyRecord[] {
    if (entityId) {
      return (
        this.db
          .prepare(
            `SELECT * FROM wallet_entity_keys WHERE wallet_address = ? AND entity_id = ? ORDER BY created_at ASC`
          )
          .all(walletAddress.toLowerCase(), entityId) as WalletEntityKeyRow[]
      ).map(mapWalletEntityKey);
    }
    return (
      this.db
        .prepare(`SELECT * FROM wallet_entity_keys WHERE wallet_address = ? ORDER BY created_at ASC`)
        .all(walletAddress.toLowerCase()) as WalletEntityKeyRow[]
    ).map(mapWalletEntityKey);
  }

  createWalletKeyEnrollmentRequest(input: {
    walletAddress: string;
    entityId: string;
    keyType: number;
    qx?: string | null;
    qy?: string | null;
    eoa?: string | null;
    credentialId?: string | null;
    label?: string | null;
    ttlMs?: number;
  }): WalletKeyEnrollmentRequestRecord {
    const now = new Date();
    const id = randomUUID();
    const expiresAt = new Date(now.getTime() + (input.ttlMs ?? 7 * 24 * 60 * 60 * 1000)).toISOString();
    this.db
      .prepare(
        `INSERT INTO wallet_key_enrollment_requests (
           id, wallet_address, entity_id, key_type, qx, qy, eoa, credential_id, label,
           status, expires_at, created_at, resolved_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, NULL)`
      )
      .run(
        id,
        input.walletAddress.toLowerCase(),
        input.entityId,
        input.keyType,
        input.qx ?? null,
        input.qy ?? null,
        input.eoa ?? null,
        input.credentialId ?? null,
        input.label ?? null,
        expiresAt,
        now.toISOString()
      );
    return this.getWalletKeyEnrollmentRequest(id)!;
  }

  getWalletKeyEnrollmentRequest(id: string): WalletKeyEnrollmentRequestRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM wallet_key_enrollment_requests WHERE id = ?`)
      .get(id) as WalletKeyEnrollmentRequestRow | undefined;
    if (!row) return null;
    const mapped = mapWalletKeyEnrollmentRequest(row);
    if (mapped.status === "pending" && Date.parse(mapped.expiresAt) < Date.now()) {
      this.db
        .prepare(
          `UPDATE wallet_key_enrollment_requests SET status = 'expired', resolved_at = ? WHERE id = ?`
        )
        .run(new Date().toISOString(), id);
      return { ...mapped, status: "expired", resolvedAt: new Date().toISOString() };
    }
    return mapped;
  }

  listWalletKeyEnrollmentRequests(
    walletAddress: string,
    status?: WalletKeyEnrollmentStatus
  ): WalletKeyEnrollmentRequestRecord[] {
    const rows = status
      ? (this.db
          .prepare(
            `SELECT * FROM wallet_key_enrollment_requests WHERE wallet_address = ? AND status = ? ORDER BY created_at ASC`
          )
          .all(walletAddress.toLowerCase(), status) as WalletKeyEnrollmentRequestRow[])
      : (this.db
          .prepare(
            `SELECT * FROM wallet_key_enrollment_requests WHERE wallet_address = ? ORDER BY created_at DESC`
          )
          .all(walletAddress.toLowerCase()) as WalletKeyEnrollmentRequestRow[]);
    return rows.map(mapWalletKeyEnrollmentRequest).map((r) => {
      if (r.status === "pending" && Date.parse(r.expiresAt) < Date.now()) {
        this.db
          .prepare(
            `UPDATE wallet_key_enrollment_requests SET status = 'expired', resolved_at = ? WHERE id = ?`
          )
          .run(new Date().toISOString(), r.id);
        return { ...r, status: "expired" as const, resolvedAt: new Date().toISOString() };
      }
      return r;
    });
  }

  resolveWalletKeyEnrollmentRequest(
    id: string,
    status: "approved" | "rejected"
  ): WalletKeyEnrollmentRequestRecord | null {
    const existing = this.getWalletKeyEnrollmentRequest(id);
    if (!existing || existing.status !== "pending") return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE wallet_key_enrollment_requests SET status = ?, resolved_at = ? WHERE id = ?`
      )
      .run(status, now, id);
    return this.getWalletKeyEnrollmentRequest(id);
  }

  createWalletProposal(input: {
    walletAddress: string;
    chainId: string;
    target: string;
    value: string;
    data: string;
  }): WalletProposalRecord {
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO wallet_proposals (
           id, wallet_address, chain_id, target, value, data, nonce, status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, NULL, 'draft', ?, ?)`
      )
      .run(
        id,
        input.walletAddress.toLowerCase(),
        input.chainId,
        input.target.toLowerCase(),
        input.value,
        input.data,
        now,
        now
      );
    return this.getWalletProposal(id)!;
  }

  prepareWalletProposal(id: string, nonce: string): WalletProposalRecord | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE wallet_proposals SET nonce = ?, status = 'signing', updated_at = ?
         WHERE id = ? AND status IN ('draft', 'signing')`
      )
      .run(nonce, now, id);
    if (result.changes === 0) return null;
    return this.getWalletProposal(id);
  }

  getWalletProposal(id: string): WalletProposalRecord | null {
    const row = this.db.prepare(`SELECT * FROM wallet_proposals WHERE id = ?`).get(id) as
      | WalletProposalRow
      | undefined;
    return row ? mapWalletProposal(row) : null;
  }

  listWalletProposals(walletAddress: string, status?: WalletProposalStatus): WalletProposalRecord[] {
    if (status) {
      return (
        this.db
          .prepare(
            `SELECT * FROM wallet_proposals WHERE wallet_address = ? AND status = ? ORDER BY created_at DESC`
          )
          .all(walletAddress.toLowerCase(), status) as WalletProposalRow[]
      ).map(mapWalletProposal);
    }
    return (
      this.db
        .prepare(`SELECT * FROM wallet_proposals WHERE wallet_address = ? ORDER BY created_at DESC`)
        .all(walletAddress.toLowerCase()) as WalletProposalRow[]
    ).map(mapWalletProposal);
  }

  updateWalletProposalStatus(id: string, status: WalletProposalStatus): WalletProposalRecord | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(`UPDATE wallet_proposals SET status = ?, updated_at = ? WHERE id = ?`)
      .run(status, now, id);
    if (result.changes === 0) return null;
    return this.getWalletProposal(id);
  }

  addWalletProposalSig(input: {
    proposalId: string;
    entityId: string;
    keyId: string;
    keyType: number;
    signature: string;
  }): WalletProposalSigRecord {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO wallet_proposal_sigs (proposal_id, entity_id, key_id, key_type, signature, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(proposal_id, entity_id) DO UPDATE SET
           key_id = excluded.key_id,
           key_type = excluded.key_type,
           signature = excluded.signature,
           created_at = excluded.created_at`
      )
      .run(input.proposalId, input.entityId, input.keyId, input.keyType, input.signature, now);
    return this.getWalletProposalSig(input.proposalId, input.entityId)!;
  }

  getWalletProposalSig(proposalId: string, entityId: string): WalletProposalSigRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM wallet_proposal_sigs WHERE proposal_id = ? AND entity_id = ?`)
      .get(proposalId, entityId) as WalletProposalSigRow | undefined;
    return row ? mapWalletProposalSig(row) : null;
  }

  listWalletProposalSigs(proposalId: string): WalletProposalSigRecord[] {
    return (
      this.db
        .prepare(`SELECT * FROM wallet_proposal_sigs WHERE proposal_id = ? ORDER BY created_at ASC`)
        .all(proposalId) as WalletProposalSigRow[]
    ).map(mapWalletProposalSig);
  }

  /**
   * Same UserOp hash can be retried after reject/fail (e.g. AA21 then fixed bundler).
   * Resets to pending with a fresh signature payload.
   */
  requeueWalletUserOp(input: {
    userOpHash: string;
    userOp: PackedUserOperationJson;
    walletAddress: string;
    chainId: string;
  }): WalletUserOpRecord | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE wallet_user_ops SET
           wallet_address = ?,
           chain_id = ?,
           user_op_json = ?,
           status = 'pending',
           claimed_by = NULL,
           claimed_until = NULL,
           tx_hash = NULL,
           reject_reason = NULL,
           gas_spent_wei = NULL,
           version = version + 1,
           updated_at = ?
         WHERE user_op_hash = ?
           AND status IN ('rejected', 'failed')`
      )
      .run(
        input.walletAddress.toLowerCase(),
        input.chainId,
        JSON.stringify(input.userOp),
        now,
        input.userOpHash.toLowerCase()
      );
    if (result.changes === 0) return null;
    return this.getWalletUserOpByHash(input.userOpHash);
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

  // --- Wallet HMAC clients ---

  createWalletClient(input: {
    label: string;
    rpId: string;
    origins?: string[] | null;
    hmacSecret: string;
    enabled?: boolean;
  }): WalletClientRecord & { hmacSecret: string } {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO wallet_clients (id, label, rp_id, origins, hmac_secret, enabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.label,
        input.rpId.trim().toLowerCase(),
        input.origins?.length ? JSON.stringify(input.origins) : null,
        input.hmacSecret,
        input.enabled === false ? 0 : 1,
        now,
        now
      );
    const client = this.getWalletClient(id)!;
    return { ...client, hmacSecret: input.hmacSecret };
  }

  listWalletClients(): WalletClientRecord[] {
    const rows = this.db
      .prepare(`SELECT id, label, rp_id, origins, enabled, created_at, updated_at FROM wallet_clients ORDER BY created_at ASC`)
      .all() as WalletClientRowPublic[];
    return rows.map(mapWalletClientPublic);
  }

  getWalletClient(id: string): WalletClientRecord | null {
    const row = this.db
      .prepare(
        `SELECT id, label, rp_id, origins, enabled, created_at, updated_at FROM wallet_clients WHERE id = ?`
      )
      .get(id) as WalletClientRowPublic | undefined;
    return row ? mapWalletClientPublic(row) : null;
  }

  getWalletClientSecret(id: string): (WalletClientRecord & { hmacSecret: string }) | null {
    const row = this.db.prepare(`SELECT * FROM wallet_clients WHERE id = ?`).get(id) as
      | WalletClientRow
      | undefined;
    if (!row) return null;
    return {
      ...mapWalletClientPublic(row),
      hmacSecret: row.hmac_secret,
    };
  }

  updateWalletClient(
    id: string,
    patch: { enabled?: boolean; label?: string; rpId?: string; origins?: string[] | null }
  ): WalletClientRecord | null {
    const current = this.getWalletClient(id);
    if (!current) return null;
    const now = new Date().toISOString();
    const enabled = patch.enabled === undefined ? (current.enabled ? 1 : 0) : patch.enabled ? 1 : 0;
    const label = patch.label ?? current.label;
    const rpId = patch.rpId?.trim().toLowerCase() ?? current.rpId;
    const origins =
      patch.origins === undefined
        ? current.origins?.length
          ? JSON.stringify(current.origins)
          : null
        : patch.origins?.length
          ? JSON.stringify(patch.origins)
          : null;
    this.db
      .prepare(
        `UPDATE wallet_clients SET label = ?, rp_id = ?, origins = ?, enabled = ?, updated_at = ? WHERE id = ?`
      )
      .run(label, rpId, origins, enabled, now, id);
    return this.getWalletClient(id);
  }

  rotateWalletClientSecret(id: string, hmacSecret: string): (WalletClientRecord & { hmacSecret: string }) | null {
    const current = this.getWalletClient(id);
    if (!current) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(`UPDATE wallet_clients SET hmac_secret = ?, updated_at = ? WHERE id = ?`)
      .run(hmacSecret, now, id);
    return { ...this.getWalletClient(id)!, hmacSecret };
  }

  touchWalletClient(id: string): void {
    this.db
      .prepare(`UPDATE wallet_clients SET last_seen_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), id);
  }

  consumeWalletClientNonce(clientId: string, nonce: string, ttlMs: number): boolean {
    const now = Date.now();
    this.db.prepare("DELETE FROM wallet_client_nonces WHERE expires_at < ?").run(now);
    try {
      this.db
        .prepare("INSERT INTO wallet_client_nonces (client_id, nonce, expires_at) VALUES (?, ?, ?)")
        .run(clientId, nonce, now + ttlMs);
      return true;
    } catch {
      return false;
    }
  }

  upsertWalletIdentity(input: {
    clientId: string;
    email: string;
    walletAddress: string;
    contactJson?: string | null;
  }): WalletIdentityRecord {
    const now = new Date().toISOString();
    const email = normalizeEmail(input.email);
    const addr = input.walletAddress.toLowerCase();
    this.db
      .prepare(
        `INSERT INTO wallet_identities (client_id, email, wallet_address, contact_json, created_at, updated_at)
         VALUES (@clientId, @email, @walletAddress, @contactJson, @now, @now)
         ON CONFLICT(client_id, email, wallet_address) DO UPDATE SET
           contact_json = COALESCE(excluded.contact_json, contact_json),
           updated_at = @now`
      )
      .run({
        clientId: input.clientId,
        email,
        walletAddress: addr,
        contactJson: input.contactJson ?? null,
        now,
      });
    return this.getWalletIdentity(input.clientId, email, addr)!;
  }

  getWalletIdentity(clientId: string, email: string, walletAddress: string): WalletIdentityRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM wallet_identities WHERE client_id = ? AND email = ? AND wallet_address = ?`
      )
      .get(clientId, normalizeEmail(email), walletAddress.toLowerCase()) as WalletIdentityRow | undefined;
    return row ? mapWalletIdentity(row) : null;
  }

  listWalletIdentities(clientId: string, email: string): WalletIdentityRecord[] {
    const rows = this.db
      .prepare(
        `SELECT * FROM wallet_identities WHERE client_id = ? AND email = ? ORDER BY created_at ASC`
      )
      .all(clientId, normalizeEmail(email)) as WalletIdentityRow[];
    return rows.map(mapWalletIdentity);
  }

  clientOwnsWallet(clientId: string, walletAddress: string): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 AS ok FROM wallet_identities WHERE client_id = ? AND wallet_address = ? LIMIT 1`
      )
      .get(clientId, walletAddress.toLowerCase()) as { ok: number } | undefined;
    return Boolean(row);
  }

  clientOwnsWalletForEmail(clientId: string, email: string, walletAddress: string): boolean {
    return this.getWalletIdentity(clientId, email, walletAddress) != null;
  }

  createWalletChallenge(input: {
    clientId: string;
    purpose: WalletChallengePurpose;
    challenge: string;
    email?: string | null;
    walletAddress?: string | null;
    ttlMs?: number;
  }): WalletChallengeRecord {
    const id = randomUUID();
    const now = Date.now();
    const ttl = input.ttlMs ?? 5 * 60 * 1000;
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttl).toISOString();
    this.db
      .prepare(
        `INSERT INTO wallet_challenges (
           id, client_id, purpose, challenge, email, wallet_address, consumed, expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        id,
        input.clientId,
        input.purpose,
        input.challenge,
        input.email ? normalizeEmail(input.email) : null,
        input.walletAddress?.toLowerCase() ?? null,
        expiresAt,
        createdAt
      );
    return this.getWalletChallenge(id)!;
  }

  getWalletChallenge(id: string): WalletChallengeRecord | null {
    const row = this.db.prepare(`SELECT * FROM wallet_challenges WHERE id = ?`).get(id) as
      | WalletChallengeRow
      | undefined;
    return row ? mapWalletChallenge(row) : null;
  }

  /** Consume a challenge if valid for client/purpose and not expired. Returns null on failure. */
  consumeWalletChallenge(input: {
    id: string;
    clientId: string;
    purpose: WalletChallengePurpose;
  }): WalletChallengeRecord | null {
    const row = this.getWalletChallenge(input.id);
    if (!row) return null;
    if (row.clientId !== input.clientId || row.purpose !== input.purpose) return null;
    if (row.consumed) return null;
    if (new Date(row.expiresAt).getTime() < Date.now()) return null;
    const result = this.db
      .prepare(`UPDATE wallet_challenges SET consumed = 1 WHERE id = ? AND consumed = 0`)
      .run(input.id);
    if (result.changes === 0) return null;
    return this.getWalletChallenge(input.id);
  }

  createWalletRecoveryJob(input: {
    walletAddress: string;
    chainId: string;
    kind: WalletRecoveryJobKind;
    newQx?: string | null;
    newQy?: string | null;
    cancelSignature?: string | null;
  }): WalletRecoveryJobRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO wallet_recovery_jobs (
           id, wallet_address, chain_id, kind, new_qx, new_qy, cancel_signature,
           status, version, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?, ?)`
      )
      .run(
        id,
        input.walletAddress.toLowerCase(),
        input.chainId,
        input.kind,
        input.newQx ?? null,
        input.newQy ?? null,
        input.cancelSignature ?? null,
        now,
        now
      );
    return this.getWalletRecoveryJob(id)!;
  }

  getWalletRecoveryJob(id: string): WalletRecoveryJobRecord | null {
    const row = this.db.prepare(`SELECT * FROM wallet_recovery_jobs WHERE id = ?`).get(id) as
      | WalletRecoveryJobRow
      | undefined;
    return row ? mapWalletRecoveryJob(row) : null;
  }

  listWalletRecoveryJobs(
    statuses: WalletRecoveryJobStatus[] = ["pending"],
    chains?: string[]
  ): WalletRecoveryJobRecord[] {
    let sql = `SELECT * FROM wallet_recovery_jobs WHERE status IN (${statuses.map(() => "?").join(",")})`;
    const params: unknown[] = [...statuses];
    if (chains?.length) {
      sql += ` AND chain_id IN (${chains.map(() => "?").join(",")})`;
      params.push(...chains);
    }
    sql += " ORDER BY created_at ASC LIMIT 100";
    return (this.db.prepare(sql).all(...params) as WalletRecoveryJobRow[]).map(mapWalletRecoveryJob);
  }

  listWalletRecoveryJobsForWallet(walletAddress: string): WalletRecoveryJobRecord[] {
    return (
      this.db
        .prepare(
          `SELECT * FROM wallet_recovery_jobs WHERE wallet_address = ? ORDER BY created_at DESC LIMIT 20`
        )
        .all(walletAddress.toLowerCase()) as WalletRecoveryJobRow[]
    ).map(mapWalletRecoveryJob);
  }

  claimWalletRecoveryJob(input: {
    id: string;
    workerId: string;
    expectedVersion: number;
    leaseMs: number;
  }): WalletRecoveryJobRecord {
    const now = new Date();
    const until = new Date(now.getTime() + input.leaseMs).toISOString();
    const nowIso = now.toISOString();
    const result = this.db
      .prepare(
        `UPDATE wallet_recovery_jobs SET
           claimed_by = @worker,
           claimed_until = @until,
           status = 'claimed',
           version = version + 1,
           updated_at = @now
         WHERE id = @id
           AND version = @version
           AND status IN ('pending', 'claimed')
           AND (claimed_by IS NULL OR claimed_by = @worker OR claimed_until < @now)`
      )
      .run({
        worker: input.workerId.toLowerCase(),
        until,
        now: nowIso,
        id: input.id,
        version: input.expectedVersion,
      });
    if (result.changes === 0) {
      const current = this.getWalletRecoveryJob(input.id);
      throw Object.assign(new Error("Recovery job claim conflict"), { statusCode: 409, job: current });
    }
    return this.getWalletRecoveryJob(input.id)!;
  }

  trackWalletRecoveryJob(input: {
    id: string;
    status?: WalletRecoveryJobStatus;
    txHash?: string | null;
    error?: string | null;
    expectedVersion?: number;
    workerId?: string;
  }): WalletRecoveryJobRecord {
    const current = this.getWalletRecoveryJob(input.id);
    if (!current) throw Object.assign(new Error("Recovery job not found"), { statusCode: 404 });
    if (input.expectedVersion !== undefined && current.version !== input.expectedVersion) {
      throw Object.assign(new Error("Recovery job version conflict"), { statusCode: 409, job: current });
    }
    if (input.workerId && current.claimedBy && current.claimedBy !== input.workerId.toLowerCase()) {
      throw Object.assign(new Error("Recovery job claimed by another worker"), {
        statusCode: 409,
        job: current,
      });
    }
    const now = new Date().toISOString();
    const terminal =
      input.status === "included" || input.status === "failed" || input.status === "rejected";
    const requeue = input.status === "pending";
    this.db
      .prepare(
        `UPDATE wallet_recovery_jobs SET
           status = COALESCE(@status, status),
           tx_hash = COALESCE(@txHash, tx_hash),
           error = COALESCE(@error, error),
           version = version + 1,
           claimed_by = CASE WHEN @clearClaim = 1 THEN NULL ELSE claimed_by END,
           claimed_until = CASE WHEN @clearClaim = 1 THEN NULL ELSE claimed_until END,
           updated_at = @now
         WHERE id = @id`
      )
      .run({
        status: input.status ?? null,
        txHash: input.txHash ?? null,
        error: input.error ?? null,
        clearClaim: terminal || requeue ? 1 : 0,
        now,
        id: input.id,
      });
    if (terminal && input.status) {
      const updated = this.getWalletRecoveryJob(input.id)!;
      this.walletPersist("recovery.job_status", {
        jobId: updated.id,
        walletAddress: updated.walletAddress,
        chainId: updated.chainId,
        kind: updated.kind,
        status: updated.status,
        txHash: updated.txHash,
      });
    }
    return this.getWalletRecoveryJob(input.id)!;
  }

  // --- Hosted email + recovery requests ---

  upsertWalletEmail(input: {
    walletAddress: string;
    email: string;
    verifiedAt?: string | null;
  }): WalletEmailRecord {
    const now = new Date().toISOString();
    const addr = input.walletAddress.toLowerCase();
    const email = normalizeEmail(input.email);
    const verifiedAt = input.verifiedAt === undefined ? null : input.verifiedAt;
    this.db
      .prepare(
        `INSERT INTO wallet_emails (wallet_address, email, verified_at, created_at, updated_at)
         VALUES (@addr, @email, @verifiedAt, @now, @now)
         ON CONFLICT(wallet_address) DO UPDATE SET
           email = @email,
           verified_at = CASE
             WHEN @verifiedAt IS NOT NULL THEN @verifiedAt
             WHEN excluded.email != wallet_emails.email THEN NULL
             ELSE wallet_emails.verified_at
           END,
           updated_at = @now`
      )
      .run({ addr, email, verifiedAt, now });
    if (verifiedAt) {
      this.walletPersist("email.verified", {
        walletAddress: addr,
        email,
        verifiedAt,
      });
    }
    return this.getWalletEmail(addr)!;
  }

  getWalletEmail(walletAddress: string): WalletEmailRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM wallet_emails WHERE wallet_address = ?`)
      .get(walletAddress.toLowerCase()) as WalletEmailRow | undefined;
    return row ? mapWalletEmail(row) : null;
  }

  findWalletByVerifiedEmail(email: string): WalletEmailRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM wallet_emails WHERE email = ? AND verified_at IS NOT NULL ORDER BY updated_at DESC LIMIT 1`
      )
      .get(normalizeEmail(email)) as WalletEmailRow | undefined;
    return row ? mapWalletEmail(row) : null;
  }

  markWalletEmailVerified(walletAddress: string, email: string): WalletEmailRecord | null {
    const now = new Date().toISOString();
    const result = this.db
      .prepare(
        `UPDATE wallet_emails SET verified_at = ?, email = ?, updated_at = ?
         WHERE wallet_address = ?`
      )
      .run(now, normalizeEmail(email), now, walletAddress.toLowerCase());
    if (result.changes === 0) {
      this.upsertWalletEmail({ walletAddress, email, verifiedAt: now });
    } else {
      this.walletPersist("email.verified", {
        walletAddress: walletAddress.toLowerCase(),
        email: normalizeEmail(email),
        verifiedAt: now,
      });
    }
    return this.getWalletEmail(walletAddress);
  }

  createWalletEmailOtp(input: {
    walletAddress: string;
    email: string;
    purpose: WalletEmailOtpPurpose;
    codeHash: string;
    ttlMs?: number;
  }): { id: string; expiresAt: string } {
    const id = randomUUID();
    const now = Date.now();
    const ttl = input.ttlMs ?? 10 * 60 * 1000;
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttl).toISOString();
    // Invalidate prior OTPs for same wallet+purpose
    this.db
      .prepare(
        `UPDATE wallet_email_otps SET consumed_at = ? WHERE wallet_address = ? AND purpose = ? AND consumed_at IS NULL`
      )
      .run(createdAt, input.walletAddress.toLowerCase(), input.purpose);
    this.db
      .prepare(
        `INSERT INTO wallet_email_otps (
           id, wallet_address, email, purpose, code_hash, attempts, expires_at, created_at
         ) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        id,
        input.walletAddress.toLowerCase(),
        normalizeEmail(input.email),
        input.purpose,
        input.codeHash,
        expiresAt,
        createdAt
      );
    return { id, expiresAt };
  }

  /** Verify OTP; returns false on mismatch/expiry/too many attempts. */
  consumeWalletEmailOtp(input: {
    walletAddress: string;
    email: string;
    purpose: WalletEmailOtpPurpose;
    codeHash: string;
    maxAttempts?: number;
  }): boolean {
    const row = this.db
      .prepare(
        `SELECT * FROM wallet_email_otps
         WHERE wallet_address = ? AND email = ? AND purpose = ? AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(
        input.walletAddress.toLowerCase(),
        normalizeEmail(input.email),
        input.purpose
      ) as WalletEmailOtpRow | undefined;
    if (!row) return false;
    if (new Date(row.expires_at).getTime() < Date.now()) return false;
    const max = input.maxAttempts ?? 5;
    if (row.attempts >= max) return false;
    this.db
      .prepare(`UPDATE wallet_email_otps SET attempts = attempts + 1 WHERE id = ?`)
      .run(row.id);
    if (row.code_hash !== input.codeHash) return false;
    this.db
      .prepare(`UPDATE wallet_email_otps SET consumed_at = ? WHERE id = ?`)
      .run(new Date().toISOString(), row.id);
    return true;
  }

  /** Test helper: peek latest unconsumed OTP hash (not the plaintext code). */
  getLatestWalletEmailOtp(
    walletAddress: string,
    purpose: WalletEmailOtpPurpose
  ): { id: string; codeHash: string; email: string } | null {
    const row = this.db
      .prepare(
        `SELECT * FROM wallet_email_otps
         WHERE wallet_address = ? AND purpose = ? AND consumed_at IS NULL
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(walletAddress.toLowerCase(), purpose) as WalletEmailOtpRow | undefined;
    if (!row) return null;
    return { id: row.id, codeHash: row.code_hash, email: row.email };
  }

  createHostedRecoveryChallenge(input: {
    purpose: HostedRecoveryChallengePurpose;
    challenge: string;
    walletAddress?: string | null;
    ttlMs?: number;
  }): HostedRecoveryChallengeRecord {
    const id = randomUUID();
    const now = Date.now();
    const ttl = input.ttlMs ?? 5 * 60 * 1000;
    const createdAt = new Date(now).toISOString();
    const expiresAt = new Date(now + ttl).toISOString();
    this.db
      .prepare(
        `INSERT INTO wallet_hosted_challenges (
           id, purpose, challenge, wallet_address, consumed, expires_at, created_at
         ) VALUES (?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        id,
        input.purpose,
        input.challenge,
        input.walletAddress?.toLowerCase() ?? null,
        expiresAt,
        createdAt
      );
    return this.getHostedRecoveryChallenge(id)!;
  }

  getHostedRecoveryChallenge(id: string): HostedRecoveryChallengeRecord | null {
    const row = this.db.prepare(`SELECT * FROM wallet_hosted_challenges WHERE id = ?`).get(id) as
      | HostedChallengeRow
      | undefined;
    return row ? mapHostedChallenge(row) : null;
  }

  consumeHostedRecoveryChallenge(input: {
    id: string;
    purpose: HostedRecoveryChallengePurpose;
  }): HostedRecoveryChallengeRecord | null {
    const row = this.getHostedRecoveryChallenge(input.id);
    if (!row || row.purpose !== input.purpose || row.consumed) return null;
    if (new Date(row.expiresAt).getTime() < Date.now()) return null;
    const result = this.db
      .prepare(`UPDATE wallet_hosted_challenges SET consumed = 1 WHERE id = ? AND consumed = 0`)
      .run(input.id);
    if (result.changes === 0) return null;
    return this.getHostedRecoveryChallenge(input.id);
  }

  createWalletRecoveryRequest(input: {
    walletAddress: string;
    email: string;
    newQx: string;
    newQy: string;
    credentialId: string;
    deviceLabel?: string | null;
    status: WalletRecoveryRequestStatus;
    emailVerifiedAt?: string | null;
    captchaOkAt?: string | null;
    chainId: string;
  }): WalletRecoveryRequestRecord {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO wallet_recovery_requests (
           id, wallet_address, email, new_qx, new_qy, credential_id, device_label,
           status, email_verified_at, captcha_ok_at, chain_id, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        input.walletAddress.toLowerCase(),
        normalizeEmail(input.email),
        input.newQx,
        input.newQy,
        input.credentialId,
        input.deviceLabel ?? null,
        input.status,
        input.emailVerifiedAt ?? null,
        input.captchaOkAt ?? null,
        input.chainId,
        now,
        now
      );
    return this.getWalletRecoveryRequest(id)!;
  }

  getWalletRecoveryRequest(id: string): WalletRecoveryRequestRecord | null {
    const row = this.db.prepare(`SELECT * FROM wallet_recovery_requests WHERE id = ?`).get(id) as
      | WalletRecoveryRequestRow
      | undefined;
    return row ? mapWalletRecoveryRequest(row) : null;
  }

  getActiveWalletRecoveryRequest(walletAddress: string): WalletRecoveryRequestRecord | null {
    const row = this.db
      .prepare(
        `SELECT * FROM wallet_recovery_requests
         WHERE wallet_address = ?
           AND status IN ('awaiting_email','awaiting_guardian','queued','on_chain')
         ORDER BY created_at DESC LIMIT 1`
      )
      .get(walletAddress.toLowerCase()) as WalletRecoveryRequestRow | undefined;
    return row ? mapWalletRecoveryRequest(row) : null;
  }

  listWalletRecoveryRequests(
    statuses?: WalletRecoveryRequestStatus[]
  ): WalletRecoveryRequestRecord[] {
    if (!statuses?.length) {
      return (
        this.db
          .prepare(`SELECT * FROM wallet_recovery_requests ORDER BY created_at DESC LIMIT 200`)
          .all() as WalletRecoveryRequestRow[]
      ).map(mapWalletRecoveryRequest);
    }
    const sql = `SELECT * FROM wallet_recovery_requests WHERE status IN (${statuses
      .map(() => "?")
      .join(",")}) ORDER BY created_at DESC LIMIT 200`;
    return (this.db.prepare(sql).all(...statuses) as WalletRecoveryRequestRow[]).map(
      mapWalletRecoveryRequest
    );
  }

  updateWalletRecoveryRequest(
    id: string,
    patch: {
      status?: WalletRecoveryRequestStatus;
      emailVerifiedAt?: string | null;
      guardianAddress?: string | null;
      guardianActedAt?: string | null;
      jobId?: string | null;
    }
  ): WalletRecoveryRequestRecord | null {
    const current = this.getWalletRecoveryRequest(id);
    if (!current) return null;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `UPDATE wallet_recovery_requests SET
           status = COALESCE(@status, status),
           email_verified_at = COALESCE(@emailVerifiedAt, email_verified_at),
           guardian_address = COALESCE(@guardianAddress, guardian_address),
           guardian_acted_at = COALESCE(@guardianActedAt, guardian_acted_at),
           job_id = COALESCE(@jobId, job_id),
           updated_at = @now
         WHERE id = @id`
      )
      .run({
        status: patch.status ?? null,
        emailVerifiedAt: patch.emailVerifiedAt ?? null,
        guardianAddress: patch.guardianAddress ?? null,
        guardianActedAt: patch.guardianActedAt ?? null,
        jobId: patch.jobId ?? null,
        now,
        id,
      });
    return this.getWalletRecoveryRequest(id);
  }

  getWalletRecoveryRequestByJobId(jobId: string): WalletRecoveryRequestRecord | null {
    const row = this.db
      .prepare(`SELECT * FROM wallet_recovery_requests WHERE job_id = ?`)
      .get(jobId) as WalletRecoveryRequestRow | undefined;
    return row ? mapWalletRecoveryRequest(row) : null;
  }

  consumeGuardianNonce(address: string, nonce: string, ttlMs: number): boolean {
    const now = Date.now();
    this.db.prepare("DELETE FROM guardian_nonces WHERE expires_at < ?").run(now);
    try {
      this.db
        .prepare("INSERT INTO guardian_nonces (address, nonce, expires_at) VALUES (?, ?, ?)")
        .run(address.toLowerCase(), nonce, now + ttlMs);
      return true;
    } catch {
      return false;
    }
  }

  /** One-time consume of an issued guardian login nonce. */
  takeGuardianNonce(address: string, nonce: string): boolean {
    const now = Date.now();
    this.db.prepare("DELETE FROM guardian_nonces WHERE expires_at < ?").run(now);
    const result = this.db
      .prepare(`DELETE FROM guardian_nonces WHERE address = ? AND nonce = ?`)
      .run(address.toLowerCase(), nonce);
    return result.changes > 0;
  }

  createGuardianSession(input: {
    tokenHash: string;
    address: string;
    ttlMs?: number;
  }): void {
    const now = Date.now();
    const ttl = input.ttlMs ?? 12 * 60 * 60 * 1000;
    this.db
      .prepare(
        `INSERT INTO guardian_sessions (token_hash, address, expires_at, created_at)
         VALUES (?, ?, ?, ?)`
      )
      .run(
        input.tokenHash,
        input.address.toLowerCase(),
        new Date(now + ttl).toISOString(),
        new Date(now).toISOString()
      );
  }

  getGuardianSession(tokenHash: string): { address: string } | null {
    const row = this.db
      .prepare(`SELECT * FROM guardian_sessions WHERE token_hash = ?`)
      .get(tokenHash) as { address: string; expires_at: string } | undefined;
    if (!row) return null;
    if (new Date(row.expires_at).getTime() < Date.now()) {
      this.db.prepare(`DELETE FROM guardian_sessions WHERE token_hash = ?`).run(tokenHash);
      return null;
    }
    return { address: row.address };
  }

  deleteGuardianSession(tokenHash: string): void {
    this.db.prepare(`DELETE FROM guardian_sessions WHERE token_hash = ?`).run(tokenHash);
  }

  private ensureColumn(table: string, column: string, definition: string): void {
    const cols = this.db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

interface WalletClientRow {
  id: string;
  label: string;
  rp_id: string;
  origins: string | null;
  hmac_secret: string;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
  last_seen_at: string | null;
}

interface WalletClientRowPublic {
  id: string;
  label: string;
  rp_id: string;
  origins: string | null;
  enabled: 0 | 1;
  created_at: string;
  updated_at: string;
}

interface WalletIdentityRow {
  client_id: string;
  email: string;
  wallet_address: string;
  contact_json: string | null;
  created_at: string;
  updated_at: string;
}

interface WalletChallengeRow {
  id: string;
  client_id: string;
  purpose: WalletChallengePurpose;
  challenge: string;
  email: string | null;
  wallet_address: string | null;
  consumed: 0 | 1;
  expires_at: string;
  created_at: string;
}

interface WalletRecoveryJobRow {
  id: string;
  wallet_address: string;
  chain_id: string;
  kind: WalletRecoveryJobKind;
  new_qx: string | null;
  new_qy: string | null;
  cancel_signature: string | null;
  status: WalletRecoveryJobStatus;
  claimed_by: string | null;
  claimed_until: string | null;
  version: number;
  tx_hash: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function mapWalletClientPublic(row: WalletClientRowPublic): WalletClientRecord {
  return {
    id: row.id,
    label: row.label,
    rpId: row.rp_id,
    origins: row.origins ? (JSON.parse(row.origins) as string[]) : null,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWalletIdentity(row: WalletIdentityRow): WalletIdentityRecord {
  return {
    clientId: row.client_id,
    email: row.email,
    walletAddress: row.wallet_address,
    contactJson: row.contact_json,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWalletChallenge(row: WalletChallengeRow): WalletChallengeRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    purpose: row.purpose,
    challenge: row.challenge,
    email: row.email,
    walletAddress: row.wallet_address,
    consumed: row.consumed === 1,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function mapWalletRecoveryJob(row: WalletRecoveryJobRow): WalletRecoveryJobRecord {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    chainId: row.chain_id,
    kind: row.kind,
    newQx: row.new_qx,
    newQy: row.new_qy,
    cancelSignature: row.cancel_signature,
    status: row.status,
    claimedBy: row.claimed_by,
    claimedUntil: row.claimed_until,
    version: row.version,
    txHash: row.tx_hash,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface WalletEmailRow {
  wallet_address: string;
  email: string;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
}

interface WalletEmailOtpRow {
  id: string;
  wallet_address: string;
  email: string;
  purpose: WalletEmailOtpPurpose;
  code_hash: string;
  attempts: number;
  expires_at: string;
  consumed_at: string | null;
  created_at: string;
}

interface HostedChallengeRow {
  id: string;
  purpose: HostedRecoveryChallengePurpose;
  challenge: string;
  wallet_address: string | null;
  consumed: 0 | 1;
  expires_at: string;
  created_at: string;
}

interface WalletRecoveryRequestRow {
  id: string;
  wallet_address: string;
  email: string;
  new_qx: string;
  new_qy: string;
  credential_id: string;
  device_label: string | null;
  status: WalletRecoveryRequestStatus;
  email_verified_at: string | null;
  captcha_ok_at: string | null;
  guardian_address: string | null;
  guardian_acted_at: string | null;
  job_id: string | null;
  chain_id: string;
  created_at: string;
  updated_at: string;
}

function mapWalletEmail(row: WalletEmailRow): WalletEmailRecord {
  return {
    walletAddress: row.wallet_address,
    email: row.email,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapHostedChallenge(row: HostedChallengeRow): HostedRecoveryChallengeRecord {
  return {
    id: row.id,
    purpose: row.purpose,
    challenge: row.challenge,
    walletAddress: row.wallet_address,
    consumed: row.consumed === 1,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function mapWalletRecoveryRequest(row: WalletRecoveryRequestRow): WalletRecoveryRequestRecord {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    email: row.email,
    newQx: row.new_qx,
    newQy: row.new_qy,
    credentialId: row.credential_id,
    deviceLabel: row.device_label,
    status: row.status,
    emailVerifiedAt: row.email_verified_at,
    captchaOkAt: row.captcha_ok_at,
    guardianAddress: row.guardian_address,
    guardianActedAt: row.guardian_acted_at,
    jobId: row.job_id,
    chainId: row.chain_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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

function mapWalletAccount(row: WalletAccountRow): WalletAccountRecord {
  let deployedChains: string[] = [];
  try {
    deployedChains = JSON.parse(row.deployed_chains) as string[];
  } catch {
    deployedChains = [];
  }
  return {
    address: row.address,
    salt: row.salt,
    ownerQx: row.owner_qx,
    ownerQy: row.owner_qy,
    credentialId: row.credential_id,
    webauthnAttestation: row.webauthn_attestation,
    deployedChains,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

function mapWalletEntity(row: WalletEntityRow): WalletEntityRecord {
  return {
    walletAddress: row.wallet_address,
    entityId: row.entity_id,
    label: row.label,
    createdAt: row.created_at,
  };
}

function mapWalletEntityKey(row: WalletEntityKeyRow): WalletEntityKeyRecord {
  return {
    walletAddress: row.wallet_address,
    entityId: row.entity_id,
    keyId: row.key_id,
    keyType: row.key_type,
    qx: row.qx,
    qy: row.qy,
    eoa: row.eoa,
    credentialId: row.credential_id,
    createdAt: row.created_at,
  };
}

function mapWalletKeyEnrollmentRequest(row: WalletKeyEnrollmentRequestRow): WalletKeyEnrollmentRequestRecord {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    entityId: row.entity_id,
    keyType: row.key_type,
    qx: row.qx,
    qy: row.qy,
    eoa: row.eoa,
    credentialId: row.credential_id,
    label: row.label,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at,
  };
}

function mapWalletProposal(row: WalletProposalRow): WalletProposalRecord {
  return {
    id: row.id,
    walletAddress: row.wallet_address,
    chainId: row.chain_id,
    target: row.target,
    value: row.value,
    data: row.data,
    nonce: row.nonce,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapWalletProposalSig(row: WalletProposalSigRow): WalletProposalSigRecord {
  return {
    proposalId: row.proposal_id,
    entityId: row.entity_id,
    keyId: row.key_id,
    keyType: row.key_type,
    signature: row.signature,
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
