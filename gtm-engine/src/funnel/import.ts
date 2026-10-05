import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { segmentOf } from "./graph";
import { move, place, type Trace } from "./trace";
import type { FunnelGraph, Lead } from "./types";

/** A researched company as the outreach lists store it: company fields plus its people. */
export interface CompanyInput {
  name: string;
  people: { name: string; title?: string; role?: string }[];
  [field: string]: unknown;
}

/** Same id the outreach page uses for a person, so tracker rows line up: co-<slug>-p<index>. */
export function leadId(company: string, index: number): string {
  return "co-" + company.toLowerCase().replace(/[^a-z0-9]+/g, "-") + "-p" + index;
}

export function toLeads(g: FunnelGraph, companies: CompanyInput[]): { leads: Lead[]; unsegmented: string[] } {
  const spec = g.import ?? { lead_fields: [] };
  const leads: Lead[] = [];
  const unsegmented: string[] = [];
  for (const c of companies) {
    const fields: Record<string, string> = {};
    for (const f of spec.lead_fields) if (c[f] != null) fields[f] = String(c[f]);
    for (const [k, d] of Object.entries(spec.derive ?? {})) {
      const v = d.map[String(c[d.from] ?? "")];
      if (v) fields[k] = v;
    }
    const segment = segmentOf(g, fields);
    if (!segment) {
      unsegmented.push(c.name);
      continue;
    }
    c.people.forEach((p, i) =>
      leads.push({ id: leadId(c.name, i), name: p.name, company: c.name, title: p.title, segment, fields: { ...fields, ...(p.role ? { role: p.role } : {}) } }),
    );
  }
  return { leads, unsegmented };
}

/** Read a folder of <doc_id>.json files as the document store saves them ({id, data} or a bare object). */
function readCollection(dir: string): Map<string, any> {
  const out = new Map<string, any>();
  if (!existsSync(dir)) return out;
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const raw = JSON.parse(readFileSync(join(dir, f), "utf8"));
    out.set(f.replace(/\.json$/, ""), raw.data ?? raw);
  }
  return out;
}

export interface ImportResult {
  leads: number;
  requested: number;
  parked: number;
  staged: number;
  unknown: string[];
  skipped: number;
  /** Tracker rows that changed after the lead was traced and that import won't apply on its own. */
  changed: string[];
}

/**
 * Turn tracker rows into events. `done` holds the first touch (connection, inmail, later), `sent` the text that
 * went out, `stage` a hand-set funnel stage. Idempotent, and never undoes a move logged after the row:
 * - a lead with events keeps its first touch, except a parked lead the tracker now shows as contacted (unparked);
 * - a stage row applies only when it is newer than the lead's last event.
 */
export function importTracker(t: Trace, g: FunnelGraph, dir: string): ImportResult {
  const spec = g.import ?? { lead_fields: [] };
  const done = readCollection(join(dir, "done"));
  const sent = readCollection(join(dir, "sent"));
  const stage = readCollection(join(dir, "stage"));
  const res: ImportResult = { leads: 0, requested: 0, parked: 0, staged: 0, unknown: [], skipped: 0, changed: [] };

  t.tx(() => {
    for (const [id, row] of done) {
      const lead = t.lead(g.id, id);
      if (!lead) { res.unknown.push(id); continue; }
      const status = row.status ?? row.method;
      const edge = spec.status?.[status];
      if (!edge) { res.unknown.push(`${id} (status ${status})`); continue; }
      const text = sent.get(id)?.text?.trim();
      const evs = t.events(g.id, id);
      if (evs.length) {
        const first = evs[0].note?.match(/^imported from tracker: (\w+)/)?.[1];
        const cur = t.current(g.id, id);
        const unparkable = cur && cur !== g.entry && g.nodes.find((n) => n.id === cur)?.exits.find((e) => e.to === g.entry && e.kind === "reengage");
        if (edge !== "park" && first && spec.status?.[first] === "park" && unparkable) {
          const at = new Date(row.at).toISOString();
          move(t, g, { lead: id, via: unparkable.id, at, note: `tracker changed: ${first} -> ${status}` });
          move(t, g, { lead: id, via: edge, at, ...(text && text !== "NA" ? { message: text } : {}), note: `imported from tracker: ${status}` });
          res.requested++;
        } else if (first && first !== status && spec.status?.[first] !== edge) res.changed.push(`${id} (${first} -> ${status})`);
        else res.skipped++;
        continue;
      }
      move(t, g, {
        lead: id, via: edge, at: new Date(row.at).toISOString(),
        ...(text && text !== "NA" ? { message: text } : {}),
        note: `imported from tracker: ${status}${row.method && row.method !== status ? ` via ${row.method}` : ""}`,
      });
      if (edge === "park") res.parked++;
      else res.requested++;
    }
    for (const [id, row] of stage) {
      const lead = t.lead(g.id, id);
      if (!lead || !row.stage) { res.unknown.push(id); continue; }
      const m = spec.stage?.[row.stage];
      const node = typeof m === "string" ? m : m?.[lead.segment];
      if (!node) { res.unknown.push(`${id} (stage ${row.stage})`); continue; }
      if (t.current(g.id, id) === node) continue;
      const last = t.events(g.id, id).at(-1);
      const at = row.at ? new Date(row.at).toISOString() : null;
      if (last && (!at || at <= last.at)) {
        res.changed.push(`${id} (stage ${row.stage} is older than the trace; trace kept at ${t.current(g.id, id)})`);
        continue;
      }
      place(t, g, id, node, { import: `stage ${row.stage}` }, at ?? undefined);
      res.staged++;
    }
  });
  res.leads = t.leads(g.id).length;
  return res;
}
