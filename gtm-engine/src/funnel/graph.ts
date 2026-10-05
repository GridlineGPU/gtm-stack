import { readFileSync } from "node:fs";
import type { Edge, FunnelGraph, Issue, Lead, Level, Node, Objection } from "./types";

export function loadGraph(path = process.env.GTM_FUNNEL ?? "config/funnel.demand.json"): FunnelGraph {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function nodeMap(g: FunnelGraph): Map<string, Node> {
  return new Map(g.nodes.map((n) => [n.id, n]));
}

/** Every way out of a node: its exits plus the routes of objections raised there. */
export interface Out {
  id: string;
  to: string;
  kind: Edge["kind"] | "objection";
  segments?: string[];
}

export function outs(g: FunnelGraph, nodeId: string): Out[] {
  const n = nodeMap(g).get(nodeId);
  if (!n) return [];
  const exits: Out[] = n.exits.map((e) => ({ id: e.id, to: e.to, kind: e.kind, segments: e.segments }));
  const objs: Out[] = g.objections
    .filter((o) => o.at.includes(nodeId))
    .flatMap((o) => {
      const by = o.to_by_segment ?? {};
      const special = Object.keys(by);
      const rest = g.segments.map((s) => s.id).filter((s) => !special.includes(s));
      return [
        { id: o.id, to: o.to, kind: "objection" as const, ...(special.length ? { segments: rest } : {}) },
        ...special.map((s) => ({ id: o.id, to: by[s], kind: "objection" as const, segments: [s] })),
      ];
    });
  return [...exits, ...objs];
}

function allowed(seg: string | null, list?: string[]): boolean {
  return !seg || !list || list.includes(seg);
}

/**
 * BFS from the entry node over every edge and objection route: what a lead can reach.
 * With `segment`, nodes and edges closed to that segment are skipped. With `advanceOnly`, only forward progress counts.
 */
export function bfs(g: FunnelGraph, segment: string | null = null, advanceOnly = false): Map<string, number> {
  const nodes = nodeMap(g);
  const depth = new Map<string, number>([[g.entry, 0]]);
  const queue = [g.entry];
  while (queue.length) {
    const id = queue.shift()!;
    for (const o of outs(g, id)) {
      const to = nodes.get(o.to);
      if (advanceOnly && o.kind !== "advance") continue;
      if (!to || depth.has(o.to) || !allowed(segment, o.segments) || !allowed(segment, to.segments)) continue;
      depth.set(o.to, depth.get(id)! + 1);
      queue.push(o.to);
    }
  }
  return depth;
}

/**
 * A node's level: how many forward steps it takes to get there, BFS over advance edges only, so timeouts,
 * objections and nurture loops can't create shortcuts. Segments run their own BFS and the deepest wins, which
 * keeps one layered picture for all segments (a segment that skips stages gets a long forward edge).
 * Nodes no advance edge reaches (nurture, parked, lost) take their depth over all edges.
 */
export function depthOf(g: FunnelGraph): Map<string, number> {
  const depth = new Map<string, number>();
  const segs = g.segments.length ? g.segments.map((s) => s.id) : [null];
  for (const s of segs)
    for (const [id, d] of bfs(g, s, true)) depth.set(id, Math.max(depth.get(id) ?? 0, d));
  for (const [id, d] of bfs(g)) if (!depth.has(id)) depth.set(id, d);
  return depth;
}

export function levels(g: FunnelGraph): Level[] {
  const depth = depthOf(g);
  const by = new Map<number, string[]>();
  for (const n of g.nodes) {
    const d = depth.get(n.id);
    if (d === undefined) continue;
    by.set(d, [...(by.get(d) ?? []), n.id]);
  }
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([d, nodes]) => ({ depth: d, nodes }));
}

/** Edges that go to the same or a shallower level: retries, nurture loops, re-engagement. */
export function backEdges(g: FunnelGraph): { from: string; out: Out }[] {
  const depth = depthOf(g);
  const res: { from: string; out: Out }[] = [];
  for (const n of g.nodes)
    for (const o of outs(g, n.id)) {
      const a = depth.get(n.id), b = depth.get(o.to);
      if (a !== undefined && b !== undefined && b <= a) res.push({ from: n.id, out: o });
    }
  return res;
}

export function segmentOf(g: FunnelGraph, fields: Record<string, string | undefined>): string | null {
  for (const s of g.segments)
    if (Object.entries(s.match).every(([k, vals]) => vals.includes(String(fields[k] ?? "")))) return s.id;
  return null;
}

