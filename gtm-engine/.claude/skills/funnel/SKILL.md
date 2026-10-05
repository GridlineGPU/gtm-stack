---
name: funnel
description: Work a GTM funnel graph in this repo. Use when the user pastes a prospect's reply, says someone accepted, replied, objected, booked a call or went quiet, asks who to follow up with, asks where a lead is, or wants to add a stage or objection to the funnel. Also use to sync the outreach page's tracker into the trace log.
---

# Funnel graph workflow

The funnel is a graph in `config/funnel.<name>.json` (default `config/funnel.demand.json`, pick another with `GTM_FUNNEL=`). Leads and their moves live in `data/funnel.sqlite`, which is gitignored because it holds real people. Every command is `bun run funnel <cmd>`; run it with no command to list them.

## A reply came in

1. `bun run funnel next <lead>` shows the stage, what was sent, the ways out and the objections expected there.
2. `bun run funnel classify <lead> "<reply text>"` suggests objections by keyword. It only suggests; read the reply yourself. A plain positive reply is the stage's `advance` edge, not an objection.
3. Show the user the matching objection's `response` (filled with their name) and where it routes. Don't send anything yourself.
4. When the user confirms, log it with the reply text, so the trace keeps the evidence:
   `bun run funnel log <lead> <edge-or-objection-id> --reply "<their words>"`
5. An objection with `spawn` (e.g. `not_my_call`) asks for a referral. Once the user has a name, log it with `--referral "<name>" --referral-title "<title>"`, which opens a new lead at the spawn stage.

`log` refuses a move that isn't an edge out of the lead's current stage and lists the valid ones. Don't route around it with `set`. Use `set <lead> <node> --note "..."` only to correct a wrong position, and say so.

## Daily pass

`bun run funnel due` lists leads whose timeout has passed. For each one, `next` shows whether the stage has a follow-up message to send first (Stage 1 has one follow-up, then nurture). Log the timeout edge only after that.

## Sync from the outreach page

The outreach page keeps `done`, `sent` and `stage` collections in its artifact database. Pull each with ArtifactData (`action: list`, `out_dir: data/pull/demand`), then run `bun run funnel import data/pull/demand`. It's idempotent: leads already traced keep their history, and a `stage` row only adds an event when it differs from the log.

Load or refresh leads from a researched list with `bun run funnel leads <companies.json>` (an array of `{name, people[], ...fields}`; the page's `demand-outreach.json` works as is).

## Changing the graph

Edit the JSON, then run `bun run funnel validate` and `bun test`. Rules the validator holds:
- every node is reachable from `entry`, and every segment has a path to a `won` node;
- every edge, objection route, `to_by_segment` target and spawn node exists;
- only `won` and `lost` nodes have no exits, and every node can reach one of them;
- stages without a timeout or without objections get a warning.

Levels are never written by hand. They are BFS depth over `advance` edges, per segment, deepest wins.

New objections start as `"status": "hypothesis"`. Change one to `"observed"` only when the user says they heard it in a real conversation. `stats` lists observed objections that have no logged trace yet.

## Seeing it

- `bun run funnel levels` prints the graph level by level, with objections and back-edges (↺).
- `bun run funnel stats` gives counts per node, how many moved deeper, and objections by stage.
- `bun run serve` then open `http://127.0.0.1:4320/funnel` for the graph with lead tracing and a form to log moves.
- `bun run funnel page` writes `data/funnel-page.html` with counts only (no people). Publish that file, never the `--with-leads` export.
