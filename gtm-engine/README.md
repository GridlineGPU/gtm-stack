# gtm-engine

Open-source GTM engineering, built for Gridline first. Step 1 is the **market map**: a database of every company in and around your market, with sourced evidence, a role relative to you, and an agent you can re-run without losing your edits.

Later steps (positioning, ICP and playbooks, campaigns, reply inbox, CRM sync) build on this map. See the roadmap in the repository README and the architecture in `docs/gtm-system-design.aadl.md`.

## Quick start

Requires Bun 1.3+ and, for agent runs, Claude Code (`claude`) logged in.

```sh
bun install
bun run map seed                      # 58 companies from the Cobursa compute-markets map
bun run map ingest-x https://x.com/AmusingVentures/status/2099863926489911469
bun run serve                         # http://127.0.0.1:4320/
bun test
```

## How the market map works

| Piece | File | What it does |
|---|---|---|
| Seed | `seeds/cobursa-2026-09-15.json` | The 58 companies in seven boxes, transcribed from the map image in the post. Also the recall test set. |
| Company config | `config/company.json`, `config/product-marketing.md` | Who "you" are, your home box, and a default role per box. Swap these to run the engine for another company. |
| X ingest | `src/market-map/ingest-x.ts` | Fetches a post (no API key, via the fxtwitter mirror), saves it and its images under `sources/`, and attaches the clause about each company as evidence. Handles that match no company are listed for review. |
| Merge | `src/market-map/merge.ts` | The only way data enters the map. Dedupes by domain, handle, name, alias and token overlap. Never overwrites a field you edited, never renames, never merges an input that matches two companies, and never lets the agent move a company's box or role (it proposes instead). |
| Agent | `.claude/skills/market-map/SKILL.md`, `src/market-map/agent.ts` | Runs headless Claude Code with web search. `discover` finds companies in a box; `enrich` fills facts, people and sources for named or pending companies. |
| Recall eval | `src/market-map/eval.ts` | Scores discovery against the seed box. Blind runs never see the seed names; a run that cites the seed post is marked contaminated. |
| Web app | `web/index.html`, `src/server.ts` | One page. Served locally it talks to the engine. Published as a claude.ai artifact it reads a shared document store and queues manual adds. |

Statuses: `active` (in the map), `pending` (manual add waiting for enrichment), `candidate` (agent found it, waiting for you), `rejected` (kept so re-runs don't re-add it).

## Commands

```sh
bun run map add "OpenRouter" --website https://openrouter.ai --segment token_routers
bun run map edit shadeform one_liner="..." role=competitor   # locks those fields
bun run map discover --segment spot_venues --blind
bun run map enrich                      # every pending company
bun run map enrich --ids mithril,hydra-host
bun run map dedupe                      # fold duplicate candidates into companies already in the map
bun run map replay data/agent-output/<run>.json   # re-merge a saved agent reply after a matcher fix, no new cost
bun run map runs
bun run map export                      # documents + batches for the shared web app
bun run map import-submissions data/pull/submissions
```

## The shared web app

The published artifact reads `companies`, `runs` and `meta/map` from its document store and writes only `submissions`. The engine is the only writer of the map. To sync, ask Claude Code in this folder to:

1. list the artifact's `submissions` collection with `out_dir: data/pull`, then run `bun run map import-submissions data/pull/submissions`,
2. run `bun run map enrich` if anything is pending,
3. run `bun run map export` and write `data/artifact-export/batches.json` to the store, then write back `data/submission-updates.json`.

## Verified on 24 Sep 2026

- 42 tests pass (`bun test`), including dedupe cases taken from the first real agent run.
- Seed: 58 companies, per-box counts match the image. X ingest attached evidence to 57; Forward Compute appears only in the image.
- Blind discovery of the spot-venues box (Claude Code, $3.46): 12 of 13 seed companies found, not contaminated (it didn't open cobursa.com or the post), 16 new candidates. It missed Stoa, which sells physical GPU hardware by RFQ.
- Enrichment ($0.75): OpenRouter moved from pending to active with sourced facts. Shadeform's locked one-liner survived. The agent's proposal to call Stoa adjacent was recorded, not applied.
- First run exposed a matcher bug (parenthetical names like "SF Compute (The San Francisco Compute Company)") that created a duplicate. Fixed, regression-tested, and the DB rebuilt by replaying the saved agent output.
- Shared web app: viewer-level writes to `submissions` are accepted and to `companies` refused. A submitted "Parasail" merged into the existing candidate.

## Funnel graph (step 2: demand side)

The pipeline after the map, as a directed graph. Each node is a stage a lead can sit in. Each stage carries its messages, the value it gives and the ask it makes, its ways out (advance, timeout, disqualify, re-engage), and the objections that come up there. Each objection has a reading, a response and a route to another stage. Levels are BFS depth from the first touch, so adding a stage re-levels the graph. Every lead's moves go in an append-only trace, which yields per-stage counts, conversion and objection frequency.

```sh
bun run funnel validate                         # reachability, routes, a path to a win for every segment
bun run funnel levels                           # the graph level by level, objections and back-edges
bun run funnel leads ../output-demand/demand-outreach.json
bun run funnel import data/pull/demand          # tracker rows (done/, sent/, stage/) -> events
bun run funnel next co-acme-p0                  # stage, what to send, ways out, objections to expect
bun run funnel classify co-acme-p0 "we run our own GPUs"
bun run funnel log co-acme-p0 own_gpus --reply "we run our own GPUs"
bun run funnel due                              # timeouts that have passed
bun run funnel stats
bun run funnel page                             # data/funnel-page.html, counts only, safe to publish
bun run serve                                   # http://127.0.0.1:4320/funnel: graph, lead tracing, log form
```

| Piece | File | What it does |
|---|---|---|
| Graph | `config/funnel.demand.json` | Gridline's demand funnel: 15 stages, 3 segments (audio, orchestrator, non-audio), 19 objections. Swap the file to run another company's funnel. |
| Engine | `src/funnel/graph.ts` | BFS levels, back-edges, validation, objection classifier, per-segment routing. |
| Trace | `src/funnel/trace.ts` | Leads and the event log in `data/funnel.sqlite`. `move` refuses any move the graph doesn't have. |
| Import | `src/funnel/import.ts` | Leads from a researched list; events from the outreach page's tracker collections. Idempotent. |
| View | `web/funnel.html`, `src/funnel/view.ts` | The layered graph, a stage sheet, and an objection-by-level matrix. |
| Workflow | `.claude/skills/funnel/SKILL.md` | How an agent works replies, timeouts, syncs and graph edits. |

Objections are `observed` (heard in a real conversation) or `hypothesis`. Only the user promotes one. The classifier suggests; a person confirms before anything is logged.

Real people stay in `data/` (gitignored). Tests run on `tests/fixtures/`, which holds made-up companies and names.

## Not built yet

- Reply mining. The seed post has 13 replies from companies asking to be added; fxtwitter doesn't return replies.
- Reddit and HN signal ingest (use a read-only Reddit MCP).
- Twenty CRM adapter.
- Funnel: supply-side graph; reply ingest from LinkedIn (replies are logged by hand today); a self-serve benchmark card for document and retrieval leads, who skip the pilot offer.
