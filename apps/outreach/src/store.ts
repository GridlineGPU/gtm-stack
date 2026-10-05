import { Database } from "bun:sqlite";
import { reconcileApplicationCopy } from "./application-copy";
import type { State } from "./model";
import { seed } from "./seed";

export class Store {
  db: Database;
  constructor(path: string) {
    this.db = new Database(path, { create: true });
    this.db.run("PRAGMA journal_mode=WAL");
    this.db.run(
      "CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), body TEXT NOT NULL)",
    );
    this.db.run("INSERT OR IGNORE INTO workspace VALUES (1, ?)", [JSON.stringify(seed())]);
  }
  read(): State {
    return JSON.parse(
      (this.db.query("SELECT body FROM workspace WHERE id=1").get() as { body: string }).body,
    );
  }
  change<T>(fn: (state: State) => T): T {
    return this.db.transaction(() => {
      const state = this.read();
      const result = fn(state);
      reconcileApplicationCopy(state);
      state.version++;
      this.db.run("UPDATE workspace SET body=? WHERE id=1", [JSON.stringify(state)]);
      return result;
    })();
  }
  recover() {
    this.change((s) => {
      for (const r of s.receipts)
        if (r.status === "running") {
          r.status = "uncertain";
          r.detail = "Server restarted during execution. Check destination before any retry.";
        }
    });
  }
}
