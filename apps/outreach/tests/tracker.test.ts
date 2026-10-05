import { expect, test } from "bun:test";
import { blankProspect, blockers, type Receipt } from "../src/model";
import { seed } from "../src/seed";
import { Store } from "../src/store";
import { changeTracker, trackerCsv } from "../src/tracker-actions";
import { hasReached, inferCompanyDomain, needsHistory } from "../src/tracker-model";
import { installTracker } from "../src/tracker-source";

function workspace() {
  const s = seed();
  installTracker(s);
  return s;
}
function entry(patch: Record<string, unknown> = {}) {
  return {
    actor: "Akshit",
    contact: "Sam Rivera",
    platform: "linkedin",
    kind: "sent",
    occurredAt: "2026-09-07",
    subject: "",
    message: "Actual historical message\n\nWith paragraphs.\n",
    evidence: "Manual record",
    ...patch,
  };
}

test("company domains are inferred from imported contact and partner routes", () => {
  const s = workspace();
  const byName = (name: string) => s.tracker!.companies.find((c) => c.name === name)!;
  expect(inferCompanyDomain(byName("Lumen Compute"))).toBe("lumen.example");
  expect(inferCompanyDomain(byName("Corewell GPU"))).toBe("corewell.example");
  expect(s.tracker!.companies.every((c) => inferCompanyDomain(c).includes("."))).toBe(true);
});

test("source reconciliation covers every sheet company and every artifact contact without inventing sent messages", () => {
  const s = workspace();
  const cs = s.tracker!.companies;
  expect(cs).toHaveLength(13);
  expect(new Set(cs.map((c) => c.id)).size).toBe(13);
  expect(cs.flatMap((c) => c.people)).toHaveLength(16);
  expect(cs.flatMap((c) => c.people).filter((p) => p.source === "artifact")).toHaveLength(14);
  expect(
    cs
      .flatMap((c) => c.people)
      .filter((p) => p.source === "sheet")
      .map((p) => p.name)
      .sort(),
  ).toEqual(["Lee Morgan", "Pat Quinn"]);
  expect(cs.filter((c) => c.region === "North America")).toHaveLength(6);
  expect(cs.find((c) => c.name === "Corewell GPU")?.salesStatus).toBe("Presenting");
  expect(cs.find((c) => c.name === "Cascade Cloud")?.salesStatus).toBe(
    "Meeting schedule 07/09/2026",
  );
  expect(cs.find((c) => c.name === "Hive HPC")?.partnerStatus).toBe("NA");
  expect(cs.find((c) => c.name === "Hive HPC")?.salesStatus).toBe("Contacted + Applied");
  expect(s.tracker!.touchpoints).toHaveLength(0);
  expect(cs[0].people[0].referenceDraft).toContain("Gridline");
  expect(s.receipts).toHaveLength(0);
});

test("startup import is idempotent and preserves existing campaigns, drafts and local edits", () => {
  const store = new Store(":memory:");
  const before = store.read();
  store.change(installTracker);
  store.change((s) => {
    s.tracker!.companies[0].owner = "Custom owner";
  });
  const imported = store.read();
  expect(installTracker(imported)).toBe(false);
  expect(imported.tracker!.companies[0].owner).toBe("Custom owner");
  expect(imported.campaigns).toEqual(before.campaigns);
  expect(imported.prospects.map((p) => p.body)).toEqual(before.prospects.map((p) => p.body));
  expect(imported.prospects.every((p) => p.companyId)).toBe(true);
  store.db.close();
});

test("unknown history remains unknown; detailed historical log preserves exact message and does not send", () => {
  const s = workspace();
  const c = s.tracker!.companies.find((c) => c.id === "corewellgpu")!;
  expect(needsHistory(s, c)).toBe(true);
  changeTracker(s, "tracker-log", {
    id: c.id,
    revision: c.revision,
    entry: entry({ occurredAt: "", platform: "unknown", message: "" }),
  });
  expect(needsHistory(s, c)).toBe(true);
  changeTracker(s, "tracker-log", { id: c.id, revision: c.revision, entry: entry() });
  expect(s.tracker!.touchpoints[0].message).toBe(entry().message as string);
  expect(c.salesStatus).toBe("Presenting");
  expect(needsHistory(s, c)).toBe(false);
  expect(s.receipts).toHaveLength(0);
  expect(s.approvals).toHaveLength(0);
});

test("revisions, invalid channels and impossible dates reject atomically", () => {
  const store = new Store(":memory:");
  store.change(installTracker);
  const c = store.read().tracker!.companies[0];
  for (const input of [
    { revision: 0, entry: entry() },
    { revision: 1, entry: entry({ platform: "bot" }) },
    { revision: 1, entry: entry({ occurredAt: "2026-02-30" }) },
  ]) {
    expect(() =>
      store.change((s) => changeTracker(s, "tracker-log", { id: c.id, ...input })),
    ).toThrow();
  }
  expect(store.read().tracker!.touchpoints).toHaveLength(0);
  expect(() =>
    store.change((s) =>
      changeTracker(s, "tracker-update", {
        id: c.id,
        revision: 1,
        patch: { owner: "Changed", followUp: "invalid" },
      }),
    ),
  ).toThrow();
  expect(store.read().tracker!.companies[0].owner).toBe(c.owner);
  store.db.close();
});

