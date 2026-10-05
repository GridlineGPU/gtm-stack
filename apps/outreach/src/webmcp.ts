import type { State } from "./model";

interface Registry {
  registerTool(
    tool: {
      name: string;
      title: string;
      description: string;
      inputSchema: object;
      annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
      execute(input: unknown): unknown;
    },
    options: { signal: AbortSignal },
  ): void | Promise<void>;
}

export function installReviewTools(
  getState: () => State | undefined,
  openReview: (id: string) => void,
) {
  const registry = (document as Document & { modelContext?: Registry }).modelContext;
  const lifecycle = new AbortController();
  if (!registry?.registerTool) return () => {};
  const register = (tool: Parameters<Registry["registerTool"]>[0]) => {
    try {
      void Promise.resolve(registry.registerTool(tool, { signal: lifecycle.signal })).catch(
        () => {},
      );
    } catch {
      /* Optional browser capability; UI remains available. */
    }
  };
  register({
    name: "list_outreach_review_prospects",
    title: "List outreach prospects",
    description:
      "Read campaign IDs and prospect review status from this local workspace. Does not research, edit, approve or send.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute() {
      const state = getState();
      return {
        prospects:
          state?.prospects.map((p) => ({
            id: p.id,
            company: p.company,
            campaignId: p.campaignId,
            status: p.status,
            revision: p.revision,
          })) || [],
      };
    },
  });
  register({
    name: "open_outreach_approval",
    title: "Open an outreach review",
    description:
      "Stage the exact draft in the visible approval dialog for a human. Does not approve, send, submit, or change persisted data. Unsaved edits must be saved first.",
    inputSchema: {
      type: "object",
      properties: { prospectId: { type: "string" } },
      required: ["prospectId"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    execute(input) {
      if (
        !input ||
        typeof input !== "object" ||
        !("prospectId" in input) ||
        typeof input.prospectId !== "string"
      )
        throw new Error("prospectId is required");
      const state = getState();
      if (!state?.prospects.some((p) => p.id === input.prospectId))
        throw new Error("Prospect not found");
      openReview(input.prospectId);
      return { status: "review_opened", approved: false, sent: false };
    },
  });
  return () => lifecycle.abort();
}
