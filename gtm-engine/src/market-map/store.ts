import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { Company, Run } from "./types";

/** SQLite store. Each row keeps the whole record as JSON; the columns exist for lookups. */
export class Store {
  db: Database;

  constructor(path = process.env.GTM_DB ?? "data/market-map.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS companies (id TEXT PRIMARY KEY, name TEXT NOT NULL, status TEXT NOT NULL, segment TEXT, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, started_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS sources (id TEXT PRIMARY KEY, url TEXT NOT NULL, data TEXT NOT NULL);
    `);
  }

  companies(): Company[] {
    return this.db
      .query("SELECT data FROM companies ORDER BY name COLLATE NOCASE")
      .all()
      .map((r: any) => JSON.parse(r.data));
  }

  company(id: string): Company | null {
    const r: any = this.db.query("SELECT data FROM companies WHERE id = ?").get(id);
    return r ? JSON.parse(r.data) : null;
  }

  putCompany(c: Company) {
    this.db
      .query("INSERT OR REPLACE INTO companies (id, name, status, segment, data) VALUES (?, ?, ?, ?, ?)")
      .run(c.id, c.name, c.status, c.segment, JSON.stringify(c));
  }

  deleteCompany(id: string) {
    this.db.query("DELETE FROM companies WHERE id = ?").run(id);
  }

  runs(): Run[] {
    return this.db
      .query("SELECT data FROM runs ORDER BY started_at DESC")
      .all()
      .map((r: any) => JSON.parse(r.data));
  }

  run(id: string): Run | null {
    const r: any = this.db.query("SELECT data FROM runs WHERE id = ?").get(id);
    return r ? JSON.parse(r.data) : null;
  }

  putRun(r: Run) {
    this.db
      .query("INSERT OR REPLACE INTO runs (id, kind, started_at, data) VALUES (?, ?, ?, ?)")
      .run(r.id, r.kind, r.started_at, JSON.stringify(r));
  }

  putSource(id: string, url: string, data: unknown) {
    this.db.query("INSERT OR REPLACE INTO sources (id, url, data) VALUES (?, ?, ?)").run(id, url, JSON.stringify(data));
  }

  sources(): { id: string; url: string; data: any }[] {
    return this.db
      .query("SELECT id, url, data FROM sources")
      .all()
      .map((r: any) => ({ id: r.id, url: r.url, data: JSON.parse(r.data) }));
  }

  /** Runs merge + run bookkeeping atomically so a failed merge leaves nothing half-written. */
  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export function now(): string {
  return new Date().toISOString();
}

export function runId(kind: string): string {
  return `${new Date().toISOString().replace(/[:.]/g, "-")}-${kind}`;
}
