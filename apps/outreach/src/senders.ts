import { type Campaign, compose, type State } from "./model";

export function founderEmail(company: string, sender: string) {
  return company.toLowerCase() === "gridline" && ["Akshit", "Chinmay"].includes(sender)
    ? `${sender.toLowerCase()}@gridlinegpu.com`
    : "";
}

export function installFounderEmails(s: State) {
  for (const c of s.campaigns) {
    const address = founderEmail(c.company, c.sender);
    if (c.senderEmail || !address) continue;
    c.senderEmail = address;
    for (const p of s.prospects.filter((p) => p.campaignId === c.id)) {
      if (!p.fields.Email) p.fields.Email = address;
      p.verified = p.trackerChecked = p.programReviewed = false;
      p.revision++;
    }
  }
}

export function senderCampaign(s: State, base: Campaign, sender: string): Campaign {
  if (!["Akshit", "Chinmay"].includes(sender)) throw new Error("Choose Akshit or Chinmay.");
  const existing = s.campaigns.find(
    (c) =>
      c.sender === sender &&
      c.kind === base.kind &&
      c.company === base.company &&
      c.offer === base.offer &&
      c.ask === base.ask,
  );
  if (existing) return existing;
  const campaign = {
    ...base,
    id: crypto.randomUUID(),
    name: `${base.name.replace(/ · (Akshit|Chinmay)$/, "")} · ${sender}`,
    sender,
    senderEmail: founderEmail(base.company, sender),
  };
  s.campaigns.push(campaign);
  return campaign;
}
export function switchSender(s: State, id: string, revision: number, sender: string) {
  const p = s.prospects.find((p) => p.id === id);
  const base = s.campaigns.find((c) => c.id === p?.campaignId);
  if (!p || !base || p.revision !== revision)
    throw new Error("Draft changed. Refresh before switching sender.");
  if (s.receipts.some((r) => r.prospectId === id && r.status === "running"))
    throw new Error("Wait for approved actions to finish.");
  const campaign = senderCampaign(s, base, sender);
  if (p.campaignId === campaign.id) return;
  p.campaignId = campaign.id;
  Object.assign(p, compose(p, campaign));
  p.revision++;
  p.verified = false;
  p.trackerChecked = false;
  p.programReviewed = false;
}
