import { describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backEdges, bfs, classify, depthOf, levels, loadGraph, messagesFor, outs, segmentOf, validate } from "../src/funnel/graph";
import { importTracker, leadId, toLeads } from "../src/funnel/import";
import { move, place, render, stats, Trace } from "../src/funnel/trace";
import type { FunnelGraph } from "../src/funnel/types";

const G = loadGraph("config/funnel.demand.json");
const COMPANIES = JSON.parse(readFileSync("tests/fixtures/funnel-companies.json", "utf8"));

function loaded(): Trace {
  const t = new Trace(":memory:");
  for (const l of toLeads(G, COMPANIES).leads) t.putLead(G.id, l);
  return t;
}

function clone(): FunnelGraph {
  return JSON.parse(JSON.stringify(G));
}

describe("graph", () => {
  test("the demand graph validates with no errors or warnings", () => {
    expect(validate(G)).toEqual([]);
  });

  test("levels are forward BFS depth: a nurture shortcut doesn't pull Stage 2 up", () => {
    const d = depthOf(G);
    expect(d.get("prospect")).toBe(0);
    expect(d.get("connected")).toBe(2);
    expect(d.get("offered")).toBe(3);
    expect(d.get("chat_asked")).toBe(3);
    expect(d.get("engaged")).toBe(4);
    // Audio walks Stages 2-4 to reach discovery; non-audio jumps there from chat_asked. Deepest wins.
    expect(d.get("discovery")).toBe(7);
    expect(d.get("customer")).toBe(9);
    // Plain BFS over every edge would put engaged at 3 via requested -> nurture -> engaged.
    expect(bfs(G).get("engaged")).toBe(3);
    expect(levels(G)[0]).toEqual({ depth: 0, nodes: ["prospect"] });
  });

  test("nurture loops and retries are back-edges", () => {
    const backs = backEdges(G).map((b) => `${b.from}>${b.out.id}`);
    expect(backs).toContain("plan_offered>proxy_not_ours");
    expect(backs).toContain("offered>not_my_call");
    expect(backs).toContain("pilot>p95_regressed");
    expect(backs).not.toContain("offered>replied");
  });

  test("every segment has its own road to a customer", () => {
    for (const s of G.segments) expect(bfs(G, s.id).has("customer")).toBe(true);
    expect(bfs(G, "non_audio").has("engaged")).toBe(false);
  });

  test("objections route per segment where the default target is closed", () => {
    const fromChat = outs(G, "chat_asked").filter((o) => o.id === "own_gpus");
    expect(fromChat.find((o) => o.segments?.includes("non_audio"))?.to).toBe("nurture");
    expect(fromChat.find((o) => o.segments?.includes("audio"))?.to).toBe("engaged");
  });

  test("validate catches a dangling route, an unreachable node and a segment with no win", () => {
    const g = clone();
    g.objections[0].to = "nowhere";
    g.nodes.push({ id: "island", label: "Island", kind: "stage", goal: "", messages: [], exits: [{ id: "x", to: "lost", kind: "timeout", after_days: 1, when: "" }] });
    g.nodes.find((n) => n.id === "chat_asked")!.exits = g.nodes.find((n) => n.id === "chat_asked")!.exits.filter((e) => e.id !== "chat_booked");
    g.objections = g.objections.filter((o) => o.id !== "already_on_platform");
    const errs = validate(g).filter((i) => i.level === "error").map((i) => `${i.where}: ${i.msg}`);
    expect(errs).toContain("own_gpus: objection routes to missing node nowhere");
    expect(errs).toContain("island: unreachable from entry");
    expect(errs).toContain("segment non_audio: no path from entry to a won node");
  });

  test("validate flags a loop with no way to a terminal", () => {
    const g = clone();
    g.nodes.push(
      { id: "a", label: "A", kind: "stage", goal: "", messages: [], exits: [{ id: "ab", to: "b", kind: "timeout", after_days: 1, when: "" }] },
      { id: "b", label: "B", kind: "stage", goal: "", messages: [], exits: [{ id: "ba", to: "a", kind: "timeout", after_days: 1, when: "" }] },
    );
    g.nodes[0].exits.push({ id: "to_a", to: "a", kind: "advance", when: "" });
    const errs = validate(g).map((i) => `${i.where}: ${i.msg}`);
    expect(errs).toContain("a: cannot reach any won or lost node");
  });

  test("segments come from company fields; orchestrators are matched before audio", () => {
    expect(segmentOf(G, { category: "voice", own_models: "orchestrator" })).toBe("orchestrator");
    expect(segmentOf(G, { category: "voice", own_models: "own" })).toBe("audio");
    expect(segmentOf(G, { category: "retrieval" })).toBe("non_audio");
    expect(segmentOf(G, { category: "robotics" })).toBeNull();
  });

  test("classify suggests objections raised at the lead's stage, observed first on ties", () => {
    const hits = classify(G, "Thanks, but we run our own GPUs and latency is everything for us", "offered");
    expect(hits.map((h) => h.objection.id).slice(0, 2).sort()).toEqual(["latency_only", "own_gpus"]);
    expect(classify(G, "we run our own GPUs", "prospect")).toEqual([]);
    expect(classify(G, "sounds good, send it", "offered")).toEqual([]);
    expect(classify(G, "happy to talk to you, our compass is cost", "offered")).toEqual([]);
    expect(classify(G, "you should talk to our infra team", "offered")[0].objection.id).toBe("not_my_call");
  });

  test("messages pick the segment's wording", () => {
    expect(messagesFor(G, "connected", { segment: "audio" }).map((m) => m.id)).toEqual(["stage1_pilot"]);
    expect(messagesFor(G, "connected", { segment: "orchestrator" }).map((m) => m.id)).toEqual(["stage1_pilot_orchestrator"]);
    expect(messagesFor(G, "connected", { segment: "non_audio" }).map((m) => m.id)).toEqual(["stage1_chat"]);
  });
});

