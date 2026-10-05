import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { agentRun, buildPrompt, parseAgentJson } from "../src/market-map/agent";
import { recall } from "../src/market-map/eval";
import { extract, ingestPost, toPost } from "../src/market-map/ingest-x";
import { findMatches, isMatch, keysOf } from "../src/market-map/match";
import { editCompany, foldDuplicates, merge, newCompany } from "../src/market-map/merge";
import { loadSeed, seedInputs, seedStore } from "../src/market-map/seed";
import { Store } from "../src/market-map/store";
import { exportOps, importSubmissions } from "../src/market-map/sync";

const POST = toPost(JSON.parse(readFileSync("sources/x-2099863926489911469/post.json", "utf8")));

function seeded(): Store {
  const s = new Store(":memory:");
  seedStore(s);
  return s;
}

describe("seed", () => {
  test("matches the map image: 58 companies in seven boxes", () => {
    const seed = loadSeed();
    const counts = Object.fromEntries(seed.segments.map((s) => [s.id, s.companies.length]));
    expect(counts).toEqual({
      price_discovery: 5, spot_venues: 13, decentralised: 15, desks_brokers: 4, exchanges: 10, credit: 5, insurance_plumbing: 6,
    });
    expect(seedInputs().length).toBe(58);
  });

  test("seeding twice adds nothing the second time", () => {
    const s = seeded();
    expect(s.companies().length).toBe(58);
    const again = seedStore(s);
    expect(again.added.length).toBe(0);
    expect(again.ambiguous).toEqual([]);
    expect(s.companies().length).toBe(58);
  });

  test("no two seed companies match each other", () => {
    const seed = seedInputs();
    const clashes: string[] = [];
    for (let i = 0; i < seed.length; i++)
      for (let j = i + 1; j < seed.length; j++)
        if (isMatch(keysOf(seed[i]), keysOf(seed[j]))) clashes.push(`${seed[i].name} ~ ${seed[j].name}`);
    expect(clashes).toEqual([]);
  });

  test("roles are hypotheses from config", () => {
    const s = seeded();
    expect(s.company("shadeform")!.role).toBe("competitor");
    expect(s.company("runpod")!.role).toBe("supplier");
    expect(s.company("silicon-data")!.role).toBe("partner");
    expect(s.companies().every((c) => c.role_status === "hypothesis")).toBe(true);
  });
});

describe("dedupe on the real collisions in this data", () => {
  const cases: [string, Record<string, string>, string][] = [
    ["Vast.ai vs handle vast_ai", { name: "Vast", handle: "vast_ai" }, "vast-ai"],
    ["Hydra Host vs get_hydrahost", { name: "Hydra Host Inc", handle: "get_hydrahost" }, "hydra-host"],
    ["NVIDIA Lepton vs DGX Cloud Lepton", { name: "NVIDIA DGX Cloud Lepton" }, "nvidia-lepton"],
    ["BGC CIM vs BGC Group", { name: "BGC Group", handle: "BGCGroupInc" }, "bgc-cim"],
    ["Clore.ai vs Clore", { name: "Clore" }, "clore-ai"],
    ["Itô Markets vs Ito Markets", { name: "Ito Markets" }, "ito-markets"],
    ["Render vs Render Network", { name: "Render Network" }, "render"],
    ["io.net by handle", { name: "IO.NET", handle: "ionet" }, "io-net"],
  ];
  const s = seeded();
  for (const [label, input, id] of cases) {
    test(label, () => {
      const m = findMatches(input as any, s.companies());
      expect(m.map((c) => c.id)).toEqual([id]);
    });
  }

  // Names exactly as the first blind agent run returned them (2026-09-24).
  const agentNames: [Record<string, string>, string[]][] = [
    [{ name: "SF Compute (The San Francisco Compute Company)", website: "https://sfcompute.com" }, ["sf-compute"]],
    [{ name: "Mithril (formerly Foundry)", website: "https://mithril.ai" }, ["mithril"]],
    [{ name: "SaladCloud (Salad Technologies)", website: "https://salad.com" }, ["salad"]],
    [{ name: "Computable", website: "https://www.getcomputable.com" }, ["computable"]],
    [{ name: "Brev.dev (NVIDIA)", website: "https://developer.nvidia.com/brev" }, []],
    [{ name: "OneChronos (with Auctionomics)" }, []],
    [{ name: "SkyPilot", website: "https://github.com/skypilot-org/skypilot" }, []],
    [{ name: "Parasail" }, []],
  ];
  for (const [input, ids] of agentNames) {
    test(`agent name: ${input.name}`, () => {
      expect(findMatches(input as any, s.companies()).map((c) => c.id)).toEqual(ids);
    });
  }

  test("a duplicate the old matcher let in is folded into the seed company", () => {
    const t = seeded();
    // Simulate the duplicate: insert it directly, bypassing the matcher.
    t.putCompany(newCompany({ name: "SF Compute (The San Francisco Compute Company)", website: "https://sfcompute.com", one_liner: "Order book for GPU time." }, "sf-compute-the-san-francisco-compute-company", "agent", "candidate"));
    const { folded } = foldDuplicates(t);
    expect(folded).toEqual([{ from: "sf-compute-the-san-francisco-compute-company", into: "sf-compute" }]);
    const c = t.company("sf-compute")!;
    expect(c.website).toBe("https://sfcompute.com");
    expect(c.aliases).toContain("SF Compute (The San Francisco Compute Company)");
    expect(t.companies().length).toBe(58);
  });

  test("a parent company in parentheses doesn't match that parent's product", () => {
    const t = seeded();
    merge(t, [{ name: "NVIDIA DGX Cloud Lepton", website: "https://www.nvidia.com/en-us/data-center/dgx-cloud-lepton/" }], { origin: "agent" });
    expect(findMatches({ name: "Brev.dev (NVIDIA)", website: "https://developer.nvidia.com/brev" }, t.companies())).toEqual([]);
    // Stored as a candidate, it must still not fold into Lepton.
    merge(t, [{ name: "Brev.dev (NVIDIA)", website: "https://developer.nvidia.com/brev" }], { origin: "agent" });
    expect(t.company("brev-dev")!.aliases).toEqual(["Brev.dev (NVIDIA)"]);
    expect(foldDuplicates(t).folded).toEqual([]);
  });

  test("shared generic words don't merge different companies", () => {
    expect(findMatches({ name: "Compute Markets Inc" }, s.companies())).toEqual([]);
    expect(findMatches({ name: "Forward Compute" }, s.companies()).map((c) => c.id)).toEqual(["forward-compute"]);
  });
});

