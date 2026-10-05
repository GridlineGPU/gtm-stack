#!/usr/bin/env bun
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { agentRun } from "./market-map/agent";
import { recall } from "./market-map/eval";
import { fetchPost, ingestPost } from "./market-map/ingest-x";
import { editCompany, foldDuplicates, merge } from "./market-map/merge";
import { seedStore } from "./market-map/seed";
import { now, runId, Store } from "./market-map/store";
import { exportOps, importSubmissions, type Submission } from "./market-map/sync";
import type { Run } from "./market-map/types";

const USAGE = `gtm market map

  bun run map seed                         load the 58-company Cobursa seed
  bun run map ingest-x <status-url>        store an X post and attach its sentences as evidence
  bun run map add <name> [--website URL] [--handle H] [--segment ID] [--note TEXT]
  bun run map edit <id> <field>=<value>... set fields and lock them against agent runs
  bun run map discover --segment ID [--blind]
  bun run map enrich [--ids a,b,c]         enrich the given ids, or every pending company
  bun run map dedupe                       fold duplicate candidates into companies already in the map
  bun run map rescore <run-id>             recompute a discovery run's recall with the current matcher
  bun run map replay <agent-output.json>   re-merge a saved agent reply (no new agent cost)
  bun run map runs                         list runs
  bun run map show <run-id>                print a run's diff and recall
  bun run map eval <agent-output.json> [--segment ID]
  bun run map export [--dir DIR]           write documents + batches for the shared web app
  bun run map import-submissions <dir|file> merge web-app submissions (a folder of <id>.json, or a JSON array)
`;

/**
 * Submissions as the document store hands them back: a directory of <id>.json files (ArtifactData out_dir,
 * pointed at its submissions/ folder), or one JSON file holding an array of flat rows or {id, data} rows.
 */
function loadSubmissions(path: string): Submission[] {
  if (statSync(path).isDirectory()) {
    return readdirSync(path)
      .filter((f) => f.endsWith(".json"))
      .map((f) => ({ ...JSON.parse(readFileSync(join(path, f), "utf8")), id: f.replace(/\.json$/, "") }));
  }
  const rows = JSON.parse(readFileSync(path, "utf8"));
  return rows.map((r: any) => (r.data && r.id ? { ...r.data, id: r.id } : r));
}

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

function record(store: Store, kind: Run["kind"], diff: Run["diff"], input_count: number, log: unknown = null): Run {
  const t = now();
  const run: Run = {
    id: runId(kind), kind, segment: null, blind: false, started_at: t, finished_at: t, status: "done",
    error: null, input_count, diff, recall: null, cost_usd: null, log: log ? JSON.stringify(log) : null,
  };
  store.putRun(run);
  return run;
}

