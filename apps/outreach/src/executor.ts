import { blockers, type Capabilities, type Channel, type Mode, type Receipt } from "./model";
import type { Store } from "./store";
import { hasPriorActivity, matchCompany } from "./tracker-model";

export interface Transport {
  execute(receipt: Receipt): Promise<{ status: Receipt["status"]; detail: string }>;
}
export async function approveAndRun(
  store: Store,
  input: {
    prospectId: string;
    revision: number;
    stateVersion: number;
    reviewer: string;
    mode: Mode;
    channels: Channel[];
  },
  caps: Capabilities,
  transport: Transport,
) {
  if (!["test", "live"].includes(input.mode) || !input.reviewer?.trim())
    throw new Error("Choose execution mode and review owner.");
  const reserved = store.change((s) => {
    if (s.version !== input.stateVersion)
      throw new Error("Workspace changed. Refresh and review current content.");
    const p = s.prospects.find((x) => x.id === input.prospectId);
    const c = s.campaigns.find((x) => x.id === p?.campaignId);
    if (!p || !c || p.revision !== input.revision)
      throw new Error("Draft changed. Review the current version.");
    const errors = blockers(s, p, c, input.mode, input.channels, caps);
    if (errors.length) throw new Error(errors.join(" "));
    const approvalId = crypto.randomUUID();
    const at = new Date().toISOString();
    s.approvals.push({
      id: approvalId,
      prospectId: p.id,
      revision: p.revision,
      reviewer: input.reviewer.trim(),
      mode: input.mode,
      channels: input.channels,
      at,
    });
    const order: Channel[] = ["application", "email", "linkedin"];
    const receipts = order
      .filter((channel) => input.channels.includes(channel))
      .map((channel) => ({
        id: crypto.randomUUID(),
        prospectId: p.id,
        domain: p.domain,
        mode: input.mode,
        channel,
        status: "running" as const,
        at,
        detail: "Approved; waiting for execution.",
        snapshot: { prospect: structuredClone(p), campaign: structuredClone(c) },
        approvalId,
      }));
    s.receipts.push(...receipts);
    return receipts;
  });
  let stopped = false;
  for (const r of reserved) {
    let result: { status: Receipt["status"]; detail: string };
    const current = store.read();
    const tracked = matchCompany(current, r.snapshot.prospect);
    const trackerPaused =
      r.mode === "live" &&
      tracked &&
      (hasPriorActivity(tracked) ||
        current.tracker?.touchpoints.some((t) => t.companyId === tracked.id && t.kind !== "note"));
    const paused =
      trackerPaused || current.prospects.some((p) => p.domain === r.domain && p.status !== "new");
    if (stopped || paused)
      result = {
        status: "canceled",
        detail: "Stopped before execution. Review remaining actions again.",
      };
    else
      try {
        result = await transport.execute(r);
      } catch {
        result = {
          status: "uncertain",
          detail:
            "Execution did not return a confirmed result. Check destination before retrying; no automatic retry.",
        };
      }
    if (["uncertain", "canceled"].includes(result.status)) stopped = true;
    store.change((s) => {
      const item = s.receipts.find((x) => x.id === r.id)!;
      Object.assign(item, result, { at: new Date().toISOString() });
    });
  }
  return store.read();
}
