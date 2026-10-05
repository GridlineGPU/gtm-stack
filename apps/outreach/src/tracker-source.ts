import type { State } from "./model";
import { sourceConfig, sourceFile } from "./source-data";
import { companyKey, type Person, type TrackedCompany } from "./tracker-model";

interface ProviderGroup {
  region: string;
  companies: {
    name: string;
    location: string;
    summary: string;
    judgment: string;
    hook: string;
    contacts: Record<string, string>;
    source: { url: string };
    people: { name: string; role: string; bio: string; url?: string; message: string }[];
  }[];
}
interface SheetSnapshotRow {
  row: number;
  cells: Record<string, string | undefined>;
}

export function sourceCompanies(): TrackedCompany[] {
  const config = sourceConfig();
  const prior = new Set(config.knownPriorContact ?? []);
  const sheet = sourceFile<SheetSnapshotRow[]>("sheet");
  const catalog = sourceFile<ProviderGroup[]>("providers").flatMap((group) =>
    group.companies.map((c) => ({ ...c, region: group.region })),
  );
  return sheet.map((row) => {
    const value = (col: string) => row.cells[col + row.row] || "";
    const a = catalog.find((c) => companyKey(c.name) === companyKey(value("A")));
    if (!a) throw new Error(`Unmatched sheet company: ${value("A")}`);
    const id = companyKey(a.name);
    const people: Person[] = a.people.map((p, i) => ({
      id: `${id}-${i}`,
      name: p.name,
      role: p.role,
      bio: p.bio,
      profile: p.url || "",
      referenceDraft: p.message,
      source: "artifact",
    }));
    if (value("B") && !people.some((p) => companyKey(p.name) === companyKey(value("B"))))
      people.push({
        id: `${id}-sheet`,
        name: value("B"),
        role: "Sheet POC",
        bio: "Named in sheet; identity and role need verification.",
        profile: "",
        referenceDraft: "",
        source: "sheet",
      });
    return {
      id,
      name: a.name,
      sheetName: value("A"),
      region: a.region,
      location: value("G") || a.location,
      poc: value("B"),
      owner: value("H"),
      partnerStatus: value("C"),
      salesStatus: value("F"),
      ncp: value("E"),
      nextStep: "",
      followUp: "",
      notes: "",
      revision: 1,
      summary: a.summary,
      hook: a.hook,
      routing: a.judgment,
      routes: a.contacts,
      story: value("D") || a.source.url,
      artifactSource: config.artifactUrl ?? "",
      sheetSource: config.sheetUrl ? `${config.sheetUrl}#gid=0&range=A${row.row}:H${row.row}` : "",
      sheetRow: row.row,
      sheetValues: Object.fromEntries("ABCDEFGH".split("").map((col) => [col, value(col)])),
      people,
      knownPriorContact: prior.has(id),
    };
  });
}
// One-time source snapshot: restarting never overwrites local tracking edits or history.
export function installTracker(s: State): boolean {
  if (s.tracker) return false;
  s.tracker = {
    sourceVersion: sourceConfig().version,
    importedAt: new Date().toISOString(),
    companies: sourceCompanies(),
    touchpoints: [],
  };
  for (const p of s.prospects) {
    const c = s.tracker.companies.find((c) => companyKey(c.name) === companyKey(p.company));
    if (c) p.companyId = c.id;
  }
  return true;
}
