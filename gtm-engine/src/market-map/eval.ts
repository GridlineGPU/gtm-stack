import { isMatch, keysOf } from "./match";
import { loadSeed, seedInputs } from "./seed";
import type { CompanyInput, RecallReport } from "./types";

/** URLs that mean the agent read the seed itself, so its recall proves nothing. */
export const CONTAMINATION = [/cobursa\.com/i, /(x|twitter)\.com\/AmusingVentures/i, /2099863926489911469/, /fxtwitter/i];

export function contaminationUrls(inputs: CompanyInput[]): string[] {
  const urls = inputs.flatMap((c) => [...(c.sources ?? []).map((s) => s.url), ...(c.evidence ?? []).map((e) => e.url)]);
  return [...new Set(urls.filter((u) => u && CONTAMINATION.some((re) => re.test(u))))];
}

/** How many seed companies (optionally one segment) the agent's output found, and what it found beyond them. */
export function recall(found: CompanyInput[], segment: string | null, seed = seedInputs(loadSeed())): RecallReport {
  const target = segment ? seed.filter((s) => s.segment === segment) : seed;
  const foundKeys = found.map((f) => ({ f, k: keysOf(f) }));
  const hit = new Set<number>();
  const missing: string[] = [];
  for (const s of target) {
    const sk = keysOf(s);
    const idx = foundKeys.findIndex(({ k }) => isMatch(sk, k));
    if (idx === -1) missing.push(s.name);
    else hit.add(idx);
  }
  const allSeedKeys = seed.map((s) => keysOf(s));
  const new_names = foundKeys.filter(({ k }) => !allSeedKeys.some((sk) => isMatch(sk, k))).map(({ f }) => f.name);
  const urls = contaminationUrls(found);
  const got = target.length - missing.length;
  return {
    segment,
    seed_total: target.length,
    found: got,
    recall: target.length ? Math.round((got / target.length) * 1000) / 1000 : 0,
    missing,
    new_names,
    contaminated: urls.length > 0,
    contamination_urls: urls,
  };
}
