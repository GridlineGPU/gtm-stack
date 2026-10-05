import { expect, test } from "bun:test";
import { installBundledSheet } from "../src/bundled-sheet";
import { seed } from "../src/seed";
import { installTracker } from "../src/tracker-source";
import snapshot from "./fixtures/sheet-latest.json";

function workspace() {
  const s = seed();
  installTracker(s);
  return s;
}

test("bundled sheet installs latest statuses without inventing outreach receipts", () => {
  const s = workspace();
  const receipts = JSON.stringify(s.receipts);
  expect(installBundledSheet(s)).toBe(true);
  for (const name of ["Meridian Metal", "Kumo Internet", "Lantern IDC", "Nimbus Grid"])
    expect(s.tracker!.companies.find((c) => c.name === name)!.salesStatus).toBe(
      "Contacted + Applied",
    );
  expect(s.tracker!.companies.find((c) => c.name === "Tui Solutions")!.salesStatus).toBe(
    "Rejected / Lost",
  );
  expect(s.tracker!.companies.find((c) => c.name === "Meridian Metal")!.partnerStatus).toBe(
    "Applied",
  );
  expect(s.tracker!.sheetSync!.checkedAt).toBe(snapshot.capturedAt);
  expect(JSON.stringify(s.receipts)).toBe(receipts);
  const before = JSON.stringify(s);
  expect(installBundledSheet(s)).toBe(false);
  expect(JSON.stringify(s)).toBe(before);
});

test("bundled sheet preserves local edits as conflicts and skips newer imports", () => {
  const s = workspace();
  const c = s.tracker!.companies.find((c) => c.name === "Meridian Metal")!;
  c.partnerStatus = "Locally reviewed";
  installBundledSheet(s);
  expect(c.partnerStatus).toBe("Locally reviewed");
  expect(s.tracker!.sheetSync!.conflicts).toContainEqual({
    companyId: c.id,
    company: c.name,
    field: "partnerStatus",
    local: "Locally reviewed",
    sheet: "Applied",
  });
  s.tracker!.sheetSync!.checkedAt = "2026-09-10T00:00:00.000Z";
  c.salesStatus = "Newer sheet status";
  const before = JSON.stringify(s);
  expect(installBundledSheet(s)).toBe(false);
  expect(JSON.stringify(s)).toBe(before);
});
