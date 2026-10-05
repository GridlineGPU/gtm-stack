import { expect, test } from "bun:test";
import { GRIDLINE_PROVIDER_OFFER } from "../src/model";
import { seed } from "../src/seed";
import { senderCampaign, switchSender } from "../src/senders";

test("founder switch regenerates identity, leaves other drafts alone and invalidates review", () => {
  const s = seed();
  const p = s.prospects[0];
  const other = structuredClone(s.prospects[1]);
  s.campaigns[0].senderEmail = "akshit@example.com";
  p.verified = p.trackerChecked = p.programReviewed = true;
  const oldRevision = p.revision;
  switchSender(s, p.id, p.revision, "Chinmay");
  const c = s.campaigns.find((c) => c.id === p.campaignId)!;
  expect(c.sender).toBe("Chinmay");
  expect(c.senderEmail).toBe("chinmay@gridlinegpu.com");
  expect(p.body).toContain("I'm Chinmay");
  expect(p.body).not.toContain("Akshit");
  expect(p.linkedinBody).toContain("Chinmay");
  expect(p.fields["Full name"]).toBe("Chinmay");
  expect(p.revision).toBe(oldRevision + 1);
  expect(p.verified || p.trackerChecked || p.programReviewed).toBe(false);
  expect(s.prospects[1]).toEqual(other);
  expect(() => switchSender(s, p.id, oldRevision, "Akshit")).toThrow();
  switchSender(s, p.id, p.revision, "Akshit");
  expect(p.campaignId).toBe("na-providers");
  expect(s.campaigns).toHaveLength(2);
});

test("sender presets are idempotent; completed snapshots and suppression survive switches", () => {
  const s = seed();
  const p = s.prospects[0];
  p.status = "opted_out";
  const c = senderCampaign(s, s.campaigns[0], "Chinmay");
  expect(senderCampaign(s, s.campaigns[0], "Chinmay").id).toBe(c.id);
  s.receipts.push({
    id: "old",
    prospectId: p.id,
    domain: p.domain,
    mode: "test",
    channel: "email",
    status: "simulated",
    at: "2026-09-08",
    detail: "Test",
    snapshot: { prospect: structuredClone(p), campaign: structuredClone(s.campaigns[0]) },
    approvalId: "old",
  });
  const receipts = JSON.stringify(s.receipts);
  switchSender(s, p.id, p.revision, "Chinmay");
  expect(p.status).toBe("opted_out");
  expect(JSON.stringify(s.receipts)).toBe(receipts);
  s.receipts[0].status = "running";
  expect(() => switchSender(s, p.id, p.revision, "Akshit")).toThrow("finish");
  expect(() => senderCampaign(s, c, "Someone else")).toThrow();
});

test("Gridline provider drafts explain routing and ask for a partnership call", () => {
  const s = seed();
  const p = s.prospects[0];
  expect(p.body.split("\n\n")).toHaveLength(3);
  expect(p.body).toContain(
    "founder of Gridline (Entrepreneurs First F26), think OpenRouter for GPUs",
  );
  expect(p.linkedinBody).not.toBe(p.body);
  expect(p.linkedinBody.length).toBeLessThan(p.body.length);
  expect(p.body).toContain(GRIDLINE_PROVIDER_OFFER);
  expect(p.body).toContain("explore partnering with Ion Harbor");
  expect(p.body).toContain("15-minute call next week to discuss a potential partnership");
  expect(p.body).not.toMatch(/pilot|billing and support agreed/);
  expect(p.body).not.toContain("already applied");
  switchSender(s, p.id, p.revision, "Chinmay");
  expect(p.body).toContain("I'm Chinmay");
  expect(p.body).not.toContain("Akshit");
  expect(p.fields.Message).toBe(p.body);
});
