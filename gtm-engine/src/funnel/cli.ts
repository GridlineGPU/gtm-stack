#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { backEdges, classify, depthOf, levels, loadGraph, messagesFor, nodeMap, outs, validate } from "./graph";
import { importTracker, toLeads, type CompanyInput } from "./import";
import { move, place, render, stats, Trace } from "./trace";
import { exportView, viewPage } from "./view";
import type { FunnelGraph, Lead } from "./types";

const USAGE = `gtm funnel: a GTM pipeline as a BFS graph, with objections at every level and a trace per lead

  bun run funnel validate                  check the graph (reachability, routes, segments)
  bun run funnel levels                    print the graph level by level, with objections and back-edges
  bun run funnel leads <companies.json>    load leads from a researched outreach list
  bun run funnel import <dir>              turn tracker rows (done/, sent/, stage/ folders) into events
  bun run funnel next <lead>               where a lead is, what to send, ways out, objections to expect
  bun run funnel classify <lead> "<reply>" which objections a reply looks like (suggestion only)
  bun run funnel log <lead> <edge|objection> [--reply TEXT] [--message TEXT] [--note TEXT] [--at ISO]
                                           [--referral NAME --referral-title TITLE]
  bun run funnel set <lead> <node> --note TEXT   correct a lead's position (kept out of edge counts)
  bun run funnel path <lead>               the lead's whole trace
  bun run funnel due                       leads whose timeout has passed: send the follow-up or move them
  bun run funnel stats                     counts per node, conversion per level, objections seen
  bun run funnel export [--out FILE] [--with-leads]   graph + levels + stats as JSON for the web view
  bun run funnel page [--out FILE]         the graph view as one HTML file with counts only (no people)
  bun run serve                            local app at http://127.0.0.1:4320/funnel, with lead tracing

  GTM_FUNNEL=config/funnel.<name>.json picks the graph; GTM_TRACE picks the trace database.
`;

function flags(args: string[]): { pos: string[]; f: Record<string, string | true> } {
  const pos: string[] = [];
  const f: Record<string, string | true> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const next = args[i + 1];
      if (next === undefined || next.startsWith("--")) f[a.slice(2)] = true;
      else f[a.slice(2)] = args[++i];
    } else pos.push(a);
  }
  return { pos, f };
}

function needLead(t: Trace, g: FunnelGraph, id?: string): Lead {
  if (!id) throw new Error("Give a lead id (co-<company>-p<n>).");
  const l = t.lead(g.id, id);
  if (!l) throw new Error(`No lead ${id}. Load leads first with \`funnel leads\`.`);
  return l;
}

