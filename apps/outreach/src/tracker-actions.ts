import { fillPublishedEmail } from "./email-research";
import { blankProspect, canonicalDomain, compose, type State } from "./model";
import {
  activityKinds,
  hasReached,
  inferCompanyDomain,
  matchCompany,
  platforms,
  type Touchpoint,
  trackedReceipts,
} from "./tracker-model";

function field(value: unknown, max = 20_000, exact = false): string {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid tracker field");
  return exact ? value : value.trim();
}
function date(value: unknown): string {
  const v = field(value, 10);
  if (
    v &&
    (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
      Number.isNaN(Date.parse(v)) ||
      new Date(v).toISOString().slice(0, 10) !== v)
  )
    throw new Error("Use a valid YYYY-MM-DD date, or leave unknown.");
  return v;
}
export function changeTracker(s: State, action: string, body: Record<string, unknown>) {
  const t = s.tracker;
  const c = t?.companies.find((c) => c.id === body.id);
  if (!t || !c) throw new Error("Tracked company missing");
  if (body.revision !== c.revision)
    throw new Error("Company changed elsewhere. Reload before saving.");
  if (action === "tracker-resolve") {
    if (s.receipts.some((r) => r.status === "running"))
      throw new Error("Actions running; retry later");
    const conflict = t.sheetSync?.conflicts.find(
      (x) => x.companyId === c.id && x.field === body.field,
    );
    if (!conflict || !["local", "sheet"].includes(String(body.choice)))
      throw new Error("Invalid conflict resolution");
    const key = conflict.field as
      | "poc"
      | "partnerStatus"
      | "story"
      | "ncp"
      | "salesStatus"
      | "location"
      | "owner";
    if (!["poc", "partnerStatus", "story", "ncp", "salesStatus", "location", "owner"].includes(key))
      throw new Error("Invalid field");
    if (body.choice === "sheet") {
      if (
        key === "salesStatus" &&
        t.touchpoints.some((e) => e.companyId === c.id && e.kind === "opted_out")
      )
        throw new Error("Recorded opt-out cannot be cleared here.");
      c[key] = conflict.sheet;
    }
    t.sheetSync!.conflicts = t.sheetSync!.conflicts.filter((x) => x !== conflict);
    for (const p of s.prospects.filter((p) => matchCompany(s, p)?.id === c.id)) {
      p.verified = false;
      p.trackerChecked = false;
      p.revision++;
    }
  } else if (action === "tracker-update") {
    const patch = body.patch as Record<string, unknown>;
    if (!patch || typeof patch !== "object") throw new Error("Invalid tracker update");
    if (
      t.touchpoints.some((e) => e.companyId === c.id && e.kind === "opted_out") &&
      "salesStatus" in patch &&
      patch.salesStatus !== "Opted out"
    )
      throw new Error("Recorded opt-out cannot be cleared here.");
    for (const key of [
      "poc",
      "owner",
      "salesStatus",
      "partnerStatus",
      "ncp",
      "nextStep",
      "notes",
    ] as const)
      if (key in patch) c[key] = field(patch[key]);
    if ("followUp" in patch) c.followUp = date(patch.followUp);
  } else if (action === "tracker-log") {
    const input = body.entry as Record<string, unknown>;
    if (!input) throw new Error("Activity missing");
    const platform = field(input.platform) as Touchpoint["platform"];
    const kind = field(input.kind) as Touchpoint["kind"];
    if (!platforms.includes(platform) || !activityKinds.includes(kind))
      throw new Error("Invalid platform or activity type");
    const actor = field(input.actor, 300);
    if (!actor) throw new Error("Record who performed this activity.");
    const entry: Touchpoint = {
      id: crypto.randomUUID(),
      companyId: c.id,
      platform,
      kind,
      actor,
      contact: field(input.contact, 300),
      occurredAt: date(input.occurredAt),
      recordedAt: new Date().toISOString(),
      subject: field(input.subject, 500),
      message: field(input.message, 20_000, true),
      evidence: field(input.evidence, 2000),
    };
    if (kind === "note" && !entry.message) throw new Error("Enter a note.");
    t.touchpoints.unshift(entry);
    if (kind !== "note") c.knownPriorContact = true;
    if (kind === "applied") c.partnerStatus = "Applied";
    // Logging an older message must not regress a current presenting/meeting stage.
    if (kind === "sent" && (!c.salesStatus || c.salesStatus === "Prospecting"))
      c.salesStatus = "Contacted";
    if (kind === "reply" && ["", "Prospecting", "Contacted", "Applied"].includes(c.salesStatus))
      c.salesStatus = "Replied";
    if (
      kind === "meeting" &&
      ["", "Prospecting", "Contacted", "Applied", "Replied", "Qualifying"].includes(c.salesStatus)
    )
      c.salesStatus = "Meeting";
    if (t.touchpoints.some((e) => e.companyId === c.id && e.kind === "opted_out"))
      c.salesStatus = "Opted out";
    for (const p of s.prospects.filter((p) => matchCompany(s, p)?.id === c.id)) {
      if (kind !== "note" && p.status === "new") {
        p.status = "paused";
        p.revision++;
      }
      if (p.status !== "opted_out" && ["reply", "meeting", "opted_out"].includes(kind)) {
        p.status = kind === "reply" ? "replied" : kind === "meeting" ? "meeting" : "opted_out";
        p.revision++;
      }
    }
  } else if (action === "tracker-prepare") {
    const existing = s.prospects.find((p) => matchCompany(s, p)?.id === c.id);
    if (existing) return existing.id;
    const campaign = s.campaigns.find((x) => x.id === body.campaignId);
    if (!campaign) throw new Error("Select a campaign");
    const person = c.people.find((p) => p.id === body.personId);
    if (!person || person.role === "placeholder") throw new Error("Select a named contact first");
    const domain = canonicalDomain(field(body.domain, 300) || inferCompanyDomain(c));
    if (!domain.includes(".")) throw new Error("Company website could not be determined");
    if (s.prospects.some((p) => p.domain === domain))
      throw new Error("Domain already has an outreach draft. Open it in Review inbox.");
    const p = blankProspect(campaign.id, c.name, domain);
    Object.assign(p, {
      companyId: c.id,
      region: c.region,
      contact: person.name,
      role: person.bio,
      hook: c.hook ? `Your work caught my attention: ${c.hook.replace(/[.!?]+$/, "")}.` : "",
      source: c.story,
      linkedin: /^https:\/\/(?:[a-z]+\.)?linkedin\.com\//.test(person.profile)
        ? person.profile.replace(/^https:\/\/[a-z]+\.linkedin/, "https://www.linkedin")
        : "",
      status: hasReached(s, c) ? "paused" : "new",
    });
    fillPublishedEmail(p, c);
    Object.assign(p, compose(p, campaign));
    s.prospects.push(p);
    return p.id;
  } else throw new Error("Unknown tracker action");
  c.revision++;
}