describe("ingest X post", () => {
  test("attaches evidence to 57 of 58; Forward Compute is only in the image", () => {
    const s = seeded();
    const res = ingestPost(s, POST, "sources/x-2099863926489911469");
    expect(res.companies_with_evidence).toBe(57);
    expect(res.companies_without_evidence).toEqual(["Forward Compute"]);
    expect(res.diff.added.length).toBe(0);
    expect(res.diff.ambiguous).toEqual([]);
  });

  test("evidence is the clause about the company, not the whole paragraph", () => {
    const s = seeded();
    const { evidence } = extract(POST, s.companies(), "x");
    const sfc = evidence.get("sf-compute")![0].text;
    expect(sfc).toContain("order book");
    expect(sfc).not.toContain("sealed-bid");
    expect(evidence.get("salad")![0].text).toContain("run the spot layer");
  });

  test("handles that aren't companies in the map are listed for review", () => {
    const s = seeded();
    const { unmatched_handles } = extract(POST, s.companies(), "x");
    expect(unmatched_handles.sort()).toEqual(["0xfishylosopher", "jessiedong_", "socialgraphvc"]);
  });

  test("re-ingesting the same post adds no duplicate evidence", () => {
    const s = seeded();
    ingestPost(s, POST, "f");
    const before = s.company("ornn")!.evidence.length;
    const again = ingestPost(s, POST, "f");
    expect(s.company("ornn")!.evidence.length).toBe(before);
    expect(again.diff.appended.length).toBe(0);
  });
});

describe("merge", () => {
  test("manual add enters as pending; agent discovery enters as candidate", () => {
    const s = seeded();
    const m = merge(s, [{ name: "OpenRouter", website: "https://openrouter.ai" }], { origin: "manual" });
    expect(m.added).toEqual([{ id: "openrouter", name: "OpenRouter", status: "pending" }]);
    const a = merge(s, [{ name: "Brand New GPU Router", website: "https://bngr.example" }], { origin: "agent" });
    expect(a.added[0].status).toBe("candidate");
  });

  test("a locked field survives an agent run; unlocked blanks get filled", () => {
    const s = seeded();
    editCompany(s, "shadeform", { one_liner: "Founder's wording." });
    const d = merge(
      s,
      [{ name: "Shadeform", one_liner: "Agent wording.", website: "https://shadeform.ai", funding: "Seed" }],
      { origin: "agent", overwrite: true },
    );
    const c = s.company("shadeform")!;
    expect(c.one_liner).toBe("Founder's wording.");
    expect(c.website).toBe("https://shadeform.ai");
    expect(d.skipped_locked.map((x) => x.field)).toEqual(["one_liner"]);
    expect(d.filled.map((x) => x.field).sort()).toEqual(["funding", "website"]);
  });

  test("agent can't move a company to another segment or role; it proposes", () => {
    const s = seeded();
    const d = merge(s, [{ name: "RunPod", segment: "decentralised", role: "competitor" }], { origin: "agent", overwrite: true });
    expect(s.company("runpod")!.segment).toBe("spot_venues");
    expect(s.company("runpod")!.role).toBe("supplier");
    expect(d.proposed.map((x) => x.field).sort()).toEqual(["role", "segment"]);
  });

  test("a different spelling becomes an alias, not a rename", () => {
    const s = seeded();
    merge(s, [{ name: "NVIDIA DGX Cloud Lepton" }], { origin: "agent" });
    const c = s.company("nvidia-lepton")!;
    expect(c.name).toBe("NVIDIA Lepton");
    expect(c.aliases).toContain("NVIDIA DGX Cloud Lepton");
  });

  test("an input that matches two companies is reported, not merged", () => {
    const s = seeded();
    const d = merge(s, [{ name: "Compute Exchange", handle: "ComputeDesk" }], { origin: "agent" });
    expect(d.ambiguous.length).toBe(1);
    expect(d.ambiguous[0].matches.sort()).toEqual(["compute-desk", "compute-exchange"]);
  });

  test("a new company with a parenthetical keeps the base name and a clean id", () => {
    const s = seeded();
    const d = merge(s, [{ name: "GPU.ai (BitCore AI Ltd.)" }], { origin: "agent" });
    expect(d.added[0].id).toBe("gpu-ai");
    expect(s.company("gpu-ai")!.aliases).toEqual(["GPU.ai (BitCore AI Ltd.)"]);
  });

  test("enrichment moves a pending manual add into the map", () => {
    const s = seeded();
    merge(s, [{ name: "OpenRouter" }], { origin: "manual" });
    merge(s, [{ name: "OpenRouter", one_liner: "Routes model requests across providers." }], { origin: "agent", overwrite: true });
    expect(s.company("openrouter")!.status).toBe("active");
  });
});

