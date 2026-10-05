import { afterEach, describe, expect, test } from "bun:test";
import { approveAndRun, type Transport } from "../src/executor";
import {
  blockers,
  type Capabilities,
  type Channel,
  canonicalDomain,
  compose,
  type Receipt,
} from "../src/model";
import { Store } from "../src/store";

const stores: Store[] = [];
const caps: Capabilities = {
  liveEnabled: false,
  smtp: false,
  smtpFrom: "",
  research: false,
  forms: [],
};
function setup() {
  const store = new Store(":memory:");
  stores.push(store);
  const calls: Receipt[] = [];
  const transport: Transport = {
    async execute(r) {
      calls.push(r);
      return { status: "simulated", detail: "Test capture" };
    },
  };
  return { store, calls, transport };
}
function approval(store: Store, channels: Channel[] = ["email"]) {
  const s = store.read();
  return {
    prospectId: s.prospects[0].id,
    revision: s.prospects[0].revision,
    stateVersion: s.version,
    reviewer: "Test reviewer",
    mode: "test" as const,
    channels,
  };
}
afterEach(() => {
  for (const store of stores.splice(0)) store.db.close();
});
describe("approval-bound execution", () => {
  test("one approval runs application first, then email and handoff with immutable snapshots", async () => {
    const { store, calls, transport } = setup();
    await approveAndRun(
      store,
      approval(store, ["linkedin", "email", "application"]),
      caps,
      transport,
    );
    expect(calls.map((r) => r.channel)).toEqual(["application", "email", "linkedin"]);
    expect(store.read().approvals).toHaveLength(1);
    store.change((s) => {
      s.prospects[0].body = "Edited later";
    });
    expect(store.read().receipts[1].snapshot.prospect.body).not.toBe("Edited later");
  });
  test("stale draft or workspace rejects without contacting transport", async () => {
    const { store, calls, transport } = setup();
    const old = approval(store);
    store.change((s) => {
      s.prospects[0].body = "Changed";
      s.prospects[0].revision++;
    });
    await expect(approveAndRun(store, old, caps, transport)).rejects.toThrow("Workspace changed");
    expect(calls).toHaveLength(0);
  });
  test("concurrent duplicate clicks dispatch only once", async () => {
    const { store, calls, transport } = setup();
    const input = approval(store);
    const results = await Promise.allSettled([
      approveAndRun(store, input, caps, transport),
      approveAndRun(store, input, caps, transport),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
  test("uncertain application blocks email and never auto-retries", async () => {
    const { store, calls } = setup();
    const transport: Transport = {
      async execute(r) {
        calls.push(r);
        throw new Error("Timeout after submit");
      },
    };
    await approveAndRun(store, approval(store, ["application", "email"]), caps, transport);
    expect(store.read().receipts.map((r) => r.status)).toEqual(["uncertain", "canceled"]);
    await expect(
      approveAndRun(store, approval(store, ["application"]), caps, transport),
    ).rejects.toThrow("already attempted");
    expect(calls).toHaveLength(1);
  });
  test("pause during first action cancels the remaining actions", async () => {
    const { store, calls } = setup();
    const transport: Transport = {
      async execute(r) {
        calls.push(r);
        store.change((s) => {
          s.prospects[0].status = "replied";
        });
        return { status: "simulated", detail: "First action" };
      },
    };
    await approveAndRun(store, approval(store, ["application", "email"]), caps, transport);
    expect(calls).toHaveLength(1);
    expect(store.read().receipts[1].status).toBe("canceled");
  });
  test("live mode requires connected identity, verification and program prerequisite", async () => {
    const { store, calls, transport } = setup();
    await expect(
      approveAndRun(store, { ...approval(store), mode: "live" }, caps, transport),
    ).rejects.toThrow("Live actions are disabled");
    expect(calls).toHaveLength(0);
    const s = store.read();
    const live = { ...caps, liveEnabled: true, smtp: true, smtpFrom: "other@example.com" };
    expect(
      blockers(s, s.prospects[0], s.campaigns[0], "live", ["email"], live).join(" "),
    ).toContain("matching this campaign");
  });
  test("another founder cannot bypass company suppression", async () => {
    const { store, calls, transport } = setup();
    store.change((s) => {
      s.prospects.push({
        ...s.prospects[0],
        id: "other",
        campaignId: "other-owner",
        status: "opted_out",
      });
    });
    await expect(approveAndRun(store, approval(store), caps, transport)).rejects.toThrow(
      "another owner",
    );
    expect(calls).toHaveLength(0);
  });
  test("successful test actions do not block an independent live review", async () => {
    const { store, transport } = setup();
    await approveAndRun(store, approval(store), caps, transport);
    const s = store.read();
    expect(
      blockers(s, s.prospects[0], s.campaigns[0], "live", ["email"], caps).join(" "),
    ).not.toContain("already attempted");
  });
  test("restart marks in-flight operations uncertain", () => {
    const { store } = setup();
    store.change((s) => {
      s.receipts.push({
        id: "r",
        prospectId: s.prospects[0].id,
        domain: s.prospects[0].domain,
        mode: "live",
        channel: "email",
        status: "running",
        at: "",
        detail: "",
        approvalId: "a",
        snapshot: { campaign: s.campaigns[0], prospect: s.prospects[0] },
      });
    });
    store.recover();
    expect(store.read().receipts[0].status).toBe("uncertain");
  });
  test("empty and duplicate channel approvals rejected", async () => {
    const { store, calls, transport } = setup();
    for (const channels of [[], ["email", "email"]] as Channel[][])
      await expect(
        approveAndRun(store, approval(store, channels), caps, transport),
      ).rejects.toThrow("distinct actions");
    expect(calls).toHaveLength(0);
  });
  test("customer copy uses new sender without inheriting provider applications", () => {
    const { store } = setup();
    const s = store.read();
    const copy = compose(s.prospects[0], {
      ...s.campaigns[0],
      kind: "customer",
      sender: "Other Founder",
      company: "Example",
      offer: "We help teams review proposals.",
    });
    expect(copy.body).toContain("Other Founder");
    expect(copy.body).not.toContain("I'm Akshit");
    expect(copy.subject).toContain("quick introduction");
  });
  test("canonical domains deduplicate website variants and reject unsafe schemes", () => {
    expect(canonicalDomain("https://www.Example.com/contact")).toBe("example.com");
    expect(() => canonicalDomain("file:///etc/passwd")).toThrow();
  });
});