export function trackerCsv(s: State): string {
  const cell = (value: string) =>
    `"${(/^[\s]*[=+@-]/.test(value) ? `'${value}` : value).replaceAll('"', '""')}"`;
  const rows = [
    [
      "Company",
      "POC",
      "Partner Program Status",
      "Story",
      "NCP(Yes/No)",
      "Sales Status",
      "Location",
      "Contacted by",
      "Next step",
      "Follow-up",
      "People",
      "Prior activity",
      "Recorded platforms",
      "Messages recorded",
      "Notes",
    ],
  ];
  for (const c of s.tracker?.companies || []) {
    const entries = s.tracker!.touchpoints.filter((t) => t.companyId === c.id);
    const receipts = trackedReceipts(s, c);
    rows.push([
      c.name,
      c.poc,
      c.partnerStatus,
      c.story,
      c.ncp,
      c.salesStatus,
      c.location,
      c.owner,
      c.nextStep,
      c.followUp,
      c.people.map((p) => p.name).join("; "),
      hasReached(s, c) ? "Yes" : "Not recorded",
      [
        ...new Set([
          ...entries.map((t) => t.platform),
          ...receipts.map((r) => `${r.channel} (${r.status})`),
        ]),
      ].join("; "),
      [
        ...entries.map(
          (t) =>
            `${t.occurredAt || "Unknown date"} | ${t.actor} | ${t.contact || "Unknown contact"} | ${t.platform} | ${t.kind} | ${t.subject} | ${t.message || "Message not recorded"}`,
        ),
        ...receipts.map(
          (r) =>
            `${r.at} | ${r.snapshot.campaign.sender} | ${r.snapshot.prospect.contact} | ${r.channel} | ${r.status} | ${r.channel === "email" ? `${r.snapshot.prospect.subject}\n${r.snapshot.prospect.body}` : r.channel === "linkedin" ? r.snapshot.prospect.linkedinBody : JSON.stringify(r.snapshot.prospect.fields)}`,
        ),
      ].join("\n"),
      c.notes,
    ]);
  }
  return rows.map((row) => row.map(cell).join(",")).join("\r\n");
}