/** Structural checks. Errors make the graph unusable; warnings are gaps worth knowing about. */
export function validate(g: FunnelGraph): Issue[] {
  const issues: Issue[] = [];
  const err = (where: string, msg: string) => issues.push({ level: "error", where, msg });
  const warn = (where: string, msg: string) => issues.push({ level: "warn", where, msg });
  const nodes = nodeMap(g);
  const segIds = new Set(g.segments.map((s) => s.id));

  if (nodes.size !== g.nodes.length) err("nodes", "duplicate node ids");
  if (!nodes.has(g.entry)) err("entry", `entry node ${g.entry} does not exist`);
  const edgeIds = new Set<string>();
  const checkSegs = (where: string, list?: string[]) =>
    list?.forEach((s) => segIds.has(s) || err(where, `unknown segment ${s}`));

  for (const n of g.nodes) {
    checkSegs(n.id, n.segments);
    const terminal = n.kind === "won" || n.kind === "lost";
    if (terminal && n.exits.length) err(n.id, `${n.kind} node has exits`);
    if (!terminal && !n.exits.length) err(n.id, "non-terminal node has no exits");
    for (const e of n.exits) {
      if (edgeIds.has(e.id)) err(`${n.id}.${e.id}`, "duplicate edge id");
      edgeIds.add(e.id);
      if (!nodes.has(e.to)) err(`${n.id}.${e.id}`, `edge goes to missing node ${e.to}`);
      if (e.kind === "timeout" && !e.after_days) err(`${n.id}.${e.id}`, "timeout edge needs after_days");
      checkSegs(`${n.id}.${e.id}`, e.segments);
    }
    for (const m of n.messages) checkSegs(`${n.id}.${m.id}`, m.segments);
    if (n.kind === "stage" && !n.exits.some((e) => e.kind === "timeout") && n.id !== g.entry)
      warn(n.id, "no timeout edge: a lead that goes quiet here stays here forever");
  }

  for (const o of g.objections) {
    if (edgeIds.has(o.id)) err(o.id, "objection id collides with an edge id");
    if (!nodes.has(o.to)) err(o.id, `objection routes to missing node ${o.to}`);
    for (const [s, to] of Object.entries(o.to_by_segment ?? {})) {
      if (!segIds.has(s)) err(o.id, `unknown segment ${s}`);
      if (!nodes.has(to)) err(o.id, `objection routes ${s} to missing node ${to}`);
    }
    for (const a of o.at) if (!nodes.has(a)) err(o.id, `objection raised at missing node ${a}`);
    if (o.spawn && !nodes.has(o.spawn.node)) err(o.id, `spawn node ${o.spawn.node} does not exist`);
    if (!o.signals.length) warn(o.id, "no signals: classify can never suggest it");
  }

  const reached = bfs(g);
  for (const n of g.nodes) if (!reached.has(n.id)) err(n.id, "unreachable from entry");

  // Every segment needs its own road to a win, and every node must reach a terminal (no dead loops).
  const wins = g.nodes.filter((n) => n.kind === "won").map((n) => n.id);
  if (!wins.length) err("nodes", "no won node");
  for (const s of g.segments) {
    const seen = bfs(g, s.id);
    if (!wins.some((w) => seen.has(w))) err(`segment ${s.id}`, "no path from entry to a won node");
  }
  const terminals = new Set(g.nodes.filter((n) => n.kind === "won" || n.kind === "lost").map((n) => n.id));
  for (const n of g.nodes) {
    if (terminals.has(n.id)) continue;
    const seen = new Set([n.id]);
    const q = [n.id];
    let ok = false;
    while (q.length && !ok) for (const o of outs(g, q.shift()!)) {
      if (terminals.has(o.to)) { ok = true; break; }
      if (!seen.has(o.to)) { seen.add(o.to); q.push(o.to); }
    }
    if (!ok) err(n.id, "cannot reach any won or lost node");
  }

  const stagesWithout = g.nodes.filter((n) => n.kind === "stage" && n.id !== g.entry && !g.objections.some((o) => o.at.includes(n.id)));
  for (const n of stagesWithout) warn(n.id, "no objections mapped at this stage");
  return issues;
}

/** A signal matches as a whole phrase: "pass" must not hit "compass". */
function phrase(s: string): RegExp {
  return new RegExp(`(^|[^a-z0-9])${s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`);
}

/** Objections raised at `at` whose signals appear in the reply, best first. A suggestion for a human, not a move. */
export function classify(g: FunnelGraph, reply: string, at: string): { objection: Objection; hits: string[] }[] {
  const text = reply.toLowerCase();
  return g.objections
    .filter((o) => o.at.includes(at))
    .map((o) => ({ objection: o, hits: o.signals.filter((s) => phrase(s).test(text)) }))
    .filter((r) => r.hits.length)
    .sort((a, b) => b.hits.length - a.hits.length || (a.objection.status === "observed" ? -1 : 1));
}

/** Messages for a lead at a node: the segment-specific ones, else the general ones. */
export function messagesFor(g: FunnelGraph, nodeId: string, lead: Pick<Lead, "segment">) {
  const n = nodeMap(g).get(nodeId);
  if (!n) return [];
  const own = n.messages.filter((m) => m.segments?.includes(lead.segment));
  return own.length ? own : n.messages.filter((m) => !m.segments);
}
