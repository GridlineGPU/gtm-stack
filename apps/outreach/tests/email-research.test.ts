import { expect, test } from "bun:test";
import {
  addEmailResearch,
  fillPublishedEmail,
  syncPublishedEmailEvidence,
} from "../src/email-research";
import { firstCallCopy } from "../src/first-call";
import { compose, GRIDLINE_PROVIDER_OFFER } from "../src/model";
import { prepareBatch } from "../src/preparation";
import { seed } from "../src/seed";
import { inferCompanyDomain } from "../src/tracker-model";
import { installTracker } from "../src/tracker-source";
import ledger from "./fixtures/email-research.json";

function workspace() {
  const s = seed();
  installTracker(s);
  return s;
}
test("published email catalog fills later bulk drafts and preserves individual LinkedIn identity", () => {
  const s = workspace();
  addEmailResearch(s, ledger as Parameters<typeof addEmailResearch>[1]);
  prepareBatch(s, {
    campaignId: s.campaigns[0].id,
    companies: s.tracker!.companies.map(({ id, revision }) => ({ id, revision })),
  });
  expect(s.prospects.filter((p) => p.email)).toHaveLength(4);
  const p = s.prospects.find((p) => p.company === "Nimbus Grid")!;
  expect(p.email).toBe("partners@nimbusgrid.example");
  expect(p.body).toStartWith("Hi Nimbus Grid team,");
  expect(p.linkedinBody).toStartWith("Hi Rhea,");
  expect(p.verified).toBe(false);
  const named = s.prospects.find((p) => p.company === "Nebula Racks")!;
  expect(named.email).toBe("arno.jansen@nebularacks.example");
  expect(named.emailEvidence?.kind).toBe("person");
  const before = JSON.stringify(s);
  addEmailResearch(s, ledger as Parameters<typeof addEmailResearch>[1]);
  expect(JSON.stringify(s)).toBe(before);
  expect(s.receipts).toHaveLength(0);
});
test("research preserves custom email and drops a personal source when contact changes", () => {
  const s = workspace();
  s.prospects[0].email = "custom@example.com";
  addEmailResearch(s, ledger as Parameters<typeof addEmailResearch>[1]);
  expect(s.prospects[0].email).toBe("custom@example.com");
  const c = s.tracker!.companies.find((c) => c.name === "Nebula Racks")!;
  const p: (typeof s.prospects)[number] = {
    ...s.prospects[0],
    email: "",
    company: "Nebula Racks",
    contact: "Arno Jansen",
    emailEvidence: undefined,
  };
  fillPublishedEmail(p, c);
  expect(p.emailEvidence?.kind).toBe("person");
  p.contact = "Different Person";
  syncPublishedEmailEvidence(p, c);
  expect(p.emailEvidence).toBeUndefined();
  p.email = "";
  fillPublishedEmail(p, c);
  expect(p.email).toBe("hello@nebularacks.example");
});
test("first-call migration removes pilot proposals without rewriting custom text or history", () => {
  const s = workspace();
  const p = s.prospects[0];
  p.body =
    "Hi Mira, custom intro. We're building a unified way for teams to find and access GPU compute across providers.\n\nWe'd like to explore a small integration pilot, with API access, billing and support agreed up front.\n\nWould you be open to a 15-minute call next week to explore bringing Ion Harbor into the Gridline network and how you work with platforms that bring in GPU demand?\nMy custom ending.";
  p.linkedinBody =
    "Hi Mira, think OpenRouter for GPUs.\n\nWe're exploring a small provider integration pilot.\n\nWould you be open to a 15-minute call to explore a small pilot?";
  p.fields.Message = p.body;
  const beforeRevision = p.revision;
  firstCallCopy(s);
  expect(p.body).not.toMatch(/pilot|billing and support agreed/);
  expect(p.body).toContain("custom intro");
  expect(p.body).toContain("My custom ending");
  expect(p.body).toContain(GRIDLINE_PROVIDER_OFFER);
  expect(p.body).toContain("explore partnering with Ion Harbor");
  expect(p.body).toContain("15-minute call next week to discuss a potential partnership");
  expect(p.linkedinBody).not.toContain("pilot");
  expect(p.linkedinBody).toContain("privacy, security, and compliance");
  expect(p.linkedinBody).toContain("We're exploring a partnership with Ion Harbor");
  expect(p.fields.Message).not.toContain("pilot");
  expect(p.fields.Message).toContain(GRIDLINE_PROVIDER_OFFER);
  expect(p.revision).toBe(beforeRevision + 1);
  const once = JSON.stringify(s);
  firstCallCopy(s);
  expect(JSON.stringify(s)).toBe(once);
  expect(compose(p, s.campaigns[0]).body).not.toContain("pilot");
});
test("generated artifact copy migrates to direct partnership-call positioning", () => {
  const s = workspace();
  const p = s.prospects[0];
  const old =
    "Hi Mira, I'm Akshit, founder of Gridline. We aggregate GPU demand across providers and are building toward a unified interface for accessing compute.\n\nCompany fact. We're exploring partnerships with compute providers.\n\nI'd love to connect directly.";
  p.body = p.linkedinBody = p.fields.Message = old;
  firstCallCopy(s);
  expect(p.body).toContain(GRIDLINE_PROVIDER_OFFER);
  expect(p.body).toContain("explore partnering with Ion Harbor");
  expect(p.body).toContain("15-minute call next week to discuss a potential partnership");
  expect(p.linkedinBody).toContain("We're exploring a partnership with Ion Harbor");
  expect(p.linkedinBody).not.toBe(p.body);
  expect(p.fields.Message).toBe(p.body);
  expect(p.body).not.toContain("unified interface");
});
test("country-level domains retain the company label", () => {
  const s = workspace();
  for (const [name, domain] of [
    ["Kumo Internet", "kumo-fixture.ad.jp"],
    ["Lantern IDC", "lanternidc-fixture.com.vn"],
    ["Tui Solutions", "tui-fixture.co.nz"],
  ])
    expect(inferCompanyDomain(s.tracker!.companies.find((c) => c.name === name)!)).toBe(domain);
});
