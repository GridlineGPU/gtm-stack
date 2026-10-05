import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { recall } from "./eval";
import { merge } from "./merge";
import { segments } from "./seed";
import { now, runId, type Store } from "./store";
import type { Company, CompanyInput, Run } from "./types";

const SKILL_PATH = ".claude/skills/market-map/SKILL.md";

/** Segment descriptions the agent sees. Deliberately free of company names so blind runs stay blind. */
export const SEGMENT_BRIEFS: Record<string, string> = {
  price_discovery: "Companies that publish GPU rental price indices, compute price data, or contract-price benchmarks used for pricing or settlement.",
  spot_venues: "Venues, auctions, order books and aggregators where buyers rent GPU capacity from many providers through one surface, plus the spot GPU rental marketplaces themselves.",
  decentralised: "Decentralised or crypto-native networks that match GPU supply and demand with on-chain settlement, including distributed-training networks.",
  desks_brokers: "OTC desks and brokers that quote or trade GPU compute capacity, forwards or swaps as principal or agent.",
  exchanges: "Exchanges, futures, perpetuals and prediction markets on GPU or compute prices.",
  credit: "Lenders and protocols that finance GPUs or lend against GPU collateral, including tokenised GPU financing.",
  insurance_plumbing: "Insurance, residual-value guarantees, collateral valuation and monitoring, and metering or billing infrastructure that makes GPU capacity tradable or financeable.",
  token_routers: "Routers and gateways that send AI model or inference requests across many providers.",
};

function skillBody(): string {
  return readFileSync(SKILL_PATH, "utf8").replace(/^---[\s\S]*?---\s*/, "");
}

export function buildPrompt(mode: "discover" | "enrich", opts: { segment?: string; blind?: boolean; companies?: Company[] }): string {
  const segs = segments()
    .map((s) => `- ${s.id}: ${s.label}`)
    .join("\n");
  const head = `${skillBody()}\n\n---\n\nSegment ids:\n${segs}\n\n`;
  if (mode === "discover") {
    const seg = opts.segment ?? "spot_venues";
    return `${head}Mode: discover${opts.blind ? " (blind)" : ""}\nSegment: ${seg}\nSegment description: ${SEGMENT_BRIEFS[seg] ?? seg}\n\nFind the companies. Reply with the JSON object only.`;
  }
  const list = (opts.companies ?? [])
    .map((c) => `- ${c.name}${c.website ? ` (${c.website})` : ""}${c.handle ? ` @${c.handle}` : ""}${c.segment ? ` [segment: ${c.segment}]` : ""}`)
    .join("\n");
  return `${head}Mode: enrich\nCompanies:\n${list}\n\nReply with the JSON object only.`;
}

/** Pull the JSON object out of the agent's final message, fenced or not. */
export function parseAgentJson(text: string): { companies: CompanyInput[]; searched?: string[]; gaps?: string } {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fence ? fence[1] : text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  const parsed = JSON.parse(body);
  if (!Array.isArray(parsed.companies)) throw new Error("Agent reply has no companies array.");
  const companies = parsed.companies
    .filter((c: any) => c && typeof c.name === "string" && c.name.trim())
    .map((c: any) => ({ ...c, people: c.people ?? [], sources: c.sources ?? [], note: c.note ?? null }));
  return { companies, searched: parsed.searched, gaps: parsed.gaps };
}

export interface AgentOutput {
  text: string;
  cost_usd: number | null;
}

/** Runs headless Claude Code in this project with web tools only. */
export async function runClaude(prompt: string, timeoutMs = 20 * 60_000): Promise<AgentOutput> {
  const env = { ...process.env };
  delete env.CLAUDECODE; // lets this run from inside another Claude Code session
  delete env.CLAUDE_CODE_ENTRYPOINT;
  const proc = Bun.spawn(
    ["claude", "-p", prompt, "--output-format", "json", "--allowedTools", "WebSearch,WebFetch,Read", "--max-turns", "60"],
    { cwd: process.cwd(), env, stdout: "pipe", stderr: "pipe" },
  );
  const timer = setTimeout(() => proc.kill(), timeoutMs);
  const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
  clearTimeout(timer);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`claude exited ${code}: ${err.slice(0, 500) || out.slice(0, 500)}`);
  const res = JSON.parse(out);
  if (res.is_error) throw new Error(`claude reported an error: ${String(res.result).slice(0, 500)}`);
  return { text: String(res.result ?? ""), cost_usd: res.total_cost_usd ?? null };
}

export interface AgentRunOptions {
  mode: "discover" | "enrich";
  segment?: string;
  blind?: boolean;
  ids?: string[];
  /** For tests: skip Claude and use this reply text. */
  replay?: string;
}

/** Run the agent, score recall for discover runs, merge, and record the run with its diff. */
export async function agentRun(store: Store, o: AgentRunOptions): Promise<Run> {
  const targets =
    o.mode === "enrich"
      ? o.ids?.length
        ? o.ids.map((id) => store.company(id)).filter((c): c is Company => !!c)
        : store.companies().filter((c) => c.status === "pending")
      : [];
  const run: Run = {
    id: runId(o.mode),
    kind: o.mode,
    segment: o.segment ?? null,
    blind: !!o.blind,
    started_at: now(),
    finished_at: null,
    status: "running",
    error: null,
    input_count: 0,
    diff: null,
    recall: null,
    cost_usd: null,
    log: null,
  };
  store.putRun(run);
  try {
    if (o.mode === "enrich" && targets.length === 0 && o.replay === undefined) throw new Error("Nothing to enrich: no pending companies and no ids given.");
    const prompt = buildPrompt(o.mode, { segment: o.segment, blind: o.blind, companies: targets });
    const out = o.replay !== undefined ? { text: o.replay, cost_usd: 0 } : await runClaude(prompt);
    const parsed = parseAgentJson(out.text);
    run.input_count = parsed.companies.length;
    run.cost_usd = out.cost_usd;
    run.log = JSON.stringify({ searched: parsed.searched ?? [], gaps: parsed.gaps ?? null, raw: parsed.companies });
    if (o.replay === undefined && process.env.GTM_DB !== ":memory:") {
      // Keep every paid agent reply so merges can be replayed after matcher fixes without re-running the agent.
      mkdirSync("data/agent-output", { recursive: true });
      writeFileSync(`data/agent-output/${run.id}.json`, JSON.stringify({ mode: o.mode, segment: run.segment, blind: run.blind, cost_usd: out.cost_usd, ...parsed }, null, 2));
    }
    if (o.mode === "discover") run.recall = recall(parsed.companies, o.segment ?? null);
    run.diff = merge(store, parsed.companies, { origin: "agent", overwrite: o.mode === "enrich" });
    run.status = "done";
  } catch (e) {
    run.status = "failed";
    run.error = e instanceof Error ? e.message : String(e);
  }
  run.finished_at = now();
  store.putRun(run);
  return run;
}
