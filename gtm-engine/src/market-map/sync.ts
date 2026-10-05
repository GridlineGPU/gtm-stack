import { merge } from "./merge";
import { loadConfig, loadSeed, segments } from "./seed";
import type { Store } from "./store";
import type { CompanyInput, MergeDiff, Run } from "./types";

/**
 * Bridge to the hosted web app (a claude.ai artifact with a shared document store).
 * The engine is the only writer of `companies`, `runs` and `meta`; the page writes `submissions` only.
 */

/** A manual add typed into the web app. */
export interface Submission {
  id: string;
  name: string;
  website?: string | null;
  handle?: string | null;
  segment?: string | null;
  note?: string | null;
  submitted_at?: string;
  status?: "new" | "merged" | "rejected";
  merged_into?: string | null;
}

export interface DbOp {
  op: "set" | "delete";
  path: string;
  data?: Record<string, unknown>;
}

/** Runs are trimmed for the page: the raw agent output stays local. */
function slimRun(r: Run) {
  const { log, ...rest } = r;
  const parsed = log ? JSON.parse(log) : null;
  return { ...rest, searched: parsed?.searched ?? [], gaps: parsed?.gaps ?? null };
}

export function exportOps(store: Store, opts: { runs?: number } = {}): DbOp[] {
  const seed = loadSeed();
  const cfg = loadConfig();
  const ops: DbOp[] = [
    {
      op: "set",
      path: "meta/map",
      data: {
        segments: segments(),
        company: { name: cfg.company, one_liner: cfg.one_liner, home_segment: cfg.home_segment, roles: cfg.roles },
        seed: {
          id: seed.id,
          title: seed.title,
          publisher: seed.publisher,
          author: seed.author,
          post_url: seed.post_url,
          image_url: seed.image_url,
          published: seed.published,
          upstream: seed.upstream,
          scope: seed.scope,
        },
        exported_at: new Date().toISOString(),
      },
    },
  ];
  for (const c of store.companies()) ops.push({ op: "set", path: `companies/${c.id}`, data: c as any });
  for (const r of store.runs().slice(0, opts.runs ?? 20)) ops.push({ op: "set", path: `runs/${r.id}`, data: slimRun(r) as any });
  return ops;
}

/** Merge new web-app submissions as manual adds. Returns the diff and the submission updates to write back. */
export function importSubmissions(store: Store, subs: Submission[]): { diff: MergeDiff; updates: DbOp[] } {
  const fresh = subs.filter((s) => (s.status ?? "new") === "new" && s.name?.trim());
  const inputs: CompanyInput[] = fresh.map((s) => ({
    name: s.name.trim(),
    website: s.website || null,
    handle: s.handle ? s.handle.replace(/^@/, "") : null,
    segment: s.segment || null,
    note: s.note || null,
  }));
  const diff = merge(store, inputs, { origin: "manual", overwrite: false });
  const byName = new Map(store.companies().map((c) => [c.name.toLowerCase(), c.id]));
  const updates: DbOp[] = fresh.map((s) => {
    const amb = diff.ambiguous.find((a) => a.name === s.name.trim());
    const added = diff.added.find((a) => a.name === s.name.trim());
    const merged_into = added?.id ?? byName.get(s.name.trim().toLowerCase()) ?? null;
    return {
      op: "set",
      path: `submissions/${s.id}`,
      data: { ...s, status: amb ? "new" : "merged", merged_into: amb ? null : merged_into, ambiguous_with: amb?.matches ?? null },
    };
  });
  return { diff, updates };
}
