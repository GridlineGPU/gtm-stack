import type { State } from "./model";
import { sourceConfig } from "./source-data";
import { companyKey, hasPriorActivity } from "./tracker-model";
export interface SheetRow {
  row: number;
  cells: Record<string, string>;
}
const mapping = {
  B: "poc",
  C: "partnerStatus",
  D: "story",
  E: "ncp",
  F: "salesStatus",
  G: "location",
  H: "owner",
} as const;
export function syncSheet(s: State, rows: SheetRow[], at = new Date().toISOString()) {
  if (!s.tracker) throw new Error("Tracker not initialized");
  if (s.receipts.some((r) => r.status === "running"))
    throw new Error("Actions running; retry sheet sync after completion");
  if (!Array.isArray(rows) || !rows.length || rows.length > 2000)
    throw new Error("Empty or oversized sheet export");
  const keys = new Set<string>();
  for (const row of rows) {
    if (
      !row ||
      !Number.isInteger(row.row) ||
      row.row < 2 ||
      !row.cells ||
      Object.values(row.cells).some((v) => typeof v !== "string" || v.length > 20000)
    )
      throw new Error("Invalid sheet row");
    const key = companyKey(row.cells[`A${row.row}`] || "");
    if (!key || keys.has(key)) throw new Error("Missing or duplicate company in sheet");
    keys.add(key);
  }
  const sheetUrl = sourceConfig().sheetUrl;
  const conflicts = [...(s.tracker.sheetSync?.conflicts || [])];
  let changed = 0,
    added = 0,
    peopleAdded = 0;
  for (const row of rows) {
    const v = (col: string) => row.cells[col + row.row] || "";
    const id = companyKey(v("A"));
    let c = s.tracker.companies.find((c) => c.id === id || companyKey(c.sheetName) === id);
    if (!c) {
      c = {
        id,
        name: v("A"),
        sheetName: v("A"),
        region: v("G") || "Unspecified",
        location: "",
        poc: "",
        owner: "",
        salesStatus: "",
        partnerStatus: "",
        ncp: "",
        nextStep: "",
        followUp: "",
        notes: "",
        revision: 1,
        summary: "Added from Google Sheet; company research needs review.",
        hook: "",
        routing: "",
        routes: {},
        story: "",
        artifactSource: "",
        sheetSource: "",
        sheetRow: row.row,
        sheetValues: {},
        people: [],
        knownPriorContact: false,
      };
      s.tracker.companies.push(c);
      added++;
    }
    c.knownPriorContact ||= hasPriorActivity(c);
    let touched = false;
    for (const [col, field] of Object.entries(mapping) as [
      keyof typeof mapping,
      (typeof mapping)[keyof typeof mapping],
    ][]) {
      const next = v(col),
        prev = c.sheetValues[col] || "";
      const existingConflict = conflicts.findIndex(
        (x) => x.companyId === c!.id && x.field === field,
      );
      if (c[field] === next) {
        if (existingConflict >= 0) conflicts.splice(existingConflict, 1);
        continue;
      }
      if (existingConflict >= 0) {
        conflicts[existingConflict].sheet = next;
        conflicts[existingConflict].local = c[field];
        continue;
      }
      if (next === prev) continue;
      if (c[field] !== prev) {
        conflicts.push({ companyId: c.id, company: c.name, field, local: c[field], sheet: next });
      } else {
        c[field] = next;
        touched = true;
      }
    }
    if (v("B") && !c.people.some((p) => companyKey(p.name) === companyKey(v("B")))) {
      c.people.push({
        id: `${c.id}-sheet-${companyKey(v("B"))}`,
        name: v("B"),
        role: "Sheet POC",
        bio: "Named in sheet; verify current role and profile.",
        profile: "",
        referenceDraft: "",
        source: "sheet",
      });
      peopleAdded++;
      touched = true;
    }
    if (
      JSON.stringify(c.sheetValues) !==
      JSON.stringify(Object.fromEntries("ABCDEFGH".split("").map((col) => [col, v(col)])))
    )
      touched = true;
    c.sheetValues = Object.fromEntries("ABCDEFGH".split("").map((col) => [col, v(col)]));
    c.sheetRow = row.row;
    c.sheetName = v("A");
    c.sheetSource = sheetUrl ? `${sheetUrl}#gid=0&range=A${row.row}:H${row.row}` : "";
    if (touched) {
      changed++;
      c.revision++;
      for (const p of s.prospects.filter(
        (p) => p.companyId === c!.id || companyKey(p.company) === companyKey(c!.name),
      )) {
        p.companyId = c.id;
        p.verified = false;
        p.trackerChecked = false;
        p.revision++;
      }
    }
  }
  const missing = s.tracker.companies
    .filter((c) => c.sheetSource && !keys.has(companyKey(c.sheetName)))
    .map((c) => c.name);
  s.tracker.sheetSync = { checkedAt: at, changed, added, peopleAdded, conflicts, missing };
  return s.tracker.sheetSync;
}
