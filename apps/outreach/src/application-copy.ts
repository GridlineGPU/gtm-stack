import type { Prospect, State } from "./model";
import { matchCompany } from "./tracker-model";

export function applicationRecorded(s: State, p: Prospect): boolean {
  const c = matchCompany(s, p);
  if (
    c &&
    !s.tracker?.sheetSync?.conflicts.some(
      (x) => x.companyId === c.id && x.field === "partnerStatus",
    ) &&
    /^applied$/i.test(c.partnerStatus.trim())
  )
    return true;
  return (
    !!s.tracker?.touchpoints.some((t) => t.companyId === c?.id && t.kind === "applied") ||
    s.receipts.some(
      (r) =>
        r.domain === p.domain &&
        r.mode === "live" &&
        r.channel === "application" &&
        r.status === "submitted",
    )
  );
}
export function reconcileApplicationCopy(s: State) {
  for (const p of s.prospects) {
    const c = s.campaigns.find((c) => c.id === p.campaignId);
    if (
      c?.kind !== "provider" ||
      c.company.toLowerCase() !== "gridline" ||
      s.receipts.some((r) => r.prospectId === p.id && r.status === "running")
    )
      continue;
    const applied = applicationRecorded(s, p);
    let changed = false;
    for (const key of ["body", "linkedinBody"] as const) {
      const clean = p[key].replace(
        /We've already applied through [^\n]+?'s partner program\.\s*/g,
        "",
      );
      const at = clean.lastIndexOf("\n\n");
      const next =
        applied && at >= 0
          ? `${clean.slice(0, at + 2)}We've already applied through ${p.company}'s partner program. ${clean.slice(at + 2)}`
          : clean;
      if (next !== p[key]) {
        p[key] = next;
        changed = true;
      }
    }
    if (changed) {
      p.revision++;
      p.trackerChecked = false;
    }
  }
}
