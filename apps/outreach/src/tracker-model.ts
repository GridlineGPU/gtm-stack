import type { Prospect, State } from "./model";

export interface Person {
  id: string;
  name: string;
  role: string;
  bio: string;
  profile: string;
  referenceDraft: string;
  source: "artifact" | "sheet" | "research";
}
export interface TrackedCompany {
  emailResearch?: {
    website?: string;
    checkedAt: string;
    pages: { url: string; status: string | number }[];
    candidates: {
      address: string;
      kind: "team" | "person" | "unclassified";
      contact: string;
      source: string;
      checkedAt: string;
      excerpt: string;
    }[];
  };
  id: string;
  name: string;
  sheetName: string;
  region: string;
  location: string;
  poc: string;
  owner: string;
  salesStatus: string;
  partnerStatus: string;
  ncp: string;
  nextStep: string;
  followUp: string;
  notes: string;
  revision: number;
  summary: string;
  hook: string;
  routing: string;
  routes: Record<string, string>;
  story: string;
  artifactSource: string;
  sheetSource: string;
  sheetRow: number;
  sheetValues: Record<string, string>;
  people: Person[];
  knownPriorContact: boolean;
}
export const platforms = [
  "linkedin",
  "email",
  "application",
  "phone",
  "meeting",
  "other",
  "unknown",
] as const;
export const activityKinds = ["sent", "reply", "applied", "meeting", "note", "opted_out"] as const;
export interface Touchpoint {
  id: string;
  companyId: string;
  contact: string;
  actor: string;
  platform: (typeof platforms)[number];
  kind: (typeof activityKinds)[number];
  occurredAt: string;
  recordedAt: string;
  subject: string;
  message: string;
  evidence: string;
}
export interface Tracker {
  sheetSync?: {
    checkedAt: string;
    changed: number;
    added: number;
    peopleAdded: number;
    conflicts: {
      companyId: string;
      company: string;
      field: string;
      local: string;
      sheet: string;
    }[];
    missing: string[];
  };
  sourceVersion: string;
  importedAt: string;
  companies: TrackedCompany[];
  touchpoints: Touchpoint[];
}
// Set on the server from source.json; the client bundle matches by companyId instead.
let companyAliases: Record<string, string> = {};
export function setCompanyAliases(aliases: Record<string, string>) {
  companyAliases = Object.fromEntries(
    Object.entries(aliases).map(([from, to]) => [from.trim().toLowerCase(), to]),
  );
}
export function companyKey(name: string): string {
  return (companyAliases[name.trim().toLowerCase()] || name)
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

const genericCompanyWords = new Set([
  "ai",
  "cloud",
  "compute",
  "data",
  "group",
  "holding",
  "holdings",
  "services",
  "technologies",
]);

export function inferCompanyDomain(c: TrackedCompany): string {
  if (c.emailResearch?.website)
    return new URL(c.emailResearch.website).hostname.replace(/^www\./, "");
  const tokens = c.name
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 2 && !genericCompanyWords.has(token));
  const candidates: { domain: string; score: number }[] = [];
  for (const [route, value] of Object.entries(c.routes)) {
    for (const match of value.matchAll(
      /(?:https?:\/\/)?(?:[\w.+-]+@)?(?:www\.)?([a-z0-9][a-z0-9.-]*\.[a-z]{2,})(?=\/|\b)/gi,
    )) {
      const host = match[1].toLowerCase();
      const parts = host.split(".");
      const countrySuffix = /^(?:co|com|net|org|gov|edu|ac|ad)\.[a-z]{2}$/.test(
        parts.slice(-2).join("."),
      );
      const domain = parts.slice(countrySuffix ? -3 : -2).join(".");
      const routeScore = route === "partner" ? 30 : route === "email" ? 20 : 10;
      const nameScore = tokens.reduce(
        (score, token) => score + (domain.replace(/[^a-z0-9]/g, "").includes(token) ? 100 : 0),
        0,
      );
      candidates.push({ domain, score: routeScore + nameScore });
    }
  }
  return candidates.sort((a, b) => b.score - a.score)[0]?.domain || "";
}
export function matchCompany(s: State, p: Prospect): TrackedCompany | undefined {
  return s.tracker?.companies.find(
    (c) => c.id === p.companyId || companyKey(c.name) === companyKey(p.company),
  );
}
export function hasPriorActivity(c: TrackedCompany): boolean {
  return (
    c.knownPriorContact ||
    (!!c.sheetValues.F?.trim() && !/^prospecting$/i.test(c.sheetValues.F)) ||
    /^applied$/i.test(c.sheetValues.C || "") ||
    (!!c.salesStatus.trim() && !/^prospecting$/i.test(c.salesStatus)) ||
    /^applied$/i.test(c.partnerStatus)
  );
}
export function trackedReceipts(s: State, c: TrackedCompany) {
  return s.receipts.filter(
    (r) => r.mode === "live" && matchCompany(s, r.snapshot.prospect)?.id === c.id,
  );
}
export function hasReached(s: State, c: TrackedCompany): boolean {
  return (
    hasPriorActivity(c) ||
    !!s.tracker?.touchpoints.some((t) => t.companyId === c.id && t.kind !== "note") ||
    trackedReceipts(s, c).some((r) => ["accepted", "submitted"].includes(r.status))
  );
}
export function needsHistory(s: State, c: TrackedCompany): boolean {
  return (
    hasPriorActivity(c) &&
    !s.tracker?.touchpoints.some(
      (t) =>
        t.companyId === c.id &&
        t.kind !== "note" &&
        t.platform !== "unknown" &&
        !!t.message &&
        !!t.occurredAt,
    )
  );
}
