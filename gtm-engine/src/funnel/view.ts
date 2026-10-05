import { readFileSync } from "node:fs";
import { backEdges, depthOf, levels, validate } from "./graph";
import { stats, type Trace } from "./trace";
import type { FunnelGraph } from "./types";

/** Everything the graph view needs; leads only with `withLeads`, since they are real people. */
export function exportView(t: Trace, g: FunnelGraph, withLeads = false) {
  const depth = depthOf(g);
  const lv = levels(g);
  const s = stats(t, g, depth);
  return {
    graph: g,
    levels: lv,
    depth: Object.fromEntries(depth),
    back_edges: backEdges(g).map((b) => ({ from: b.from, id: b.out.id, to: b.out.to, kind: b.out.kind })),
    issues: validate(g),
    stats: s,
    generated_at: new Date().toISOString(),
    ...(withLeads
      ? { leads: t.leads(g.id).map((l) => ({ ...l, at: t.current(g.id, l.id) ?? g.entry, events: t.events(g.id, l.id) })) }
      : {}),
  };
}

/** web/funnel.html with the export spliced in, so it renders without the engine running. */
export function viewPage(data: unknown, template = "web/funnel.html"): string {
  const json = JSON.stringify(data).replaceAll("<", "\\u003c");
  return readFileSync(template, "utf8").replace("__FUNNEL_DATA__", () => json);
}
