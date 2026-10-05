import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const origin = "http://127.0.0.1:4329";
const dir = mkdtempSync(join(tmpdir(), "outreach-api-test-"));
let child: ReturnType<typeof Bun.spawn>;
let csrf = "";
async function state() {
  return (await (await fetch(`${origin}/api/state`)).json()).state;
}
async function post(path: string, body: unknown, token = csrf) {
  return fetch(`${origin}/api/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin, "x-outreach-csrf": token },
    body: JSON.stringify(body),
  });
}
beforeAll(async () => {
  child = Bun.spawn([process.execPath, "src/server.ts"], {
    cwd: join(import.meta.dir, ".."),
    env: {
      ...process.env,
      OUTREACH_PORT: "4329",
      OUTREACH_DATA_DIR: dir,
      OUTREACH_ENABLE_LIVE: "false",
      OUTREACH_FORMS_FILE: "",
      OPENAI_API_KEY: "",
      OUTREACH_RESEARCH_MODEL: "",
      OUTREACH_SMTP_HOST: "",
      OUTREACH_SMTP_PASSWORD: "",
    },
    stdout: "ignore",
    stderr: "pipe",
  });
  for (let i = 0; i < 100; i++) {
    try {
      const data = await (await fetch(`${origin}/api/state`)).json();
      csrf = data.csrf;
      return;
    } catch {
      await Bun.sleep(50);
    }
  }
  throw new Error("Isolated API server did not start");
}, 15_000);
afterAll(async () => {
  child?.kill();
  if (child) await child.exited;
  rmSync(dir, { recursive: true, force: true });
});

test("mutation rejects missing CSRF without changing state", async () => {
  const before = await state();
  const r = await post(
    "add",
    { campaignId: "na-providers", company: "Invalid", domain: "invalid.example" },
    "",
  );
  expect(r.status).toBe(403);
  expect((await state()).version).toBe(before.version);
});
test("campaign changes regenerate copy without rewriting historical snapshots", async () => {
  const before = await state();
  const p = before.prospects[0];
  const approved = await post("approve", {
    prospectId: p.id,
    revision: p.revision,
    stateVersion: before.version,
    reviewer: "Test",
    mode: "test",
    channels: ["email"],
  });
  expect(approved.status).toBe(200);
  const campaign = (await state()).campaigns[0];
  const changed = await post("campaign", {
    ...campaign,
    sender: "Second Founder",
    company: "Example",
    offer: "We help teams review proposals.",
    kind: "customer",
  });
  expect(changed.status).toBe(200);
  const after = await state();
  expect(after.prospects[0].body).toContain("Second Founder");
  expect(after.prospects[0].body).not.toContain("I'm Akshit");
  expect(after.receipts[0].snapshot.campaign.sender).toBe("Akshit");
});
test("imports preserve existing owners and cannot inject sender or approval", async () => {
  const before = await state();
  const r = await post("import", {
    campaignId: "na-providers",
    data: [
      { company: "Duplicate", domain: "https://www.ionharbor.example/contact", sender: "Intruder" },
      {
        company: "Sample Buyer",
        domain: "buyer.example",
        contact: "Taylor",
        hook: "Demo fact",
        source: "https://buyer.example",
        verified: true,
        trackerChecked: true,
        body: "I'm a different founder",
      },
    ],
  });
  expect(r.status).toBe(200);
  const after = await state();
  expect(after.prospects).toHaveLength(before.prospects.length + 1);
  expect(after.prospects[0].company).toBe("Ion Harbor");
  const added = after.prospects.at(-1);
  expect(added.verified).toBe(false);
  expect(added.trackerChecked).toBe(false);
  expect(added.body).toContain("Second Founder");
});
test("opt-out is sticky and paused company cannot be approved", async () => {
  let s = await state();
  const id = s.prospects.at(-1).id;
  expect(
    (
      await post("prospect", {
        id,
        revision: s.prospects.at(-1).revision,
        patch: { status: "opted_out" },
      })
    ).status,
  ).toBe(200);
  s = await state();
  expect(
    (
      await post("prospect", {
        id,
        revision: s.prospects.at(-1).revision,
        patch: { status: "new" },
      })
    ).status,
  ).toBe(400);
  expect(
    (
      await post("approve", {
        prospectId: id,
        revision: s.prospects.at(-1).revision,
        stateVersion: s.version,
        reviewer: "Test",
        mode: "test",
        channels: ["email"],
      })
    ).status,
  ).toBe(400);
});
test("unconfigured research and live actions fail visibly", async () => {
  const s = await state();
  const p = s.prospects[1];
  expect((await post("research", { id: p.id })).status).toBe(400);
  const r = await post("approve", {
    prospectId: p.id,
    revision: p.revision,
    stateVersion: s.version,
    reviewer: "Test",
    mode: "live",
    channels: ["email"],
  });
  expect(r.status).toBe(400);
  expect((await r.json()).error).toContain("Live actions are disabled");
});

test("tracker API saves history without creating approvals and rejects stale duplicate logs", async () => {
  const s = await state();
  expect(s.tracker.companies.length).toBe(15);
  const c = s.tracker.companies.find((c: { id: string }) => c.id === "corewellgpu");
  const body = {
    id: c.id,
    revision: c.revision,
    entry: {
      actor: "Test operator",
      contact: "Sam Rivera",
      platform: "linkedin",
      kind: "sent",
      occurredAt: "2026-09-07",
      subject: "",
      message: "TEST FIXTURE historical message",
      evidence: "Isolated API test",
    },
  };
  expect((await post("tracker-log", body)).status).toBe(200);
  const saved = await state();
  expect(saved.tracker.touchpoints[0].message).toBe(body.entry.message);
  expect(saved.receipts).toEqual(s.receipts);
  expect(saved.approvals).toEqual(s.approvals);
  expect((await post("tracker-log", body)).status).toBe(400);
  expect((await state()).tracker.touchpoints.length).toBe(1);
  const csv = await fetch(`${origin}/api/tracker.csv`);
  expect(csv.headers.get("content-type")).toContain("text/csv");
  expect(await csv.text()).toContain(body.entry.message);
});
