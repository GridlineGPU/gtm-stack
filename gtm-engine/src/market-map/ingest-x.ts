import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { merge } from "./merge";
import { normHandle } from "./match";
import type { Store } from "./store";
import type { Company, CompanyInput, Evidence, MergeDiff } from "./types";

export interface XPost {
  id: string;
  url: string;
  author: { name: string; screen_name: string };
  created_at: string;
  text: string;
  image_urls: string[];
  likes?: number;
  replies?: number;
}

/** Parse an X status URL into handle and id. */
export function parseStatusUrl(url: string): { handle: string; id: string } {
  const m = url.match(/(?:x|twitter)\.com\/([^/]+)\/status\/(\d+)/);
  if (!m) throw new Error(`Not an X status URL: ${url}`);
  return { handle: m[1], id: m[2] };
}

/** Fetch via the public fxtwitter JSON mirror, which needs no API key. Saves post.json and images under sources/. */
export async function fetchPost(url: string, dir = "sources"): Promise<{ post: XPost; folder: string }> {
  const { handle, id } = parseStatusUrl(url);
  const folder = join(dir, `x-${id}`);
  mkdirSync(folder, { recursive: true });
  const cached = join(folder, "post.json");
  let raw: any;
  if (existsSync(cached)) {
    raw = JSON.parse(readFileSync(cached, "utf8"));
  } else {
    const res = await fetch(`https://api.fxtwitter.com/${handle}/status/${id}`);
    if (!res.ok) throw new Error(`fxtwitter returned ${res.status} for ${url}`);
    raw = await res.json();
    writeFileSync(cached, JSON.stringify(raw, null, 2));
  }
  const post = toPost(raw);
  for (const [i, img] of post.image_urls.entries()) {
    const file = join(folder, i === 0 ? "image.jpg" : `image-${i}.jpg`);
    if (existsSync(file)) continue;
    const r = await fetch(img);
    if (r.ok) writeFileSync(file, new Uint8Array(await r.arrayBuffer()));
  }
  return { post, folder };
}

export function toPost(raw: any): XPost {
  const t = raw.tweet ?? raw;
  return {
    id: t.id,
    url: t.url,
    author: { name: t.author?.name, screen_name: t.author?.screen_name },
    created_at: new Date(t.created_at).toISOString(),
    // X auto-links bare domains ("Vast.ai" arrives as "http://Vast.ai"); put the name back.
    text: String(t.text ?? "").replace(/\bhttps?:\/\/([A-Za-z0-9-]+\.[A-Za-z]{2,})(?=[\s,.;)]|$)/g, "$1"),
    image_urls: (t.media?.photos ?? []).map((p: any) => p.url),
    likes: t.likes,
    replies: t.replies,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((p) => p.split(/(?<=[.!?])\s+(?=[A-Z@])/))
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function mentionRes(c: Pick<Company, "name" | "aliases" | "handle">): RegExp[] {
  const res: RegExp[] = [];
  if (c.handle) res.push(new RegExp(`@${escapeRe(c.handle)}(?![A-Za-z0-9_])`, "i"));
  for (const n of [c.name, ...c.aliases]) {
    res.push(new RegExp(`(?<![A-Za-z0-9_@/])${escapeRe(n)}(?![A-Za-z0-9_])`));
  }
  return res;
}

/**
 * The clause of `sentence` that mentions the company. List clauses ("Salad and Clore run the spot layer")
 * are too short to stand alone, so those fall back to the whole sentence.
 */
function clauseFor(sentence: string, re: RegExp): string {
  const clauses = sentence.split(/,\s+(?=(?:and\s+)?@)|;\s+/);
  const hit = clauses.find((cl) => re.test(cl));
  if (!hit || hit.length < 45) return sentence;
  return hit.replace(/^and\s+/, "").trim();
}

export interface Extraction {
  evidence: Map<string, Evidence[]>;
  unmatched_handles: string[];
}

/** Attach every sentence that mentions a known company as evidence, and list handles that match nobody. */
export function extract(post: XPost, companies: Company[], sourceId: string): Extraction {
  const evidence = new Map<string, Evidence[]>();
  const date = post.created_at.slice(0, 10);
  for (const s of sentences(post.text)) {
    for (const c of companies) {
      for (const re of mentionRes(c)) {
        if (!re.test(s)) continue;
        const list = evidence.get(c.id) ?? [];
        const text = clauseFor(s, re);
        if (!list.some((e) => e.text === text)) list.push({ text, url: post.url, date, source_id: sourceId });
        evidence.set(c.id, list);
        break;
      }
    }
  }
  const known = new Set(companies.flatMap((c) => (c.handle ? [normHandle(c.handle)] : [])));
  const handles = [...post.text.matchAll(/@([A-Za-z0-9_]{2,15})/g)].map((m) => m[1]);
  const unmatched = [...new Set(handles)].filter((h) => !known.has(normHandle(h)));
  return { evidence, unmatched_handles: unmatched };
}

export interface IngestResult {
  source_id: string;
  post: XPost;
  diff: MergeDiff;
  companies_with_evidence: number;
  companies_without_evidence: string[];
  unmatched_handles: string[];
}

/** Store the post as a source and attach its sentences to the companies it mentions. Adds no companies. */
export function ingestPost(store: Store, post: XPost, folder: string): IngestResult {
  const sourceId = `x-${post.id}`;
  const companies = store.companies();
  const { evidence, unmatched_handles } = extract(post, companies, sourceId);
  store.putSource(sourceId, post.url, { ...post, folder, unmatched_handles });

  const inputs: CompanyInput[] = [];
  for (const c of companies) {
    const ev = evidence.get(c.id);
    if (ev) inputs.push({ name: c.name, handle: c.handle, evidence: ev });
  }
  const diff = merge(store, inputs, { origin: "seed", overwrite: false });
  return {
    source_id: sourceId,
    post,
    diff,
    companies_with_evidence: evidence.size,
    companies_without_evidence: companies.filter((c) => !evidence.has(c.id)).map((c) => c.name),
    unmatched_handles,
  };
}
