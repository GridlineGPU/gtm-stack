import { findMatches, keysOf, norm, slug, splitName } from "./match";
import { now, type Store } from "./store";
import { FACT_FIELDS, type Company, type CompanyInput, type MergeDiff, type Origin, type Status } from "./types";

export function emptyDiff(): MergeDiff {
  return { added: [], filled: [], changed: [], skipped_locked: [], proposed: [], appended: [], ambiguous: [], unchanged: [] };
}

function blank(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === "string" && v.trim() === "");
}

function uniqueId(name: string, taken: Set<string>): string {
  const base = slug(name) || "company";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

function unionBy<T>(a: T[], b: T[] | undefined, key: (x: T) => string): { out: T[]; added: number } {
  const seen = new Set(a.map(key));
  const out = [...a];
  let added = 0;
  for (const x of b ?? []) {
    const k = key(x);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(x);
    added++;
  }
  return { out, added };
}

export function newCompany(input: CompanyInput, id: string, origin: Origin, status: Status): Company {
  const t = now();
  return {
    id,
    name: input.name.trim(),
    aliases: input.aliases ?? [],
    handle: input.handle ?? null,
    website: input.website ?? null,
    segment: input.segment ?? null,
    role: input.role ?? "unknown",
    role_status: input.role_status ?? "hypothesis",
    one_liner: input.one_liner ?? null,
    brief: input.brief ?? null,
    pricing_model: input.pricing_model ?? null,
    funding: input.funding ?? null,
    hq: input.hq ?? null,
    founded: input.founded ?? null,
    people: input.people ?? [],
    evidence: input.evidence ?? [],
    sources: input.sources ?? [],
    origin,
    status,
    locked: [],
    note: input.note ?? null,
    first_seen: t,
    updated_at: t,
  };
}

export interface MergeOptions {
  origin: Origin;
  /** Status for companies that don't exist yet. Agent discoveries default to candidate so the founder accepts them. */
  newStatus?: Status;
  /** When false, existing non-empty unlocked fields are left alone and only blanks get filled. */
  overwrite?: boolean;
}

/**
 * Merge inputs into the store. Never overwrites a locked field, never renames a company
 * (an incoming different name becomes an alias), never merges an input that matches two companies.
 */
export function merge(store: Store, inputs: CompanyInput[], opts: MergeOptions): MergeDiff {
  const diff = emptyDiff();
  const newStatus = opts.newStatus ?? (opts.origin === "agent" ? "candidate" : opts.origin === "manual" ? "pending" : "active");
  const overwrite = opts.overwrite ?? true;

  store.tx(() => {
    const all = store.companies();
    const taken = new Set(all.map((c) => c.id));

    for (const input of inputs) {
      if (!input?.name || !input.name.trim()) continue;
      const matches = findMatches(input, all);

      if (matches.length > 1) {
        diff.ambiguous.push({ name: input.name, matches: matches.map((m) => m.id) });
        continue;
      }

      if (matches.length === 0) {
        // "GPU.ai (BitCore AI Ltd.)" is stored as "GPU.ai" with the parenthetical kept as an alias.
        const { base, extra } = splitName(input.name);
        // The full spelling stays as an alias so matching keeps treating the parenthetical as an extra, never as a name.
        const clean = { ...input, name: base || input.name, aliases: [...(input.aliases ?? []), ...(extra ? [input.name] : [])] };
        const c = newCompany(clean, uniqueId(clean.name, taken), opts.origin, newStatus);
        taken.add(c.id);
        all.push(c);
        store.putCompany(c);
        diff.added.push({ id: c.id, name: c.name, status: c.status });
        continue;
      }

      const c: Company = structuredClone(matches[0]);
      let touched = false;

      for (const f of FACT_FIELDS) {
        const incoming = (input as any)[f];
        if (blank(incoming)) continue;
        const current = (c as any)[f];
        if (current === incoming) continue;
        if (f === "role" && incoming === "unknown") continue;
        const change = { id: c.id, field: f, old: current, new: incoming };
        const locked = c.locked.includes(f) || (f === "role" && c.role_status === "confirmed");
        if (locked) {
          if (!blank(current)) diff.skipped_locked.push(change);
          continue;
        }
        if (blank(current) || (f === "role" && current === "unknown")) {
          (c as any)[f] = incoming;
          diff.filled.push(change);
          touched = true;
        } else if (opts.origin === "agent" && (f === "segment" || f === "role")) {
          diff.proposed.push(change);
        } else if (overwrite) {
          (c as any)[f] = incoming;
          diff.changed.push(change);
          touched = true;
        }
      }

      // A different spelling of the name is kept as an alias.
      const known = keysOf(c).names;
      const spellings = [input.name, ...(input.aliases ?? [])];
      const have = new Set(c.aliases.map(norm));
      const newAliases = spellings.filter((a) => a && !have.has(norm(a)) && !known.has(norm(a)) && norm(a) !== norm(c.name));
      const lists: [keyof Company, unknown[] | undefined, (x: any) => string][] = [
        ["aliases", newAliases, (x: string) => norm(x)],
        ["people", input.people, (p) => norm(p.name ?? "")],
        ["evidence", input.evidence, (e) => `${e.url}|${norm(e.text ?? "").slice(0, 80)}`],
        ["sources", input.sources, (s) => s.url],
      ];
      for (const [field, incoming, key] of lists) {
        if (c.locked.includes(field as string)) continue;
        const { out, added } = unionBy((c as any)[field], incoming as any[], key);
        if (added > 0) {
          (c as any)[field] = out;
          diff.appended.push({ id: c.id, field: field as string, count: added });
          touched = true;
        }
      }

      // A manual add that enrichment has now filled in joins the map.
      if (c.status === "pending" && opts.origin === "agent" && !blank(c.one_liner)) {
        diff.changed.push({ id: c.id, field: "status", old: "pending", new: "active" });
        c.status = "active";
        touched = true;
      }

      if (touched) {
        c.updated_at = now();
        store.putCompany(c);
        const i = all.findIndex((x) => x.id === c.id);
        all[i] = c;
      } else {
        diff.unchanged.push(c.id);
      }
    }
  });

  return diff;
}

/** A person's edit. Always wins, and locks the field against future agent runs unless `lock` is false. */
export function editCompany(store: Store, id: string, patch: Record<string, unknown>, lock = true): Company {
  const c = store.company(id);
  if (!c) throw new Error(`No company with id "${id}".`);
  const allowed = new Set<string>([...FACT_FIELDS, "status", "role_status", "note", "name", "aliases", "people"]);
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.has(k)) throw new Error(`Field "${k}" can't be edited.`);
    (c as any)[k] = v;
    if (lock && (FACT_FIELDS as readonly string[]).includes(k) && !c.locked.includes(k)) c.locked.push(k);
  }
  if (patch.role !== undefined && lock) c.role_status = "confirmed";
  c.updated_at = now();
  store.putCompany(c);
  return c;
}

/**
 * Fold companies the agent or a person added twice into the one already in the map.
 * A duplicate is a candidate or pending company that now matches exactly one other company.
 */
export function foldDuplicates(store: Store): { folded: { from: string; into: string }[]; diff: MergeDiff } {
  const folded: { from: string; into: string }[] = [];
  const total = emptyDiff();
  for (const dup of store.companies().filter((c) => c.status === "candidate" || c.status === "pending")) {
    const others = store.companies().filter((c) => c.id !== dup.id);
    const hits = findMatches(dup, others);
    if (hits.length !== 1) continue;
    const { id, first_seen, updated_at, locked, origin, status, ...input } = dup;
    store.deleteCompany(dup.id);
    const d = merge(store, [input], { origin, overwrite: false });
    folded.push({ from: dup.id, into: hits[0].id });
    for (const k of Object.keys(total) as (keyof MergeDiff)[]) (total[k] as unknown[]).push(...(d[k] as unknown[]));
  }
  return { folded, diff: total };
}
