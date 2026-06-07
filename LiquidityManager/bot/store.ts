import Database from "better-sqlite3";
import type { PlannedAction } from "../shared/types.js";

/** Persists cooldowns, breach ages (for max-staleness), and an action log across bot restarts. */
export class RebalancerStore {
  private readonly db: Database.Database;

  constructor(path = "liquidity-manager.db") {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS cooldowns (key TEXT PRIMARY KEY, last_action_sec INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS breaches (key TEXT PRIMARY KEY, since_sec INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS actions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ts_sec INTEGER NOT NULL,
        chain TEXT NOT NULL,
        kind TEXT NOT NULL,
        token TEXT NOT NULL,
        amount TEXT NOT NULL,
        notional_usd REAL NOT NULL,
        reason TEXT NOT NULL,
        tx_hash TEXT
      );
    `);
  }

  getCooldowns(): Map<string, number> {
    const rows = this.db.prepare("SELECT key, last_action_sec FROM cooldowns").all() as {
      key: string;
      last_action_sec: number;
    }[];
    return new Map(rows.map((r) => [r.key, r.last_action_sec]));
  }

  getBreachSince(): Map<string, number> {
    const rows = this.db.prepare("SELECT key, since_sec FROM breaches").all() as { key: string; since_sec: number }[];
    return new Map(rows.map((r) => [r.key, r.since_sec]));
  }

  /** Record currently-breached keys (insert new at `nowSec`, clear resolved) and return their ages map. */
  syncBreaches(breachedKeys: string[], nowSec: number): Map<string, number> {
    const breached = new Set(breachedKeys);
    const existing = this.getBreachSince();

    const insert = this.db.prepare("INSERT OR IGNORE INTO breaches(key, since_sec) VALUES (?, ?)");
    const remove = this.db.prepare("DELETE FROM breaches WHERE key = ?");
    const tx = this.db.transaction(() => {
      for (const key of breached) if (!existing.has(key)) insert.run(key, nowSec);
      for (const key of existing.keys()) if (!breached.has(key)) remove.run(key);
    });
    tx();
    return this.getBreachSince();
  }

  recordAction(chain: string, action: PlannedAction, nowSec: number, txHash?: string): void {
    this.db
      .prepare(
        "INSERT INTO actions(ts_sec, chain, kind, token, amount, notional_usd, reason, tx_hash) VALUES (?,?,?,?,?,?,?,?)"
      )
      .run(nowSec, chain, action.kind, action.tokenSymbol, action.amount.toString(), action.notionalUsd, action.reason, txHash ?? null);
    this.db
      .prepare("INSERT INTO cooldowns(key, last_action_sec) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET last_action_sec = excluded.last_action_sec")
      .run(action.key, nowSec);
  }

  close(): void {
    this.db.close();
  }
}