function daysSince(iso: string): number {
  return (Date.now() - Date.parse(iso)) / 86_400_000;
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, f } = flags(rest);
  const g = loadGraph();
  const t = new Trace();
  const nodes = nodeMap(g);

  switch (cmd) {
    case "validate": {
      const issues = validate(g);
      for (const i of issues) console.log(`${i.level === "error" ? "ERROR" : "warn "}  ${i.where}: ${i.msg}`);
      const errors = issues.filter((i) => i.level === "error").length;
      console.log(`${g.name}: ${g.nodes.length} nodes, ${g.objections.length} objections, ${errors} errors, ${issues.length - errors} warnings`);
      if (errors) process.exit(1);
      break;
    }
    case "levels": {
      const backs = new Set(backEdges(g).map((b) => `${b.from}>${b.out.id}>${b.out.to}`));
      for (const l of levels(g)) {
        console.log(`\nLevel ${l.depth}`);
        for (const id of l.nodes) {
          const n = nodes.get(id)!;
          console.log(`  [${n.id}] ${n.label}${n.segments ? `  (${n.segments.join(", ")})` : ""}`);
          for (const o of outs(g, id)) {
            if (o.kind === "objection") continue;
            const back = backs.has(`${id}>${o.id}>${o.to}`) ? "  ↺" : "";
            console.log(`      ${o.kind.padEnd(10)} ${o.id} -> ${o.to}${o.segments ? ` (${o.segments.join(", ")})` : ""}${back}`);
          }
          for (const ob of g.objections.filter((o) => o.at.includes(id)))
            console.log(`      objection  ${ob.id} [${ob.status}] -> ${ob.to}${ob.to_by_segment ? ` ${JSON.stringify(ob.to_by_segment)}` : ""}`);
        }
      }
      break;
    }
    case "leads": {
      if (!pos[0]) throw new Error("Give a companies JSON file (array of {name, people[], ...fields}).");
      const raw = JSON.parse(readFileSync(pos[0], "utf8"));
      const companies: CompanyInput[] = Array.isArray(raw) ? raw : raw.companies;
      const { leads, unsegmented } = toLeads(g, companies);
      t.tx(() => leads.forEach((l) => t.putLead(g.id, l)));
      const bySeg = leads.reduce<Record<string, number>>((a, l) => ({ ...a, [l.segment]: (a[l.segment] ?? 0) + 1 }), {});
      console.log(`${leads.length} leads from ${companies.length - unsegmented.length} companies: ${Object.entries(bySeg).map(([k, v]) => `${k} ${v}`).join(", ")}`);
      if (unsegmented.length) console.log(`  no segment (skipped): ${unsegmented.join(", ")}`);
      break;
    }
    case "import": {
      if (!pos[0]) throw new Error("Give the tracker folder (with done/, sent/, stage/ inside).");
      const r = importTracker(t, g, pos[0]);
      console.log(`requested ${r.requested} · parked ${r.parked} · staged ${r.staged} · already traced ${r.skipped} · leads ${r.leads}`);
      if (r.unknown.length) console.log(`  not matched: ${r.unknown.join(", ")}`);
      if (r.changed.length) console.log(`  changed in tracker, not applied (log these by hand):\n    ${r.changed.join("\n    ")}`);
      break;
    }
    case "next": {
      const l = needLead(t, g, pos[0]);
      const at = t.current(g.id, l.id) ?? g.entry;
      const n = nodes.get(at)!;
      const last = t.events(g.id, l.id).at(-1);
      console.log(`${l.name}, ${l.title ?? ""} at ${l.company}  [${l.segment}]`);
      console.log(`At ${n.label} (level ${depthOf(g).get(at)})${last ? `, since ${last.at.slice(0, 10)} (${Math.floor(daysSince(last.at))} days)` : ""}`);
      console.log(`Goal: ${n.goal}`);
      for (const m of messagesFor(g, at, l)) console.log(`\n--- ${m.label} ---\n${render(m.text, l)}`);
      if (n.do_not_claim?.length) console.log(`\nDo not claim:\n${n.do_not_claim.map((x) => `  - ${x}`).join("\n")}`);
      console.log("\nWays out:");
      for (const o of outs(g, at).filter((o) => o.kind !== "objection" && (!o.segments || o.segments.includes(l.segment)))) {
        const e = n.exits.find((e) => e.id === o.id)!;
        console.log(`  ${o.id.padEnd(22)} -> ${o.to.padEnd(15)} ${e.when}${e.after_days ? ` (after ${e.after_days} days)` : ""}`);
      }
      const objs = g.objections.filter((o) => o.at.includes(at));
      if (objs.length) console.log("\nObjections expected here:");
      for (const o of objs) console.log(`  ${o.id.padEnd(22)} [${o.status}] ${o.label}`);
      break;
    }
    case "classify": {
      const l = needLead(t, g, pos[0]);
      const at = t.current(g.id, l.id) ?? g.entry;
      const hits = classify(g, pos.slice(1).join(" "), at);
      if (!hits.length) console.log(`No objection at ${at} matches. If it's a plain reply, log the advance edge.`);
      for (const h of hits) {
        const to = h.objection.to_by_segment?.[l.segment] ?? h.objection.to;
        console.log(`${h.objection.id} [${h.objection.status}] ${h.objection.label}  (matched: ${h.hits.join(", ")})`);
        console.log(`  reading: ${h.objection.reading}`);
        console.log(`  respond: ${render(h.objection.response, l)}`);
        console.log(`  then:    bun run funnel log ${l.id} ${h.objection.id} --reply "..."   (-> ${to})`);
      }
      break;
    }
    case "log": {
      const l = needLead(t, g, pos[0]);
      if (!pos[1]) throw new Error("Give the edge or objection id. `funnel next <lead>` lists them.");
      const { event, spawn } = move(t, g, {
        lead: l.id, via: pos[1], at: f.at as string | undefined,
        reply: f.reply as string | undefined, message: f.message as string | undefined, note: f.note as string | undefined,
      });
      console.log(`${l.id}: ${event.from} -> ${event.to} via ${pos[1]}`);
      if (spawn && typeof f.referral === "string") {
        const id = `ref-${f.referral.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${l.id}`;
        const ref: Lead = {
          id, name: f.referral, company: l.company, title: (f["referral-title"] as string) ?? undefined, segment: l.segment,
          fields: { ...l.fields, referred_by: l.id },
        };
        t.putLead(g.id, ref);
        if (spawn.node !== g.entry) place(t, g, id, spawn.node, { set: true }, undefined, { note: spawn.note.replaceAll("{referrer}", l.name) });
        console.log(`  opened ${id} at ${spawn.node}: ${spawn.note.replaceAll("{referrer}", l.name)}`);
      } else if (spawn) console.log(`  this objection opens a referral: add --referral "<name>" once you have it.`);
      break;
    }
    case "set": {
      const l = needLead(t, g, pos[0]);
      if (!pos[1] || !f.note) throw new Error("Give a node and a --note saying why.");
      const e = place(t, g, l.id, pos[1], { set: true }, undefined, { note: f.note as string });
      console.log(`${l.id}: ${e.from ?? g.entry} -> ${e.to} (set by hand)`);
      break;
    }
    case "path": {
      const l = needLead(t, g, pos[0]);
      console.log(`${l.name} at ${l.company} [${l.segment}]`);
      console.log(`  start         ${g.entry}`);
      for (const e of t.events(g.id, l.id)) {
        const via = "edge" in e.via ? e.via.edge : "objection" in e.via ? `objection ${e.via.objection}` : "import" in e.via ? `import ${e.via.import}` : "set by hand";
        console.log(`  ${e.at.slice(0, 10)}    ${e.from ?? g.entry} -> ${e.to}  (${via})`);
        if (e.reply) console.log(`                reply: ${e.reply}`);
        if (e.note) console.log(`                note: ${e.note}`);
      }
      break;
    }
    case "due": {
      const rows: string[] = [];
      for (const l of t.leads(g.id)) {
        const at = t.current(g.id, l.id) ?? g.entry;
        const last = t.events(g.id, l.id).at(-1);
        if (!last) continue;
        const n = nodes.get(at)!;
        for (const e of n.exits.filter((e) => e.kind === "timeout" && (!e.segments || e.segments.includes(l.segment)))) {
          const d = daysSince(last.at);
          if (d >= e.after_days!) rows.push(`${l.id.padEnd(34)} ${at.padEnd(14)} ${Math.floor(d)}d  -> ${e.id} (${e.to})`);
        }
      }
      console.log(rows.length ? rows.join("\n") : "Nothing due.");
      console.log(`${rows.length} due. Before moving a lead on, check whether a follow-up message exists at its stage (\`funnel next\`).`);
      break;
    }
    case "stats": {
      const depth = depthOf(g);
      const s = stats(t, g, depth);
      console.log(`${s.leads} leads\n`);
      console.log("level  node              now  reached  moved on");
      for (const l of levels(g))
        for (const id of l.nodes) {
          const c = s.conversion[id];
          const pct = c.reached ? ` (${Math.round((100 * c.moved_on) / c.reached)}%)` : "";
          console.log(`${String(l.depth).padEnd(6)} ${id.padEnd(17)} ${String(s.now[id] ?? 0).padStart(3)}  ${String(c.reached).padStart(7)}  ${c.moved_on}${pct}`);
        }
      console.log("\nObjections seen in traces:");
      if (!s.objections.length) console.log("  none logged yet");
      for (const o of s.objections) console.log(`  ${o.id.padEnd(22)} at ${o.at.padEnd(15)} ${o.count}`);
      const unseen = g.objections.filter((o) => o.status === "observed" && !s.objections.some((x) => x.id === o.id));
      if (unseen.length) console.log(`  observed in conversations but not yet logged: ${unseen.map((o) => o.id).join(", ")}`);
      break;
    }
    case "page": {
      // The graph view as one self-contained page: aggregates only, no people, safe to publish privately.
      const out = (f.out as string) ?? "data/funnel-page.html";
      writeFileSync(out, viewPage(exportView(t, g, false)));
      console.log(`wrote ${out}`);
      break;
    }
    case "export": {
      const out = (f.out as string) ?? "data/funnel-export.json";
      writeFileSync(out, JSON.stringify(exportView(t, g, !!f["with-leads"]), null, 1));
      console.log(`wrote ${out}${f["with-leads"] ? " (includes real people: keep it out of anything public)" : ""}`);
      break;
    }
    default:
      console.log(USAGE);
  }
}

if (import.meta.main)
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
