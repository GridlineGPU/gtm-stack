import { resolve } from "node:path";
import { syncSheet } from "../src/sheet-sync";
import { Store } from "../src/store";

const path = process.argv[2];
if (!path)
  throw new Error(
    "Usage: bun apps/outreach/scripts/sync-sheet.ts /path/to/authenticated-sheet-export.xlsx",
  );
const parsed = Bun.spawnSync([
  process.env.OUTREACH_PYTHON || "python3",
  resolve(import.meta.dir, "read-sheet.py"),
  path,
]);
if (parsed.exitCode !== 0) throw new Error(parsed.stderr.toString());
const rows = JSON.parse(parsed.stdout.toString());
const store = new Store(
  resolve(
    process.env.OUTREACH_DATA_DIR || resolve(import.meta.dir, "../.data"),
    "workspace.sqlite",
  ),
);
try {
  console.log(
    JSON.stringify(
      store.change((s) => syncSheet(s, rows)),
      null,
      2,
    ),
  );
} finally {
  store.db.close();
}
