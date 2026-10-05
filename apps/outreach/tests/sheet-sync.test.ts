import { expect, test } from "bun:test";
import { reconcileApplicationCopy } from "../src/application-copy";
import { seed } from "../src/seed";
import { syncSheet } from "../src/sheet-sync";
import { changeTracker } from "../src/tracker-actions";
import { installTracker } from "../src/tracker-source";

function setup() {
  const s = seed();
  installTracker(s);
  const rows = s.tracker!.companies.map((c, i) => ({
    row: i + 2,
    cells: Object.fromEntries(
      "ABCDEFGH"
        .split("")
        .map((col) => [col + (i + 2), col === "A" ? c.sheetName : c.sheetValues[col] || ""]),
    ),
  }));
  return { s, rows };
}

test("sheet sync adds contacts, preserves history, and becomes idempotent", () => {
  const { s, rows } = setup();
  rows[0].cells.B2 = "New sheet contact";
  const history = JSON.stringify(s.receipts);
  expect(syncSheet(s, rows).peopleAdded).toBeGreaterThan(0);
  const rev = s.tracker!.companies[0].revision;
  expect(syncSheet(s, rows).changed).toBe(0);
  expect(s.tracker!.companies[0].revision).toBe(rev);
  expect(JSON.stringify(s.receipts)).toBe(history);
  expect(s.tracker!.companies[0].people.some((p) => p.name === "New sheet contact")).toBe(true);
});

test("local conflicts survive checks and explicit resolution", () => {
  const { s, rows } = setup();
  const c = s.tracker!.companies[0];
  c.owner = "Local owner";
  rows[0].cells.H2 = "Sheet owner";
  syncSheet(s, rows);
  expect(c.owner).toBe("Local owner");
  expect(syncSheet(s, rows).conflicts.some((x) => x.field === "owner")).toBe(true);
  changeTracker(s, "tracker-resolve", {
    id: c.id,
    revision: c.revision,
    field: "owner",
    choice: "local",
  });
  expect(syncSheet(s, rows).conflicts.some((x) => x.field === "owner")).toBe(false);
  rows[0].cells.H2 = "New sheet owner";
  syncSheet(s, rows);
  changeTracker(s, "tracker-resolve", {
    id: c.id,
    revision: c.revision,
    field: "owner",
    choice: "sheet",
  });
  expect(c.owner).toBe("New sheet owner");
});

test("invalid and duplicate exports rejected; removed companies retained", () => {
  const { s, rows } = setup();
  expect(() => syncSheet(s, [])).toThrow();
  expect(() => syncSheet(s, [rows[0], rows[0]])).toThrow();
  const count = s.tracker!.companies.length;
  expect(syncSheet(s, rows.slice(1)).missing.length).toBe(1);
  expect(s.tracker!.companies).toHaveLength(count);
});

test("application claim follows explicit status, stays idempotent, and removes on correction", () => {
  const { s } = setup();
  const p = s.prospects[0];
  const c = s.tracker!.companies[0];
  p.companyId = c.id;
  p.body = p.linkedinBody = "Hi, I'm Akshit.\n\nCompany context.\n\nCould we talk?";
  c.partnerStatus = "Applied";
  reconcileApplicationCopy(s);
  expect(p.body).toContain("We've already applied through");
  const rev = p.revision;
  reconcileApplicationCopy(s);
  expect(p.revision).toBe(rev);
  c.partnerStatus = "NA";
  c.salesStatus = "Contacted + Applied";
  reconcileApplicationCopy(s);
  expect(p.body).not.toContain("We've already applied");
  expect(p.body).toContain("I'm Akshit");
  c.partnerStatus = "Applied";
  s.tracker!.sheetSync = {
    checkedAt: "now",
    added: 0,
    changed: 0,
    peopleAdded: 0,
    missing: [],
    conflicts: [
      { companyId: c.id, company: c.name, field: "partnerStatus", local: "Applied", sheet: "NA" },
    ],
  };
  reconcileApplicationCopy(s);
  expect(p.body).not.toContain("We've already applied");
});
