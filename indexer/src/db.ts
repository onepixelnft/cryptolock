import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface StoredEvent {
  chainId: number;
  blockNumber: number;
  logIndex: number;
  txHash: string;
  contract: string;
  eventName: string;
  owner: string | null;
  args: Record<string, string>;
  timestamp: number | null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS events (
  chain_id     INTEGER NOT NULL,
  block_number INTEGER NOT NULL,
  log_index    INTEGER NOT NULL,
  tx_hash      TEXT    NOT NULL,
  contract     TEXT    NOT NULL,
  event_name   TEXT    NOT NULL,
  owner        TEXT,
  args         TEXT    NOT NULL,
  timestamp    INTEGER,
  PRIMARY KEY (chain_id, tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS events_by_owner    ON events (chain_id, owner);
CREATE INDEX IF NOT EXISTS events_by_contract ON events (chain_id, contract);

CREATE TABLE IF NOT EXISTS accounts (
  chain_id      INTEGER NOT NULL,
  account       TEXT    NOT NULL,
  owner         TEXT    NOT NULL,
  created_block INTEGER NOT NULL,
  PRIMARY KEY (chain_id, account)
);
CREATE INDEX IF NOT EXISTS accounts_by_owner ON accounts (chain_id, owner);

CREATE TABLE IF NOT EXISTS cursors (
  chain_id    INTEGER PRIMARY KEY,
  last_block  INTEGER NOT NULL,
  fingerprint TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS preferences (
  address    TEXT PRIMARY KEY,
  data       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS used_nonces (
  address TEXT NOT NULL,
  nonce   TEXT NOT NULL,
  used_at TEXT NOT NULL,
  PRIMARY KEY (address, nonce)
);
`;

export class Store {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(SCHEMA);
  }

  close() {
    this.db.close();
  }

  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  getCursor(chainId: number): { lastBlock: number; fingerprint: string } | null {
    const row = this.db.prepare("SELECT last_block, fingerprint FROM cursors WHERE chain_id = ?").get(chainId) as
      | { last_block: number; fingerprint: string }
      | undefined;
    return row ? { lastBlock: row.last_block, fingerprint: row.fingerprint } : null;
  }

  setCursor(chainId: number, lastBlock: number, fingerprint: string) {
    this.db
      .prepare(
        "INSERT INTO cursors (chain_id, last_block, fingerprint) VALUES (?, ?, ?) " +
          "ON CONFLICT(chain_id) DO UPDATE SET last_block = excluded.last_block, fingerprint = excluded.fingerprint",
      )
      .run(chainId, lastBlock, fingerprint);
  }

  resetChain(chainId: number) {
    this.transaction(() => {
      this.db.prepare("DELETE FROM events WHERE chain_id = ?").run(chainId);
      this.db.prepare("DELETE FROM accounts WHERE chain_id = ?").run(chainId);
      this.db.prepare("DELETE FROM cursors WHERE chain_id = ?").run(chainId);
    });
  }

  upsertAccount(chainId: number, account: string, owner: string, createdBlock: number) {
    this.db
      .prepare(
        "INSERT INTO accounts (chain_id, account, owner, created_block) VALUES (?, ?, ?, ?) " +
          "ON CONFLICT(chain_id, account) DO UPDATE SET owner = excluded.owner",
      )
      .run(chainId, account.toLowerCase(), owner.toLowerCase(), createdBlock);
  }

  setAccountOwner(chainId: number, account: string, owner: string) {
    this.db
      .prepare("UPDATE accounts SET owner = ? WHERE chain_id = ? AND account = ?")
      .run(owner.toLowerCase(), chainId, account.toLowerCase());
  }

  accounts(chainId: number): string[] {
    const rows = this.db.prepare("SELECT account FROM accounts WHERE chain_id = ?").all(chainId) as Array<{ account: string }>;
    return rows.map((r) => r.account);
  }

  insertEvent(e: StoredEvent) {
    this.db
      .prepare(
        "INSERT OR IGNORE INTO events (chain_id, block_number, log_index, tx_hash, contract, event_name, owner, args, timestamp) " +
          "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .run(
        e.chainId,
        e.blockNumber,
        e.logIndex,
        e.txHash,
        e.contract.toLowerCase(),
        e.eventName,
        e.owner?.toLowerCase() ?? null,
        JSON.stringify(e.args),
        e.timestamp,
      );
  }

  activity(chainId: number, address: string, limit = 2_000): { events: StoredEvent[]; truncated: boolean } {
    const owner = address.toLowerCase();
    const rows = this.db
      .prepare(
        "SELECT * FROM events WHERE chain_id = ? AND (owner = ? OR contract IN " +
          "(SELECT account FROM accounts WHERE chain_id = ? AND owner = ?)) " +
          "ORDER BY block_number DESC, log_index DESC LIMIT ?",
      )
      .all(chainId, owner, chainId, owner, limit + 1) as Array<Record<string, unknown>>;
    const truncated = rows.length > limit;
    const events = rows.slice(0, limit).reverse().map((r) => this.toEvent(r));
    return { events, truncated };
  }

  private toEvent(r: Record<string, unknown>): StoredEvent {
    return {
      chainId: Number(r.chain_id),
      blockNumber: Number(r.block_number),
      logIndex: Number(r.log_index),
      txHash: String(r.tx_hash),
      contract: String(r.contract),
      eventName: String(r.event_name),
      owner: r.owner === null ? null : String(r.owner),
      args: JSON.parse(String(r.args)) as Record<string, string>,
      timestamp: r.timestamp === null ? null : Number(r.timestamp),
    };
  }

  getPreferences(address: string): { data: unknown; updatedAt: string } | null {
    const row = this.db.prepare("SELECT data, updated_at FROM preferences WHERE address = ?").get(address.toLowerCase()) as
      | { data: string; updated_at: string }
      | undefined;
    return row ? { data: JSON.parse(row.data), updatedAt: row.updated_at } : null;
  }

  savePreferences(address: string, data: unknown, nonce: string): boolean {
    const key = address.toLowerCase();
    return this.transaction(() => {
      const used = this.db.prepare("SELECT 1 FROM used_nonces WHERE address = ? AND nonce = ?").get(key, nonce);
      if (used) return false;
      const now = new Date().toISOString();
      this.db.prepare("INSERT INTO used_nonces (address, nonce, used_at) VALUES (?, ?, ?)").run(key, nonce, now);
      this.db
        .prepare(
          "INSERT INTO preferences (address, data, updated_at) VALUES (?, ?, ?) " +
            "ON CONFLICT(address) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at",
        )
        .run(key, JSON.stringify(data), now);
      return true;
    });
  }

  pruneNonces(before: Date): number {
    const result = this.db.prepare("DELETE FROM used_nonces WHERE used_at < ?").run(before.toISOString());
    return Number(result.changes);
  }
}
