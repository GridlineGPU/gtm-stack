import { agentRun } from "./market-map/agent";
import { editCompany, merge } from "./market-map/merge";
import { loadConfig, loadSeed, segments } from "./market-map/seed";
import { now, runId, Store } from "./market-map/store";
import type { Run } from "./market-map/types";
import { loadGraph } from "./funnel/graph";
import { move, Trace } from "./funnel/trace";
import { exportView } from "./funnel/view";

const store = new Store();
const trace = new Trace();
const port = Number(process.env.PORT ?? 4320);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
}

function state() {
  const seed = loadSeed();
  const cfg = loadConfig();
  return {
    mode: "local",
    segments: segments(),
    company: { name: cfg.company, one_liner: cfg.one_liner, home_segment: cfg.home_segment, roles: cfg.roles },
    agent_busy: agentBusy,
    seed: { title: seed.title, publisher: seed.publisher, author: seed.author, post_url: seed.post_url, published: seed.published, upstream: seed.upstream },
    companies: store.companies(),
    runs: store.runs().map(({ log, ...r }) => r),
  };
}

let agentBusy = false;

const server = Bun.serve({
  hostname: "127.0.0.1",
  port,
  async fetch(req) {
    const url = new URL(req.url);
    const path = url.pathname;
    try {
      if (path === "/" || path === "/index.html") {
        // The artifact host adds the document shell; locally we add it ourselves.
        const page = await Bun.file("web/index.html").text();
        return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"></head><body>${page}</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (path === "/api/state" && req.method === "GET") return json(state());

      // Funnel graph: the page reads the export (with leads, since this only listens on localhost) and logs moves.
      if (path === "/funnel" || path === "/funnel.html") {
        const page = await Bun.file("web/funnel.html").text();
        return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${page}</body></html>`, { headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (path === "/api/funnel" && req.method === "GET") return json(exportView(trace, loadGraph(), true));
      if (path === "/api/funnel/moves" && req.method === "POST") {
        const b = await req.json();
        return json(move(trace, loadGraph(), { lead: b.lead, via: b.via, reply: b.reply || undefined, note: b.note || undefined }));
      }

      if (path === "/api/companies" && req.method === "POST") {
        const b = await req.json();
        if (!b.name?.trim()) return json({ error: "Give the company a name." }, 400);
        const diff = merge(store, [{ name: b.name, website: b.website || null, handle: b.handle || null, segment: b.segment || null, note: b.note || null }], { origin: "manual", overwrite: false });
        const t = now();
        const run: Run = { id: runId("manual"), kind: "manual", segment: null, blind: false, started_at: t, finished_at: t, status: "done", error: null, input_count: 1, diff, recall: null, cost_usd: null, log: null };
        store.putRun(run);
        return json({ diff });
      }

      const m = path.match(/^\/api\/companies\/([^/]+)$/);
      if (m && req.method === "PATCH") {
        const b = await req.json();
        return json(editCompany(store, decodeURIComponent(m[1]), b.patch ?? {}, b.lock ?? true));
      }

      if (path === "/api/runs" && req.method === "POST") {
        if (agentBusy) return json({ error: "An agent run is already going. Wait for it to finish." }, 409);
        const b = await req.json();
        agentBusy = true;
        agentRun(store, { mode: b.mode, segment: b.segment, blind: !!b.blind, ids: b.ids }).finally(() => {
          agentBusy = false;
        });
        return json({ started: true });
      }

      return json({ error: "Not found" }, 404);
    } catch (e) {
      return json({ error: e instanceof Error ? e.message : String(e) }, 400);
    }
  },
});

console.log(`Market map on http://${server.hostname}:${server.port}/ · funnel graph on /funnel`);
