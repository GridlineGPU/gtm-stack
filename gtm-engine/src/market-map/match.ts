import type { Company, CompanyInput } from "./types";

/** Lowercase, strip accents and everything that isn't a letter or digit. "Itô Markets" -> "itomarkets". */
export function norm(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function slug(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

const TLD = /(ai|io|net|xyz|com|fi|dev)$/;

/** "Clore.ai" -> "clore", "io.net" -> "io". Only strips when the name had a dot before the suffix. */
function stripTld(name: string): string | null {
  const m = name.trim().match(/^(.+)\.([a-z]{2,4})$/i);
  if (!m || !TLD.test(m[2].toLowerCase())) return null;
  return norm(m[1]);
}

/** X handles: "get_hydrahost" -> "hydrahost", "vast_ai" -> "vastai", "SemiAnalysis_" -> "semianalysis". */
export function normHandle(h: string): string {
  let x = norm(h.replace(/^@/, ""));
  x = x.replace(/^(get|join|use|try)/, "");
  return x;
}

export function domainOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url.includes("://") ? url : `https://${url}`);
    return u.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return null;
  }
}

const GENERIC = new Set([
  "compute", "cloud", "network", "exchange", "labs", "lab", "ai", "markets", "market", "group", "inc",
  "capital", "finance", "financing", "data", "the", "protocol", "technologies", "tech", "gpu", "x", "co",
]);

function tokens(s: string): string[] {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** True when every token of the shorter name is in the longer one and at least one of them is distinctive.
 *  "NVIDIA Lepton" ~ "NVIDIA DGX Cloud Lepton", "Render" ~ "Render Network", but not "Compute Desk" ~ "Compute Exchange". */
function tokenSubset(a: string, b: string): boolean {
  const ta = tokens(a);
  const tb = tokens(b);
  const [small, big] = ta.length <= tb.length ? [ta, new Set(tb)] : [tb, new Set(ta)];
  if (small.length === 0) return false;
  if (!small.every((t) => big.has(t))) return false;
  return small.some((t) => !GENERIC.has(t) && t.length >= 4);
}

/**
 * "SF Compute (The San Francisco Compute Company)" -> base "SF Compute", extra "The San Francisco Compute Company".
 * "Mithril (formerly Foundry)" -> extra "Foundry". "X (with Y)" and "X (by Y)" name a partner or parent, so no extra.
 */
export function splitName(n: string): { base: string; extra: string | null } {
  const m = n.match(/^(.*?)\s*\((.+)\)\s*$/);
  if (!m) return { base: n.trim(), extra: null };
  const inner = m[2].trim();
  if (/^(with|by|part of|acquired by|backed by)\b/i.test(inner)) return { base: m[1].trim(), extra: null };
  return { base: m[1].trim(), extra: inner.replace(/^(formerly|fka|f\/k\/a|aka|now)\s+/i, "") };
}

/** Hosts whose second-level label says nothing about the company. */
const SHARED_HOSTS = new Set(["github", "linkedin", "twitter", "x", "medium", "substack", "notion", "google", "youtube", "crunchbase", "ycombinator", "wikipedia", "vercel", "netlify"]);

/** "https://www.getcomputable.com/pricing" -> "computable"; null for generic or shared hosts. */
export function domainRoot(url: string | null | undefined): string | null {
  const host = domainOf(url);
  if (!host) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null;
  let root = norm(labels[labels.length - 2]);
  if (SHARED_HOSTS.has(root)) return null;
  root = root.replace(/^(get|use|try|join)/, "");
  if (root.length < 4 || GENERIC.has(root)) return null;
  return root;
}

export interface MatchKeys {
  /** Exact normalised names and aliases. */
  names: Set<string>;
  /** Parenthetical extras ("The San Francisco Compute Company"). Matched only against exact names, since "(NVIDIA)" often names a parent. */
  extras: Set<string>;
  handles: Set<string>;
  domains: Set<string>;
  /** Website root label; compared with names and handles only, never with another root. */
  roots: Set<string>;
  /** Base names for token-overlap matching. Parentheticals are left out: "Brev.dev (NVIDIA)" must not match "NVIDIA Lepton". */
  raw: string[];
}

export function keysOf(c: Pick<Company, "name" | "aliases" | "handle" | "website"> | CompanyInput): MatchKeys {
  const all = [c.name, ...(c.aliases ?? [])].filter(Boolean) as string[];
  const names = new Set<string>();
  const extras = new Set<string>();
  const raw: string[] = [];
  for (const n of all) {
    const { base, extra } = splitName(n);
    raw.push(base);
    names.add(norm(base));
    const s = stripTld(base);
    if (s && s.length >= 3) names.add(s);
    if (extra) extras.add(norm(extra));
  }
  const handles = new Set<string>();
  if (c.handle) handles.add(normHandle(c.handle));
  const domains = new Set<string>();
  const d = domainOf(c.website ?? null);
  if (d) domains.add(d);
  const roots = new Set<string>();
  const r = domainRoot(c.website ?? null);
  if (r) roots.add(r);
  return { names, extras, handles, domains, roots, raw };
}

export function isMatch(a: MatchKeys, b: MatchKeys): boolean {
  for (const d of a.domains) if (b.domains.has(d)) return true;
  for (const h of a.handles) if (b.handles.has(h) || b.names.has(h)) return true;
  for (const h of b.handles) if (a.names.has(h)) return true;
  for (const n of a.names) if (b.names.has(n) || b.extras.has(n)) return true;
  for (const n of a.extras) if (b.names.has(n)) return true;
  for (const r of a.roots) if (b.names.has(r) || b.handles.has(r)) return true;
  for (const r of b.roots) if (a.names.has(r) || a.handles.has(r)) return true;
  for (const x of a.raw) for (const y of b.raw) if (tokenSubset(x, y)) return true;
  return false;
}

/** All existing companies an input could be. More than one means ambiguous: merge refuses and reports it. */
export function findMatches(input: CompanyInput, existing: Company[]): Company[] {
  const k = keysOf(input);
  return existing.filter((c) => isMatch(k, keysOf(c)));
}
