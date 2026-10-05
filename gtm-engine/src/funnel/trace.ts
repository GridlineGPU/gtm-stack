import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { nodeMap, outs } from "./graph";
import type { EventVia, FunnelGraph, Lead, TraceEvent } from "./types";

/**
 * Leads and their append-only event log. Real people live only here, under data/ (gitignored);
 * the graph in config/ holds no one.
 */
export class Trace {
  db: Database;

  constructor(path = process.env.GTM_TRACE ?? "data/funnel.sqlite") {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path, { create: true });
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS leads (id TEXT PRIMARY KEY, graph TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, graph TEXT NOT NULL, lead TEXT NOT NULL, at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS events_lead ON events (graph, lead, id);
    `);
  }

  putLead(graph: string, l: Lead) {
    this.db.query("INSERT OR REPLACE INTO leads (id, graph, data) VALUES (?, ?, ?)").run(l.id, graph, JSON.stringify(l));
  }

  lead(graph: string, id: string): Lead | null {
    const r: any = this.db.query("SELECT data FROM leads WHERE graph = ? AND id = ?").get(graph, id);
    return r ? JSON.parse(r.data) : null;
  }

  leads(graph: string): Lead[] {
    return this.db.query("SELECT data FROM leads WHERE graph = ? ORDER BY id").all(graph).map((r: any) => JSON.parse(r.data));
  }

  events(graph: string, lead?: string): TraceEvent[] {
    const rows = lead
      ? this.db.query("SELECT id, data FROM events WHERE graph = ? AND lead = ? ORDER BY id").all(graph, lead)
      : this.db.query("SELECT id, data FROM events WHERE graph = ? ORDER BY id").all(graph);
    return rows.map((r: any) => ({ ...JSON.parse(r.data), id: r.id }));
  }

  current(graph: string, lead: string): string | null {
    const r: any = this.db.query("SELECT data FROM events WHERE graph = ? AND lead = ? ORDER BY id DESC LIMIT 1").get(graph, lead);
    return r ? JSON.parse(r.data).to : null;
  }

  append(graph: string, e: Omit<TraceEvent, "id">): TraceEvent {
    const r: any = this.db
      .query("INSERT INTO events (graph, lead, at, data) VALUES (?, ?, ?, ?) RETURNING id")
      .get(graph, e.lead, e.at, JSON.stringify(e));
    return { ...e, id: r.id };
  }

  tx<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}

export interface Move {
  lead: string;
  /** An edge id or objection id out of the lead's current node. */
  via: string;
  at?: string;
  message?: string;
  reply?: string;
  note?: string;
}

/**
 * Move a lead along one edge or objection out of its current node. Refuses moves the graph doesn't have,
 * so the log can only ever hold paths that exist. A lead with no events starts at the entry node.
 */
export function move(t: Trace, g: FunnelGraph, m: Move): { event: TraceEvent; spawn?: { node: string; note: string } } {
  const lead = t.lead(g.id, m.lead);
  if (!lead) throw new Error(`No lead ${m.lead}.`);
  const from = t.current(g.id, m.lead) ?? g.entry;
  const open = outs(g, from).filter((o) => !o.segments || o.segments.includes(lead.segment));
  const out = open.find((o) => o.id === m.via);
  if (!out) {
    const options = [...new Set(open.map((o) => o.id))].join(", ");
    throw new Error(`${m.via} is not a way out of ${from} for segment ${lead.segment}. Options: ${options || "none (terminal)"}.`);
  }
  const to = nodeMap(g).get(out.to)!;
  if (to.segments && !to.segments.includes(lead.segment)) throw new Error(`${to.id} is closed to segment ${lead.segment}.`);
  const via: EventVia = out.kind === "objection" ? { objection: out.id } : { edge: out.id };
  const event = t.append(g.id, {
    lead: m.lead, at: m.at ?? new Date().toISOString(), from, to: out.to, via,
    ...(m.message ? { message: m.message } : {}), ...(m.reply ? { reply: m.reply } : {}), ...(m.note ? { note: m.note } : {}),
  });
  const obj = out.kind === "objection" ? g.objections.find((o) => o.id === out.id) : undefined;
  return { event, spawn: obj?.spawn };
}

/** Put a lead at a node without an edge (imports, corrections). Recorded as such, so stats can leave it out. */
export function place(t: Trace, g: FunnelGraph, lead: string, node: string, via: EventVia, at?: string, extra: Partial<TraceEvent> = {}) {
  if (!nodeMap(g).has(node)) throw new Error(`No node ${node}.`);
  return t.append(g.id, { lead, at: at ?? new Date().toISOString(), from: t.current(g.id, lead), to: node, via, ...extra });
}

export interface Stats {
  leads: number;
  /** Leads sitting at each node now. */
  now: Record<string, number>;
  /** Leads that ever reached each node. */
  reached: Record<string, number>;
  /** Times each edge or objection was taken. */
  taken: Record<string, number>;
  /** Of the leads that reached a node, how many later reached a deeper stage (off-ramps don't count). */
  conversion: Record<string, { reached: number; moved_on: number }>;
  /** Objections seen in traces, with the stage they were raised at. */
  objections: { id: string; at: string; count: number }[];
}

export function stats(t: Trace, g: FunnelGraph, depth: Map<string, number>): Stats {
  const leads = t.leads(g.id);
  const evs = t.events(g.id);
  const byLead = new Map<string, TraceEvent[]>();
  for (const e of evs) byLead.set(e.lead, [...(byLead.get(e.lead) ?? []), e]);
  const now: Record<string, number> = {};
  const reached: Record<string, number> = {};
  const taken: Record<string, number> = {};
  const moved: Record<string, number> = {};
  const objs = new Map<string, number>();

  for (const l of leads) {
    const path = byLead.get(l.id) ?? [];
    const nodes = [g.entry, ...path.map((e) => e.to)];
    const cur = nodes[nodes.length - 1];
    now[cur] = (now[cur] ?? 0) + 1;
    const seen = new Set(nodes);
    for (const n of seen) reached[n] = (reached[n] ?? 0) + 1;
    // Progress means reaching a deeper stage; dropping into nurture or out of the funnel never counts.
    const kind = new Map(g.nodes.map((n) => [n.id, n.kind]));
    const progress = (n: string) => kind.get(n) === "stage" || kind.get(n) === "won";
    const maxAfter = (i: number) => Math.max(-1, ...nodes.slice(i + 1).filter(progress).map((n) => depth.get(n) ?? -1));
    const counted = new Set<string>();
    nodes.forEach((n, i) => {
      if (!counted.has(n) && maxAfter(i) > (depth.get(n) ?? 0)) {
        moved[n] = (moved[n] ?? 0) + 1;
        counted.add(n);
      }
    });
    for (const e of path) {
      if ("edge" in e.via) taken[e.via.edge] = (taken[e.via.edge] ?? 0) + 1;
      if ("objection" in e.via) {
        taken[e.via.objection] = (taken[e.via.objection] ?? 0) + 1;
        const k = `${e.via.objection}@${e.from}`;
        objs.set(k, (objs.get(k) ?? 0) + 1);
      }
    }
  }
  const conversion = Object.fromEntries(g.nodes.map((n) => [n.id, { reached: reached[n.id] ?? 0, moved_on: moved[n.id] ?? 0 }]));
  const objections = [...objs.entries()]
    .map(([k, count]) => ({ id: k.split("@")[0], at: k.split("@")[1], count }))
    .sort((a, b) => b.count - a.count);
  return { leads: leads.length, now, reached, taken, conversion, objections };
}

/** Fill {First}, {Company} and {Company's} in a message template. */
export function render(text: string, lead: Pick<Lead, "name" | "company" | "fields">): string {
  const first = lead.name.replace(/^Dr\.\s+/, "").split(/\s+/)[0];
  const co = lead.company.split(" (")[0];
  const poss = co + (co.endsWith("s") ? "'" : "'s");
  let out = text.replaceAll("{First}", first).replaceAll("{Company's}", poss).replaceAll("{Company}", co);
  for (const [k, v] of Object.entries(lead.fields ?? {})) out = out.replaceAll(`{${k}}`, v);
  return out;
}