describe("leads and import", () => {
  test("lead ids match the outreach page's person ids", () => {
    expect(leadId("Relay Voice (Relay Labs)", 0)).toBe("co-relay-voice-relay-labs--p0");
    const { leads, unsegmented } = toLeads(G, COMPANIES);
    expect(leads.map((l) => l.id)).toEqual(["co-acme-speech-p0", "co-acme-speech-p1", "co-relay-voice-relay-labs--p0", "co-parse-docs-p0"]);
    expect(unsegmented).toEqual(["Mystery Robotics"]);
    expect(leads[3].fields?.class).toBe("document models");
  });

  test("render fills names, possessives and lead fields", () => {
    const l = toLeads(G, COMPANIES).leads[3];
    expect(render("Hi {First}, {Company's} {class}", l)).toBe("Hi Di, Parse Docs' document models");
    expect(render("{Company}", { name: "X Y", company: "Relay Voice (Relay Labs)" })).toBe("Relay Voice");
  });

  test("tracker import: first touch, parked, sent text, stage; running it twice adds nothing", () => {
    const t = loaded();
    const r = importTracker(t, G, "tests/fixtures/tracker");
    expect([r.requested, r.parked, r.staged]).toEqual([2, 1, 2]);
    expect(t.current(G.id, "co-acme-speech-p0")).toBe("engaged");
    expect(t.current(G.id, "co-acme-speech-p1")).toBe("parked");
    expect(t.current(G.id, "co-parse-docs-p0")).toBe("chat_asked");
    expect(t.events(G.id, "co-acme-speech-p0")[0].message).toBe("Hi Ada, test note");
    expect(t.events(G.id, "co-parse-docs-p0")[0].message).toBeUndefined();
    const before = t.events(G.id).length;
    const again = importTracker(t, G, "tests/fixtures/tracker");
    expect(t.events(G.id).length).toBe(before);
    expect(again.skipped).toBe(3);
  });

  test("re-import never drags a lead back past a move logged after its stage row", () => {
    const t = loaded();
    importTracker(t, G, "tests/fixtures/tracker");
    move(t, G, { lead: "co-acme-speech-p0", via: "settings_shared", at: "2099-01-01T00:00:00.000Z" });
    const r = importTracker(t, G, "tests/fixtures/tracker");
    expect(t.current(G.id, "co-acme-speech-p0")).toBe("plan_offered");
    expect(r.changed.some((c) => c.startsWith("co-acme-speech-p0 (stage s2"))).toBe(true);
  });

  test("a parked lead the tracker later marks as contacted is unparked and requested", () => {
    const t = loaded();
    importTracker(t, G, "tests/fixtures/tracker");
    expect(t.current(G.id, "co-acme-speech-p1")).toBe("parked");
    const dir = mkdtempSync(join(tmpdir(), "funnel-"));
    cpSync("tests/fixtures/tracker", dir, { recursive: true });
    writeFileSync(join(dir, "done/co-acme-speech-p1.json"), JSON.stringify({ status: "connection", at: 1790200000000 }));
    importTracker(t, G, dir);
    expect(t.current(G.id, "co-acme-speech-p1")).toBe("requested");
    expect(t.events(G.id, "co-acme-speech-p1").map((e) => e.to)).toEqual(["parked", "prospect", "requested"]);
  });
});

