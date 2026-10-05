import { fillPublishedEmail } from "./email-research";
import { blankProspect, compose, type State } from "./model";
import { sourceConfig, sourceFile } from "./source-data";
import { companyKey, type TrackedCompany } from "./tracker-model";

export function installCuratedCompanies(s: State) {
  if (!s.tracker) return { added: 0, draftsAdded: 0 };
  const config = sourceConfig().curated ?? {};
  let added = 0;
  for (const source of sourceFile<TrackedCompany[]>("curated", [])) {
    if (s.tracker.companies.some((c) => c.id === source.id || companyKey(c.name) === source.id))
      continue;
    s.tracker.companies.push(structuredClone(source));
    added++;
  }

  let draftsAdded = 0;
  const campaign = s.campaigns.find((c) => c.id === "na-providers");
  for (const { id, domain } of config.draft ?? []) {
    const company = s.tracker.companies.find((c) => c.id === id);
    if (!company || !campaign || s.prospects.some((p) => p.companyId === company.id)) continue;
    const person = company.people[0];
    const prospect = blankProspect(campaign.id, company.name, domain);
    Object.assign(prospect, {
      companyId: company.id,
      region: company.region,
      contact: person.name,
      role: person.bio,
      hook: `Your work caught my attention: ${company.hook}.`,
      source: company.story,
      programReviewed: true,
    });
    fillPublishedEmail(prospect, company);
    Object.assign(prospect, compose(prospect, campaign));
    s.prospects.push(prospect);
    draftsAdded++;
  }
  for (const { id, domain, reason } of config.park ?? []) {
    const parked = s.tracker.companies.find((c) => c.id === id);
    if (!parked || !campaign || s.prospects.some((p) => p.companyId === parked.id)) continue;
    const prospect = blankProspect(campaign.id, parked.name, domain);
    Object.assign(prospect, {
      companyId: parked.id,
      region: parked.region,
      role: reason,
      source: parked.story,
      status: "paused",
      programReviewed: true,
    });
    s.prospects.push(prospect);
    draftsAdded++;
  }
  return { added, draftsAdded };
}