describe("recall eval", () => {
  test("perfect and partial recall on one box", () => {
    const seed = seedInputs();
    const box = seed.filter((c) => c.segment === "spot_venues");
    expect(recall(box, "spot_venues").recall).toBe(1);
    const partial = recall([{ name: "SF Compute" }, { name: "Vast" , handle: "vast_ai"}, { name: "Somebody New" }], "spot_venues");
    expect(partial.found).toBe(2);
    expect(partial.seed_total).toBe(13);
    expect(partial.new_names).toEqual(["Somebody New"]);
    expect(partial.contaminated).toBe(false);
  });

  test("citing the seed post marks the run contaminated", () => {
    const r = recall([{ name: "SF Compute", sources: [{ url: "https://www.cobursa.com/map" }] }], "spot_venues");
    expect(r.contaminated).toBe(true);
  });
});

describe("agent plumbing (no network)", () => {
  test("blind discover prompt names no seed company", () => {
    const p = buildPrompt("discover", { segment: "spot_venues", blind: true });
    const leaks = seedInputs().filter((c) => c.segment === "spot_venues").map((c) => c.name).filter((n) => p.includes(n));
    expect(leaks).toEqual([]);
    expect(p).toContain("Mode: discover (blind)");
  });

  test("parses a fenced reply with chatter around it", () => {
    const out = parseAgentJson('Here you go:\n```json\n{"companies":[{"name":"X"}]}\n```\nDone.');
    expect(out.companies[0].name).toBe("X");
  });

  test("a replayed discover run records recall and a diff", async () => {
    const s = seeded();
    const reply = JSON.stringify({ companies: [{ name: "Shadeform", website: "https://shadeform.ai", sources: [{ url: "https://shadeform.ai" }] }, { name: "Novel Router", sources: [{ url: "https://novel.example" }] }] });
    const run = await agentRun(s, { mode: "discover", segment: "spot_venues", blind: true, replay: reply });
    expect(run.status).toBe("done");
    expect(run.recall!.found).toBe(1);
    expect(run.diff!.added.map((a) => a.name)).toEqual(["Novel Router"]);
    expect(s.runs()[0].id).toBe(run.id);
  });

  test("a bad reply fails the run without touching companies", async () => {
    const s = seeded();
    const run = await agentRun(s, { mode: "discover", segment: "credit", replay: "no json here" });
    expect(run.status).toBe("failed");
    expect(s.companies().length).toBe(58);
  });
});

describe("web app sync", () => {
  test("export writes meta, every company and runs", () => {
    const s = seeded();
    const ops = exportOps(s);
    expect(ops[0].path).toBe("meta/map");
    expect(ops.filter((o) => o.path.startsWith("companies/")).length).toBe(58);
    expect(ops.every((o) => o.path.split("/").length === 2)).toBe(true);
  });

  test("submissions merge as pending and are marked merged", () => {
    const s = seeded();
    const { diff, updates } = importSubmissions(s, [
      { id: "sub1", name: "OpenRouter", website: "https://openrouter.ai", segment: "token_routers", status: "new" },
      { id: "sub2", name: "Shadeform", status: "new" },
      { id: "sub3", name: "Old one", status: "merged" },
    ]);
    expect(diff.added.map((a) => a.id)).toEqual(["openrouter"]);
    expect(s.company("openrouter")!.status).toBe("pending");
    expect(updates.map((u) => [u.path, (u.data as any).status, (u.data as any).merged_into])).toEqual([
      ["submissions/sub1", "merged", "openrouter"],
      ["submissions/sub2", "merged", "shadeform"],
    ]);
  });
});
