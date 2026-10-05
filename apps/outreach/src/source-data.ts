import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { setCompanyAliases } from "./tracker-model";

/**
 * Studio's source data lives in one folder (OUTREACH_SOURCE_DIR, default apps/outreach/data).
 * Its source.json names the data files, relative to the folder, and holds the instance-specific
 * settings that used to be hardcoded. Server-side only: the client bundle must not import this.
 */
export interface SourceConfig {
  /** Stored on the tracker; bump it to mark a new source snapshot. */
  version: string;
  files: {
    /** Researched companies by region: [{region, companies: [{name, people[], contacts, ...}]}]. */
    providers: string;
    /** Sheet rows: [{row, cells: {A2: company, B2: poc, C2: partner status, ...}}]. */
    sheet: string;
    /** Newer sheet snapshot merged on startup: {sourceUrl, capturedAt, rows}. */
    sheetLatest?: string;
    /** Companies added outside the sheet, already in TrackedCompany shape. */
    curated?: string;
    /** Published business-email research ledger. */
    emailResearch?: string;
    /** Sample prospects for a new workspace. */
    samples?: string;
  };
  /** Google Sheet edit URL; each company links to its row. */
  sheetUrl?: string;
  /** Where the providers research was published. */
  artifactUrl?: string;
  /** Sheet name -> research name, for companies the two sources spell differently. */
  aliases?: Record<string, string>;
  /** Company ids contacted before the tracker existed. They stay blocked from fresh live outreach. */
  knownPriorContact?: string[];
  /** Curated companies that get a draft, or a parked prospect, on startup. */
  curated?: {
    draft?: { id: string; domain: string }[];
    park?: { id: string; domain: string; reason: string }[];
  };
  /** Company id -> a wrong domain an earlier importer produced; replaced by the inferred one. */
  domainRepairs?: Record<string, string>;
}

export interface Sample {
  company: string;
  domain: string;
  contact: string;
  role: string;
  hook: string;
  source: string;
  linkedin: string;
  program: string;
}

const cache = new Map<string, unknown>();

export function sourceDir(): string {
  return resolve(process.env.OUTREACH_SOURCE_DIR || resolve(import.meta.dir, "../data"));
}

function readJson<T>(path: string): T {
  if (!cache.has(path)) cache.set(path, JSON.parse(readFileSync(path, "utf8")));
  return cache.get(path) as T;
}

export function sourceConfig(): SourceConfig {
  const config = readJson<SourceConfig>(resolve(sourceDir(), "source.json"));
  setCompanyAliases(config.aliases ?? {});
  return config;
}

/** A data file named in source.json, or `fallback` when the file is optional and not configured. */
export function sourceFile<T>(key: keyof SourceConfig["files"], fallback?: T): T {
  const name = sourceConfig().files[key];
  if (!name) {
    if (fallback === undefined) throw new Error(`source.json names no ${key} file`);
    return fallback;
  }
  return readJson<T>(resolve(sourceDir(), name));
}
