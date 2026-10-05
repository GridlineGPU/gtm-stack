# GTM Stack

**A source-available, local-first GTM engineering stack.** Map your market with agents that cite their sources. Model your funnel as a graph you can check. Run outreach where a person approves every send.

Built by [Gridline](https://github.com/GridlineGPU) to take a two-sided GPU marketplace to market, and used on it daily. Gridline is the first configuration; swap the config files to run it for your company.

```text
 market map  ──►  funnel graph  ──►  outreach studio  ──►  trace  ──►  next move
 (who exists)     (how leads move)    (review, approve)    (what happened)
```

## Why another GTM tool

Most GTM tooling sends more messages. This stack is about sending the right one and knowing what happened:

- **Evidence first.** Every company in the map carries the source it came from. Agents can propose a company's segment or role but can't change it; you accept or reject.
- **You approve every send.** One approval runs one exact snapshot of a message. Edit the draft and the approval goes stale. No mass-send queue, no silent retries.
- **No LinkedIn automation.** Studio hands you the approved text and opens the profile. You press send in LinkedIn's own composer.
- **A funnel you can test.** Stages, exits and objections live in one JSON graph. A validator checks that every lead has a path to a win. Every move goes into an append-only trace.
- **Local-first.** SQLite on your machine, servers bound to `127.0.0.1`. Prospect data never needs to leave your laptop or enter this repository.

## What's in the box

| Part | Path | What it does |
|---|---|---|
| **Market map** | `gtm-engine/` | Builds a database of every company in your market from a seed list, X posts and headless Claude Code runs with web search. One merge path dedupes by domain, handle, name and alias, and never overwrites a field you locked. A blind recall eval scores agent discovery against a known list. |
| **Funnel graph** | `gtm-engine/config/funnel.*.json` | Your pipeline as a directed graph: stages, messages, timeouts, objections with responses and routes, per-segment paths. Levels come from BFS, so adding a stage re-levels the graph. Includes `next`, `due`, `classify`, `log`, `stats`, a validator and a graph view. |
| **Outreach Studio** | `apps/outreach/` | Review-and-execute app: company tracker, bulk draft preparation, email, partner-application and LinkedIn-handoff actions with approval bound to a revision, receipts, sheet sync, CSV export. Test mode by default. |
| **Claude Code skills** | `.claude/skills/`, `skills/`, `gtm-engine/.claude/skills/` | `outreach` (company name to contact list and messages), `review-first-outreach` (queue drafts for review), `market-map`, `funnel`. |
| **System design** | `docs/gtm-system-design.aadl.md` | The architecture as an AADL model: components, ports, data stores, invariants and where each is enforced. |

## Quick start

Requires [Bun](https://bun.sh) 1.3.14+, Python 3 for sheet import, and [Claude Code](https://claude.com/claude-code) for agent runs.

```sh
git clone https://github.com/GridlineGPU/gtm-stack && cd gtm-stack
bun install && bun run engine:install
bun run test                     # Studio + engine

# Outreach Studio on fictional demo data
bun run start                    # http://127.0.0.1:4310/

# Market map and funnel graph
bun run map seed                 # 58 companies from a public compute-markets map
bun run map discover --segment spot_venues --blind
bun run funnel validate
bun run serve:engine             # http://127.0.0.1:4320/ (map) and /funnel
```

## Make it yours

| File | Change it to |
|---|---|
| `gtm-engine/config/company.json` | Your company, your home segment, a default role per segment (competitor, supplier, partner, adjacent, buyer). |
| `gtm-engine/config/product-marketing.md` | Your positioning. The agents read it. |
| `gtm-engine/seeds/*.json` | A starting list of companies, which also becomes your recall test set. |
| `gtm-engine/config/funnel.demand.json` | Your stages, messages, objections and segments. Run `bun run funnel validate` after editing. |
| `apps/outreach/data/source.json` | Point `OUTREACH_SOURCE_DIR` at a folder with your researched companies and tracker sheet. Format in [`apps/outreach/README.md`](apps/outreach/README.md). |

Keep real prospect data outside this repository: gitignored `data/` folders, or a private repo of your own.

## Status

Working and tested (62 engine tests, 47 Studio tests):

- Market map: seed, X ingest, agent discover and enrich, merge with locks and proposals, blind recall eval, replay of saved agent output, export to a hosted page. First blind run found 12 of 13 known companies in its segment, uncontaminated, for $3.46.
- Funnel graph: validation, levels, trace, tracker import, timeouts, objection suggestions, stats, a page that shows counts only.
- Outreach Studio: tracker, bulk preparation, approval-bound execution with receipts, sheet sync with conflict resolution, published-email research, CSV and JSON export.

Not built yet:

- Configurable sender identities in Studio (currently Gridline's two founders).
- One system of record shared by the funnel and Studio (planned: a [Twenty](https://twenty.com) CRM adapter).
- Reply ingest: replies are logged by hand. Planned: LinkedIn `messages.csv` import, not browser automation.
- Signal ingest from X replies, Reddit and Hacker News.
- A supply-side funnel graph.
- Live SMTP delivery, paid research and partner-form submission are implemented but untested until you configure and approve them.

## License

**Source-available, not open source.** Licensed under the [PolyForm Noncommercial License 1.0.0](LICENSE.md). You can read, run, modify and share it for any noncommercial purpose: personal projects, research, education, nonprofits, government. Commercial use needs a separate license from Gridline: open an issue or email chinmay@gridlinegpu.com.

## Credits

Market map, funnel graph and system design by Chinmay. Outreach Studio by Akshit Pareek. Seed market map transcribed from the Cobursa compute-markets map ([source post](https://x.com/AmusingVentures/status/2099863926489911469)).
