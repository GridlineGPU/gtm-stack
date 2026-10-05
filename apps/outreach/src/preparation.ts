import { fillPublishedEmail } from "./email-research";
import { blankProspect, compose, type State } from "./model";
import { senderCampaign } from "./senders";
import { hasReached, inferCompanyDomain, matchCompany } from "./tracker-model";

// Draft creation only. Imported contact routes never become verified email addresses.
export function prepareBatch(s: State, body: Record<string, unknown>) {
  const baseCampaign = s.campaigns.find((c) => c.id === body.campaignId);
  const targets = body.companies as { id: string; revision: number }[];
  if (!baseCampaign || !Array.isArray(targets) || !targets.length || targets.length > 500)
    throw new Error("Choose a campaign and 1–500 companies.");
  const campaign = body.sender
    ? senderCampaign(s, baseCampaign, String(body.sender))
    : baseCampaign;
  const companies = targets.map((item) => {
    const c = s.tracker?.companies.find((c) => c.id === item?.id);
    if (!c || c.revision !== item.revision)
      throw new Error("Tracker changed. Reload before preparing drafts.");
    return c;
  });
  const result = { added: 0, existing: 0, unresolved: [] as string[] };
  for (const c of companies) {
    if (s.prospects.some((p) => matchCompany(s, p)?.id === c.id)) {
      result.existing++;
      continue;
    }
    const domain = inferCompanyDomain(c);
    if (!domain || s.prospects.some((p) => p.domain === domain)) {
      result.unresolved.push(c.name);
      continue;
    }
    const rank: Record<string, number> = {
      partner: 0,
      product: 1,
      exec: 2,
      generic: 3,
      adjacent: 4,
    };
    const person = c.people
      .filter((p) => p.role !== "placeholder")
      .sort(
        (a, b) =>
          Number(b.name.toLowerCase() === c.poc.toLowerCase()) -
            Number(a.name.toLowerCase() === c.poc.toLowerCase()) ||
          (rank[a.role] ?? 5) - (rank[b.role] ?? 5),
      )[0];
    const p = blankProspect(campaign.id, c.name, domain);
    Object.assign(p, {
      companyId: c.id,
      region: c.region,
      contact: person?.name || "",
      role: person?.bio || "",
      hook: c.hook ? `Your work caught my attention: ${c.hook.replace(/[.!?]+$/, "")}.` : "",
      source: c.story,
      linkedin: /^https:\/\/(?:[a-z]+\.)?linkedin\.com\/in\//.test(person?.profile || "")
        ? person!.profile.replace(/^https:\/\/[a-z]+\.linkedin/, "https://www.linkedin")
        : "",
      status: hasReached(s, c) ? "paused" : "new",
    });
    fillPublishedEmail(p, c);
    Object.assign(p, compose(p, campaign));
    s.prospects.push(p);
    result.added++;
  }
  return result;
}

export function globalCampaignDefaults(s: State) {
  for (const c of s.campaigns) {
    if (c.company.toLowerCase() !== "gridline" || c.kind !== "provider") continue;
    c.name = c.name.replace(
      /^North America · providers(?= · (Akshit|Chinmay)$|$)/,
      "All regions · providers",
    );
  }
}
