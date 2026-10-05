import { expect, test } from "bun:test";
import { configuredMailboxes } from "../src/mailboxes";
import { blockers } from "../src/model";
import { globalCampaignDefaults, prepareBatch } from "../src/preparation";
import { seed } from "../src/seed";
import { installFounderEmails } from "../src/senders";
import { installTracker } from "../src/tracker-source";

function workspace() {
  const s = seed();
  installTracker(s);
  installFounderEmails(s);
  return s;
}
test("all regions prepare once, preserve drafts and history, and use the chosen sender", () => {
  const s = workspace();
  s.prospects[0].body = "Keep my edited message";
  const original = structuredClone(s.prospects);
  const owned = s.tracker!.companies.find((c) => c.name === "Lumen Compute")!;
  owned.owner = "Chinmay";
  const body = {
    campaignId: s.campaigns[0].id,
    sender: "Akshit",
    companies: s.tracker!.companies.map(({ id, revision }) => ({ id, revision })),
  };
  const result = prepareBatch(s, body);
  expect(result.unresolved).toEqual([]);
  expect(s.prospects).toHaveLength(13);
  expect(s.prospects.slice(0, original.length)).toEqual(original);
  expect(
    s.prospects.slice(original.length).every((p) => !p.email && !p.verified && !p.programReviewed),
  ).toBe(true);
  const lambda = s.prospects.find((p) => p.companyId === owned.id)!;
  expect(lambda.status).toBe("paused");
  expect(s.campaigns.find((c) => c.id === lambda.campaignId)?.sender).toBe("Akshit");
  expect(lambda.body).toContain("I'm Akshit");
  expect(prepareBatch(s, body)).toEqual({ added: 0, existing: 13, unresolved: [] });
  expect(s.receipts).toHaveLength(0);
});
test("batch rejects stale selection before mutation and reports companies without a website", () => {
  const s = workspace();
  const companies = s.tracker!.companies.slice(-2);
  const before = JSON.stringify(s);
  expect(() =>
    prepareBatch(s, {
      campaignId: s.campaigns[0].id,
      companies: companies.map((c, i) => ({ id: c.id, revision: c.revision + i })),
    }),
  ).toThrow("changed");
  expect(JSON.stringify(s)).toBe(before);
  companies[0].routes = {};
  const result = prepareBatch(s, {
    campaignId: s.campaigns[0].id,
    companies: companies.map(({ id, revision }) => ({ id, revision })),
  });
  expect(result.unresolved).toEqual([companies[0].name]);
  expect(result.added).toBe(1);
});
test("batch preparation can assign either founder regardless of tracker owner", () => {
  const s = workspace();
  const company = s.tracker!.companies.find(
    (c) => !s.prospects.some((p) => p.companyId === c.id || p.company === c.name),
  )!;
  company.owner = "Akshit";
  expect(
    prepareBatch(s, {
      campaignId: s.campaigns[0].id,
      sender: "Chinmay",
      companies: [{ id: company.id, revision: company.revision }],
    }).added,
  ).toBe(1);
  const draft = s.prospects.find((p) => p.companyId === company.id)!;
  const campaign = s.campaigns.find((c) => c.id === draft.campaignId)!;
  expect(campaign.sender).toBe("Chinmay");
  expect(campaign.senderEmail).toBe("chinmay@gridlinegpu.com");
  expect(draft.body).toContain("I'm Chinmay");
  expect(s.receipts).toHaveLength(0);
});
test("campaign migration preserves custom names, copy, addresses, and receipt history", () => {
  const s = workspace();
  s.campaigns[0].name = "North America · providers";
  const drafts = JSON.stringify(s.prospects);
  globalCampaignDefaults(s);
  expect(s.campaigns[0].name).toBe("All regions · providers");
  expect(JSON.stringify(s.prospects)).toBe(drafts);
  s.campaigns[0].name = "My NA campaign";
  s.campaigns[0].senderEmail = "custom@example.com";
  globalCampaignDefaults(s);
  installFounderEmails(s);
  expect(s.campaigns[0].name).toBe("My NA campaign");
  expect(s.campaigns[0].senderEmail).toBe("custom@example.com");
});
test("two mailboxes match sender independently; incomplete credentials do not connect", () => {
  const env: Record<string, string> = {};
  for (const sender of ["AKSHIT", "CHINMAY"]) {
    const prefix = `OUTREACH_SMTP_${sender}`;
    Object.assign(env, {
      [`${prefix}_HOST`]: "smtp.example.com",
      [`${prefix}_USER`]: sender.toLowerCase(),
      [`${prefix}_FROM`]: `${sender.toLowerCase()}@gridlinegpu.com`,
      [`${prefix}_PASSWORD`]: "test-only",
    });
  }
  const accounts = configuredMailboxes(env);
  expect(accounts).toHaveLength(2);
  const s = workspace();
  const p = s.prospects[0];
  const c = s.campaigns[0];
  const caps = {
    liveEnabled: true,
    smtp: true,
    smtpFrom: accounts[0].from,
    smtpMailboxes: accounts.map((a) => a.from),
    research: false,
    forms: [],
  };
  c.senderEmail = "chinmay@gridlinegpu.com";
  expect(blockers(s, p, c, "live", ["email"], caps).some((b) => b.includes("matching"))).toBe(
    false,
  );
  c.senderEmail = "unknown@example.com";
  expect(blockers(s, p, c, "live", ["email"], caps).some((b) => b.includes("matching"))).toBe(true);
  delete env.OUTREACH_SMTP_CHINMAY_PASSWORD;
  expect(configuredMailboxes(env)).toHaveLength(1);
});