describe("trace", () => {
  test("moves follow the graph; a move that isn't an edge is refused with the options", () => {
    const t = loaded();
    const id = "co-acme-speech-p0";
    move(t, G, { lead: id, via: "request_sent" });
    move(t, G, { lead: id, via: "accepted" });
    expect(() => move(t, G, { lead: id, via: "chat_ask_sent" })).toThrow(/Options: offer_sent, never_messaged, what_selling/);
    move(t, G, { lead: id, via: "offer_sent" });
    move(t, G, { lead: id, via: "own_gpus", reply: "We run our own cluster." });
    expect(t.current(G.id, id)).toBe("engaged");
  });

  test("the same objection sends non-audio leads to nurture", () => {
    const t = loaded();
    const id = "co-parse-docs-p0";
    for (const via of ["request_sent", "accepted", "chat_ask_sent", "own_gpus"]) move(t, G, { lead: id, via });
    expect(t.current(G.id, id)).toBe("nurture");
  });

  test("not_my_call asks for a referral", () => {
    const t = loaded();
    const id = "co-acme-speech-p1";
    for (const via of ["request_sent", "accepted", "offer_sent"]) move(t, G, { lead: id, via });
    const { spawn } = move(t, G, { lead: id, via: "not_my_call" });
    expect(spawn?.node).toBe("prospect");
  });

  test("dropping into nurture or parked is not progress", () => {
    const t = loaded();
    move(t, G, { lead: "co-acme-speech-p0", via: "request_sent" });
    move(t, G, { lead: "co-acme-speech-p0", via: "no_accept" });
    move(t, G, { lead: "co-acme-speech-p1", via: "park" });
    const s = stats(t, G, depthOf(G));
    expect(s.conversion.requested).toEqual({ reached: 1, moved_on: 0 });
    expect(s.conversion.prospect).toEqual({ reached: 4, moved_on: 1 });
  });

  test("stats count where leads are, how far they got, and objections by stage", () => {
    const t = loaded();
    for (const via of ["request_sent", "accepted", "offer_sent", "latency_only", "settings_shared"]) move(t, G, { lead: "co-acme-speech-p0", via });
    for (const via of ["request_sent", "accepted", "offer_sent", "offer_no_reply", "latency_only"]) move(t, G, { lead: "co-acme-speech-p1", via });
    move(t, G, { lead: "co-parse-docs-p0", via: "request_sent" });
    place(t, G, "co-relay-voice-relay-labs--p0", "nurture", { set: true });
    const s = stats(t, G, depthOf(G));
    expect(s.leads).toBe(4);
    expect(s.now).toEqual({ plan_offered: 1, engaged: 1, requested: 1, nurture: 1 });
    expect(s.conversion.offered).toEqual({ reached: 2, moved_on: 2 });
    expect(s.conversion.requested).toEqual({ reached: 3, moved_on: 2 });
    expect(s.conversion.prospect).toEqual({ reached: 4, moved_on: 3 });
    expect(s.objections).toEqual([
      { id: "latency_only", at: "offered", count: 1 },
      { id: "latency_only", at: "nudged", count: 1 },
    ]);
  });
});
