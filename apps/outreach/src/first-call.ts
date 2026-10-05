import { compose, GRIDLINE_PROVIDER_OFFER, type State } from "./model";

export function firstCallCopy(s: State) {
  const replacements = [
    [
      "We'd like to explore a small integration pilot, with API access, billing and support agreed up front.",
      "I'd like to connect with your team to understand your platform and how you approach provider partnerships.",
    ],
    [
      "We're exploring a small provider integration pilot.",
      "We'd like to explore a partnership so Gridline can route suitable customer workloads to available capacity on your platform.",
    ],
    [
      "We're building a unified interface for GPU compute across providers.",
      GRIDLINE_PROVIDER_OFFER,
    ],
    [
      "We're building a unified way for teams to find and access GPU compute across providers.",
      GRIDLINE_PROVIDER_OFFER,
    ],
    [
      "I'd like to connect with your team to understand your platform and how you approach provider partnerships.",
      "We'd like to explore a partnership so Gridline can route suitable customer workloads to available capacity on your platform.",
    ],
    [
      "I'd like to connect and learn how your team approaches provider partnerships.",
      "We'd like to explore a partnership so Gridline can route suitable customer workloads to available capacity on your platform.",
    ],
    [
      "I'd like to understand how your team exposes available capacity and whether Gridline could route suitable workloads to your clusters.",
      "We'd like to explore a partnership so Gridline can route suitable customer workloads to available capacity on your platform.",
    ],
    ["through a small provider pilot", "and learn more about your platform"],
    [
      "Would you be open to a 15-minute call to explore a small pilot?",
      "Would you be open to a 15-minute introductory call next week?",
    ],
    [
      "Would you be open to a 15-minute introductory call next week?",
      "Would you be open to a 15-minute call next week to discuss a potential partnership?",
    ],
  ];
  for (const c of s.campaigns) {
    if (c.kind !== "provider" || c.company.toLowerCase() !== "gridline") continue;
    if (
      [
        "We're building a unified interface for GPU compute across providers.",
        "We're building a unified way for teams to find and access GPU compute across providers.",
      ].includes(c.offer)
    )
      c.offer = GRIDLINE_PROVIDER_OFFER;
    for (const [before, after] of replacements) c.ask = c.ask.replaceAll(before, after);
    for (const p of s.prospects.filter((p) => p.campaignId === c.id)) {
      if (s.receipts.some((r) => r.prospectId === p.id && r.status === "running")) continue;
      let changed = false;
      const legacyArtifactCopy = [p.body, p.linkedinBody].some((value) =>
        value.includes(
          "We aggregate GPU demand across providers and are building toward a unified interface for accessing compute.",
        ),
      );
      const regenerated = legacyArtifactCopy ? compose(p, c) : undefined;
      const migrate = (value: string, linkedin = false) => {
        let next = value;
        for (const [before, after] of replacements) next = next.replaceAll(before, after);
        next = next.replaceAll(
          "We'd like to explore a partnership so Gridline can route suitable customer workloads to available capacity on your platform.",
          `We'd like to explore partnering with ${p.company} so Gridline can route suitable customer workloads to available capacity on your platform.`,
        );
        if (linkedin)
          next = next.replace(
            "think OpenRouter for GPUs.\n\n",
            `think OpenRouter for GPUs. ${GRIDLINE_PROVIDER_OFFER}\n\n`,
          );
        return next
          .replace(
            /Would you be open to a 15-minute (?:introductory )?call next week to (?:explore bringing|learn about)[^?\n]+\?/g,
            "Would you be open to a 15-minute call next week to discuss a potential partnership?",
          )
          .replace(
            "Would you be open to a 15-minute introductory call next week to see whether there's a partnership fit?",
            "Would you be open to a 15-minute call next week to discuss a potential partnership?",
          );
      };
      for (const key of ["body", "linkedinBody"] as const) {
        let next = regenerated?.[key] || migrate(p[key], key === "linkedinBody");
        if (
          key === "linkedinBody" &&
          next.includes(GRIDLINE_PROVIDER_OFFER) &&
          next.includes(`explore partnering with ${p.company}`)
        )
          next = compose(p, c).linkedinBody;
        if (next !== p[key]) {
          p[key] = next;
          changed = true;
        }
      }
      if (p.fields.Message) {
        const next = regenerated?.fields.Message || migrate(p.fields.Message);
        if (next !== p.fields.Message) {
          p.fields.Message = next;
          changed = true;
        }
      }
      if (changed) {
        p.revision++;
        p.verified = p.trackerChecked = false;
      }
    }
  }
}
