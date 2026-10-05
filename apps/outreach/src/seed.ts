import { blankProspect, compose, GRIDLINE_PROVIDER_OFFER, type State } from "./model";
import { type Sample, sourceFile } from "./source-data";

export function seed(): State {
  const campaign = {
    id: "na-providers",
    name: "All regions · providers",
    kind: "provider" as const,
    sender: "Akshit",
    senderEmail: "",
    company: "Gridline",
    offer: GRIDLINE_PROVIDER_OFFER,
    ask: "Would you be open to a 15-minute call next week to discuss a potential partnership?",
  };
  // Public examples only, from the source folder's samples file. No private tracker activity or credentials.
  const examples = sourceFile<Sample[]>("samples", []);
  return {
    version: 1,
    campaigns: [campaign],
    prospects: examples.map(({ company, domain, ...fields }, i) => {
      const p = {
        ...blankProspect(campaign.id, company, domain),
        id: `sample-${i}`,
        region: "North America",
        ...fields,
      };
      return { ...p, ...compose(p, campaign) };
    }),
    receipts: [],
    approvals: [],
  };
}