test("source activity continues to suppress fresh live outreach after status edits", () => {
  const s = workspace();
  const c = s.tracker!.companies.find((c) => c.id === "orbitdataservices")!;
  changeTracker(s, "tracker-update", {
    id: c.id,
    revision: c.revision,
    patch: { salesStatus: "Prospecting", partnerStatus: "Not applied" },
  });
  expect(hasReached(s, c)).toBe(true);
  const p = blankProspect(s.campaigns[0].id, "Orbit AI", "orbitdata.example");
  const caps = { liveEnabled: false, smtp: false, smtpFrom: "", research: false, forms: [] };
  expect(
    blockers(s, p, s.campaigns[0], "live", ["email"], caps).some((x) =>
      x.includes("Tracker records prior activity"),
    ),
  ).toBe(true);
  expect(
    blockers(s, p, s.campaigns[0], "test", ["email"], caps).some((x) =>
      x.includes("Tracker records prior activity"),
    ),
  ).toBe(false);
});

test("prepare uses campaign sender, keeps existing drafts, and never copies claims from artifact draft", () => {
  const s = workspace();
  const c = s.tracker!.companies.find((c) => c.id === "lumencompute")!;
  const body = {
    id: c.id,
    revision: c.revision,
    personId: c.people[0].id,
    campaignId: s.campaigns[0].id,
    domain: "",
  };
  const id = changeTracker(s, "tracker-prepare", body);
  const p = s.prospects.find((p) => p.id === id)!;
  expect(p.domain).toBe("lumen.example");
  expect(p.body).toContain("Akshit");
  expect(p.body).not.toContain("Chinmay");
  expect(p.body).not.toContain("already applied");
  expect(p.status).toBe("paused");
  expect(p.verified).toBe(false);
  const count = s.prospects.length;
  p.body = "Keep these edits";
  expect(changeTracker(s, "tracker-prepare", body)).toBe(id);
  expect(s.prospects).toHaveLength(count);
  expect(p.body).toBe("Keep these edits");
});

test("manual opt-out persists across draft edits and simulations/handoffs never count as sends", () => {
  const s = workspace();
  const c = s.tracker!.companies.find((c) => c.id === "ionharbor")!;
  const p = s.prospects.find((p) => p.companyId === c.id)!;
  const receipt: Receipt = {
    id: "receipt",
    prospectId: p.id,
    domain: p.domain,
    mode: "test",
    channel: "linkedin",
    status: "simulated",
    at: new Date().toISOString(),
    detail: "Test only",
    snapshot: { prospect: structuredClone(p), campaign: structuredClone(s.campaigns[0]) },
    approvalId: "none",
  };
  s.receipts.push(receipt);
  expect(hasReached(s, c)).toBe(false);
  receipt.mode = "live";
  receipt.status = "handoff";
  expect(hasReached(s, c)).toBe(false);
  changeTracker(s, "tracker-log", {
    id: c.id,
    revision: c.revision,
    entry: entry({ kind: "opted_out", contact: p.contact }),
  });
  expect(p.status).toBe("opted_out");
  expect(hasReached(s, c)).toBe(true);
});

test("CSV retains multiline message text, quotes formula cells, and includes live receipts", () => {
  const s = workspace();
  const c = s.tracker!.companies[0];
  c.notes = '=HYPERLINK("example")';
  changeTracker(s, "tracker-log", {
    id: c.id,
    revision: c.revision,
    entry: entry({ message: 'Hello, "team"\nSecond line' }),
  });
  const csv = trackerCsv(s);
  expect(csv).toContain('Hello, ""team""');
  expect(csv).toContain('""team""\nSecond line');
  expect(csv).toContain("'=HYPERLINK");
  const p = blankProspect(s.campaigns[0].id, c.name, "orbitdata.example");
  p.body = "Recorded SMTP payload";
  s.receipts.push({
    id: "live",
    prospectId: p.id,
    domain: p.domain,
    mode: "live",
    channel: "email",
    status: "accepted",
    at: "2026-09-08",
    detail: "Accepted",
    snapshot: { prospect: p, campaign: s.campaigns[0] },
    approvalId: "a",
  });
  expect(trackerCsv(s)).toContain("Recorded SMTP payload");
});

test("history recorded while an approval runs stops remaining actions", async () => {
  const { approveAndRun } = await import("../src/executor");
  const store = new Store(":memory:");
  store.change(installTracker);
  const s = store.read();
  const p = s.prospects[0];
  const calls: string[] = [];
  await approveAndRun(
    store,
    {
      prospectId: p.id,
      revision: p.revision,
      stateVersion: s.version,
      reviewer: "Test",
      mode: "test",
      channels: ["application", "email"],
    },
    { liveEnabled: false, smtp: false, smtpFrom: "", research: false, forms: [] },
    {
      async execute(r) {
        calls.push(r.channel);
        store.change((s) => {
          const c = s.tracker!.companies.find((c) => c.id === p.companyId)!;
          changeTracker(s, "tracker-log", {
            id: c.id,
            revision: c.revision,
            entry: entry({ contact: p.contact }),
          });
        });
        return { status: "simulated", detail: "Isolated test" };
      },
    },
  );
  expect(calls).toEqual(["application"]);
  expect(store.read().receipts[1].status).toBe("canceled");
  store.db.close();
});
