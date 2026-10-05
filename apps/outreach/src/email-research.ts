import type { Prospect, State } from "./model";
import { inferCompanyDomain, matchCompany, type TrackedCompany } from "./tracker-model";

export function addEmailResearch(
  s: State,
  rows: (NonNullable<TrackedCompany["emailResearch"]> & { companyId: string })[],
  domainRepairs: Record<string, string> = {},
) {
  let added = 0;
  for (const row of rows) {
    const company = s.tracker?.companies.find((c) => c.id === row.companyId);
    if (!company) continue;
    if (company.emailResearch?.checkedAt === row.checkedAt) continue;
    company.emailResearch = {
      checkedAt: row.checkedAt,
      pages: row.pages,
      candidates: row.candidates,
      website: row.website,
    };
    company.revision++;
    const p = s.prospects.find((p) => matchCompany(s, p)?.id === company.id);
    if (!p || s.receipts.some((r) => r.prospectId === p.id && r.status === "running")) continue;
    // Repair only the known suffix-only domains produced by the earlier importer.
    if (
      /^(?:co|com|net|org|gov|edu|ac|ad)\.[a-z]{2}$/.test(p.domain) ||
      domainRepairs[company.id] === p.domain
    ) {
      const corrected = inferCompanyDomain(company);
      if (!s.prospects.some((other) => other.id !== p.id && other.domain === corrected)) {
        p.domain = corrected;
        p.revision++;
        p.verified = p.trackerChecked = false;
      }
    }
    if (fillPublishedEmail(p, company)) added++;
  }
  return added;
}

export function syncPublishedEmailEvidence(p: Prospect, company?: TrackedCompany) {
  const evidence = company?.emailResearch?.candidates.find(
    (e) =>
      e.address === p.email &&
      (e.kind === "team" || (e.kind === "person" && e.contact === p.contact)),
  );
  p.emailEvidence =
    evidence && evidence.kind !== "unclassified"
      ? {
          address: evidence.address,
          kind: evidence.kind,
          contact: evidence.contact,
          source: evidence.source,
          checkedAt: evidence.checkedAt,
        }
      : undefined;
}

export function fillPublishedEmail(p: Prospect, company: TrackedCompany) {
  if (p.email) return false;
  const eligible = (company.emailResearch?.candidates || []).filter(
    (e) => e.kind === "team" || (e.kind === "person" && e.contact === p.contact),
  );
  const score = (e: (typeof eligible)[number]) =>
    e.kind === "person"
      ? 100
      : /^partner/i.test(e.address)
        ? 90
        : /^sales/i.test(e.address)
          ? 80
          : /^(business|commercial|connect)/i.test(e.address)
            ? 70
            : 50;
  const best = eligible.sort((a, b) => score(b) - score(a))[0];
  if (!best || best.kind === "unclassified") return false;
  p.email = best.address;
  p.emailEvidence = {
    address: best.address,
    kind: best.kind,
    contact: best.contact,
    source: best.source,
    checkedAt: best.checkedAt,
  };
  if (best.kind === "team") p.body = p.body.replace(/^Hi [^,\n]+,/, `Hi ${p.company} team,`);
  p.verified = p.trackerChecked = false;
  p.revision++;
  return true;
}
