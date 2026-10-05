import { readFileSync } from "node:fs";
import { merge } from "./merge";
import { slug } from "./match";
import type { Store } from "./store";
import type { CompanyInput, MergeDiff, Role, Segment } from "./types";

export interface SeedFile {
  id: string;
  title: string;
  publisher: string;
  author: string;
  post_url: string;
  image_url: string;
  published: string;
  checked: string;
  scope: string;
  upstream: string[];
  segments: { id: string; label: string; companies: { name: string; handle: string | null; aliases?: string[] }[] }[];
}

export interface CompanyConfig {
  company: string;
  one_liner: string;
  home_segment: string;
  roles: Record<string, string>;
  default_role_by_segment: Record<string, Role>;
  role_overrides: Record<string, Role>;
  extra_segments: Segment[];
}

export const SEED_PATH = "seeds/cobursa-2026-09-15.json";
export const CONFIG_PATH = "config/company.json";

export function loadSeed(path = SEED_PATH): SeedFile {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function loadConfig(path = CONFIG_PATH): CompanyConfig {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function segments(seed = loadSeed(), cfg = loadConfig()): Segment[] {
  return [...seed.segments.map((s) => ({ id: s.id, label: s.label })), ...cfg.extra_segments];
}

/** Flat list of seed companies with their segment and hypothesised role for this company. */
export function seedInputs(seed = loadSeed(), cfg = loadConfig()): CompanyInput[] {
  const out: CompanyInput[] = [];
  for (const seg of seed.segments) {
    for (const c of seg.companies) {
      const role = cfg.role_overrides[slug(c.name)] ?? cfg.default_role_by_segment[seg.id] ?? "unknown";
      out.push({
        name: c.name,
        handle: c.handle,
        aliases: c.aliases ?? [],
        segment: seg.id,
        role,
        role_status: "hypothesis",
        sources: [{ url: seed.post_url, title: `${seed.title} (${seed.publisher})`, accessed: seed.checked }],
      });
    }
  }
  return out;
}

export function seedStore(store: Store, seed = loadSeed(), cfg = loadConfig()): MergeDiff {
  return merge(store, seedInputs(seed, cfg), { origin: "seed", newStatus: "active", overwrite: false });
}
