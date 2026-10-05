export type Role = "competitor" | "supplier" | "partner" | "adjacent" | "buyer" | "unknown";
export type Origin = "seed" | "agent" | "manual";
/** active: in the map. pending: manual add awaiting enrichment. candidate: agent found it, founder hasn't accepted. rejected: kept so re-runs don't re-add it. */
export type Status = "active" | "pending" | "candidate" | "rejected";

export interface Person {
  name: string;
  title?: string;
  url?: string;
}

export interface Evidence {
  text: string;
  url: string;
  date?: string;
  source_id?: string;
}

export interface SourceRef {
  url: string;
  title?: string;
  accessed?: string;
}

/** Fields an agent or a person may set. Anything listed in `locked` is never overwritten by a merge. */
export const FACT_FIELDS = [
  "website",
  "handle",
  "segment",
  "role",
  "one_liner",
  "brief",
  "pricing_model",
  "funding",
  "hq",
  "founded",
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

export interface Company {
  id: string;
  name: string;
  aliases: string[];
  handle: string | null;
  website: string | null;
  segment: string | null;
  role: Role;
  role_status: "hypothesis" | "confirmed";
  one_liner: string | null;
  brief: string | null;
  pricing_model: string | null;
  funding: string | null;
  hq: string | null;
  founded: string | null;
  people: Person[];
  evidence: Evidence[];
  sources: SourceRef[];
  origin: Origin;
  status: Status;
  locked: string[];
  note: string | null;
  first_seen: string;
  updated_at: string;
}

/** What an agent run or a manual add hands to merge. Only `name` is required. */
export type CompanyInput = Partial<Omit<Company, "id" | "first_seen" | "updated_at" | "locked">> & {
  name: string;
};

export interface FieldChange {
  id: string;
  field: string;
  old: unknown;
  new: unknown;
}

export interface MergeDiff {
  added: { id: string; name: string; status: Status }[];
  filled: FieldChange[];
  changed: FieldChange[];
  skipped_locked: FieldChange[];
  /** Agent disagreed with a segment or role already set. Shown to the founder, not applied. */
  proposed: FieldChange[];
  appended: { id: string; field: string; count: number }[];
  ambiguous: { name: string; matches: string[] }[];
  unchanged: string[];
}

export interface RecallReport {
  segment: string | null;
  seed_total: number;
  found: number;
  recall: number;
  missing: string[];
  new_names: string[];
  contaminated: boolean;
  contamination_urls: string[];
}

export interface Run {
  id: string;
  kind: "seed" | "ingest" | "manual" | "discover" | "enrich" | "sync";
  segment: string | null;
  blind: boolean;
  started_at: string;
  finished_at: string | null;
  status: "running" | "done" | "failed";
  error: string | null;
  input_count: number;
  diff: MergeDiff | null;
  recall: RecallReport | null;
  cost_usd: number | null;
  log: string | null;
}

export interface Segment {
  id: string;
  label: string;
  note?: string;
}
