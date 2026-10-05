import type { State } from "./model";
import { type SheetRow, syncSheet } from "./sheet-sync";
import { sourceFile } from "./source-data";

// A committed snapshot must never roll back a newer authenticated sheet import.
export function installBundledSheet(s: State) {
  const snapshot = sourceFile<{ capturedAt: string; rows: unknown[] } | null>("sheetLatest", null);
  if (!snapshot) return false;
  const checkedAt = s.tracker?.sheetSync?.checkedAt;
  if (checkedAt && Date.parse(checkedAt) >= Date.parse(snapshot.capturedAt)) return false;
  // The merger validates every row; JSON imports infer disjoint cell-key unions.
  syncSheet(s, snapshot.rows as unknown as SheetRow[], snapshot.capturedAt);
  return true;
}