function summary(r: Run): string {
  const d = r.diff;
  const parts = [`${r.id}  ${r.status}`];
  if (r.error) parts.push(`error: ${r.error}`);
  if (d)
    parts.push(
      `added ${d.added.length} · filled ${d.filled.length} · changed ${d.changed.length} · locked-skipped ${d.skipped_locked.length} · appended ${d.appended.reduce((n, a) => n + a.count, 0)} · proposed ${d.proposed.length} · ambiguous ${d.ambiguous.length} · unchanged ${d.unchanged.length}`,
    );
  if (r.recall) {
    const rc = r.recall;
    parts.push(`recall ${rc.found}/${rc.seed_total} (${Math.round(rc.recall * 100)}%)${rc.contaminated ? " CONTAMINATED" : ""} · new ${rc.new_names.length}`);
    if (rc.missing.length) parts.push(`missing: ${rc.missing.join(", ")}`);
  }
  if (r.cost_usd != null) parts.push(`cost $${r.cost_usd.toFixed(2)}`);
  return parts.join("\n  ");
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, f } = flags(rest);
  const store = new Store();

  switch (cmd) {
    case "seed": {
      const diff = seedStore(store);
      console.log(summary(record(store, "seed", diff, diff.added.length + diff.unchanged.length)));
      break;
    }
    case "ingest-x": {
      if (!pos[0]) throw new Error("Give an X status URL.");
      const { post, folder } = await fetchPost(pos[0]);
      const res = ingestPost(store, post, folder);
      const run = record(store, "ingest", res.diff, res.companies_with_evidence, { source: res.source_id, unmatched_handles: res.unmatched_handles });
      console.log(summary(run));
      console.log(`  evidence for ${res.companies_with_evidence} companies; none for: ${res.companies_without_evidence.join(", ") || "-"}`);
      console.log(`  handles not in the map: ${res.unmatched_handles.join(", ") || "-"}`);
      break;
    }
    case "add": {
      if (!pos[0]) throw new Error("Give a company name.");
      const diff = merge(
        store,
        [{ name: pos.join(" "), website: (f.website as string) ?? null, handle: (f.handle as string) ?? null, segment: (f.segment as string) ?? null, note: (f.note as string) ?? null }],
        { origin: "manual", overwrite: false },
      );
      console.log(summary(record(store, "manual", diff, 1)));
      break;
    }
    case "edit": {
      const [id, ...pairs] = pos;
      const patch = Object.fromEntries(pairs.map((p) => [p.slice(0, p.indexOf("=")), p.slice(p.indexOf("=") + 1)]));
      const c = editCompany(store, id, patch);
      console.log(`${c.id}: locked ${c.locked.join(", ")}`);
      break;
    }
    case "discover": {
      const run = await agentRun(store, { mode: "discover", segment: (f.segment as string) ?? "spot_venues", blind: !!f.blind });
      console.log(summary(run));
      break;
    }
    case "enrich": {
      const ids = typeof f.ids === "string" ? f.ids.split(",") : undefined;
      const run = await agentRun(store, { mode: "enrich", ids });
      console.log(summary(run));
      break;
    }
    case "dedupe": {
      const { folded, diff } = foldDuplicates(store);
      const run = record(store, "sync", diff, folded.length, { folded });
      console.log(summary(run));
      for (const f of folded) console.log(`  ${f.from} -> ${f.into}`);
      break;
    }
    case "rescore": {
      const r = store.run(pos[0]);
      if (!r?.log || r.kind !== "discover") throw new Error(`No discovery run ${pos[0]} with stored output.`);
      const before = r.recall;
      r.recall = recall(JSON.parse(r.log).raw, r.segment);
      store.putRun(r);
      console.log(`recall ${before?.found}/${before?.seed_total} -> ${r.recall.found}/${r.recall.seed_total}; missing: ${r.recall.missing.join(", ") || "-"}`);
      break;
    }
    case "replay": {
      const saved = JSON.parse(readFileSync(pos[0], "utf8"));
      const run = await agentRun(store, { mode: saved.mode, segment: saved.segment ?? undefined, blind: !!saved.blind, replay: JSON.stringify(saved), ids: saved.ids });
      run.cost_usd = saved.cost_usd ?? null;
      store.putRun(run);
      console.log(summary(run));
      break;
    }
    case "runs":
      for (const r of store.runs()) console.log(summary(r));
      break;
    case "show": {
      const r = store.run(pos[0]);
      if (!r) throw new Error(`No run ${pos[0]}.`);
      console.log(JSON.stringify({ ...r, log: undefined }, null, 2));
      break;
    }
    case "eval": {
      const data = JSON.parse(readFileSync(pos[0], "utf8"));
      console.log(JSON.stringify(recall(data.companies ?? data, (f.segment as string) ?? null), null, 2));
      break;
    }
    case "export": {
      // One JSON file per document, plus the writes grouped into batches of 50 for the document store.
      const ops = exportOps(store);
      const dir = resolve((f.dir as string) ?? "data/artifact-export");
      rmSync(dir, { recursive: true, force: true });
      const writes = ops.map((o) => {
        const [collection, doc_id] = o.path.split("/");
        const file_path = join(dir, collection, `${doc_id}.json`);
        mkdirSync(dirname(file_path), { recursive: true });
        writeFileSync(file_path, JSON.stringify(o.data));
        return { op: o.op, collection, doc_id, file_path };
      });
      const batches = [];
      for (let i = 0; i < writes.length; i += 50) batches.push(writes.slice(i, i + 50));
      writeFileSync(join(dir, "batches.json"), JSON.stringify(batches, null, 1));
      console.log(`${ops.length} documents in ${batches.length} batches -> ${join(dir, "batches.json")}`);
      break;
    }
    case "import-submissions": {
      const subs = loadSubmissions(pos[0]);
      const { diff, updates } = importSubmissions(store, subs);
      const run = record(store, "sync", diff, subs.length);
      writeFileSync("data/submission-updates.json", JSON.stringify(updates, null, 2));
      console.log(summary(run));
      console.log(`  ${updates.length} submission updates -> data/submission-updates.json`);
      break;
    }
    default:
      console.log(USAGE);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
