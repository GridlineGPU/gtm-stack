import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { loadAdapters } from "./adapters";
import { installBundledSheet } from "./bundled-sheet";
import { installCuratedCompanies } from "./curated-companies";
import { addEmailResearch, syncPublishedEmailEvidence } from "./email-research";
import { approveAndRun } from "./executor";
import { firstCallCopy } from "./first-call";
import { blankProspect, type Campaign, canonicalDomain, compose, type Prospect } from "./model";
import { globalCampaignDefaults, prepareBatch } from "./preparation";
import { research } from "./research";
import { installFounderEmails, senderCampaign, switchSender } from "./senders";
import { sourceConfig, sourceFile } from "./source-data";
import { Store } from "./store";
import { changeTracker, trackerCsv } from "./tracker-actions";
import { matchCompany } from "./tracker-model";
import { installTracker } from "./tracker-source";

const root = resolve(import.meta.dir, "..");
const dataDir = process.env.OUTREACH_DATA_DIR || `${root}/.data`;
mkdirSync(dataDir, { recursive: true, mode: 0o700 });
const store = new Store(`${dataDir}/workspace.sqlite`);
store.recover();
if (!store.read().tracker) store.change(installTracker);
store.change(installBundledSheet);
const founderCampaign = store.read().campaigns.find((c) => c.id === "na-providers");
if (
  founderCampaign &&
  !store.read().campaigns.some((c) => c.sender === "Chinmay" && c.kind === "provider")
)
  store.change((s) =>
    senderCampaign(s, s.campaigns.find((c) => c.id === "na-providers")!, "Chinmay"),
  );
const adapters = await loadAdapters();
store.change(globalCampaignDefaults);
store.change(installFounderEmails);
store.change(firstCallCopy);
store.change((s) =>
  addEmailResearch(s, sourceFile("emailResearch", []), sourceConfig().domainRepairs),
);
store.change(installCuratedCompanies);
const csrf = crypto.randomUUID();
const port = Number(process.env.OUTREACH_PORT || 4310);
const origin = `http://127.0.0.1:${port}`;
const build = await Bun.build({
  entrypoints: [`${root}/src/client.tsx`],
  outdir: `${root}/dist`,
  target: "browser",
  minify: false,
});
if (!build.success) throw new Error(build.logs.join("\n"));
const headers = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const busy = (id: string) =>
  store.read().receipts.some((r) => r.prospectId === id && r.status === "running");
function text(value: unknown, max = 20_000): string {
  if (typeof value !== "string" || value.length > max) throw new Error("Invalid text field");
  return value;
}
function updateProspect(p: Prospect, patch: Record<string, unknown>) {
  if (
    ("email" in patch && patch.email !== p.email) ||
    (p.emailEvidence?.kind === "person" && "contact" in patch && patch.contact !== p.contact)
  )
    delete p.emailEvidence;
  const contactChanged = ["contact", "role", "email", "linkedin", "hook", "source"].some(
    (key) => key in patch && patch[key] !== p[key as keyof Prospect],
  );
  const programChanged = "program" in patch && patch.program !== p.program;
  for (const key of [
    "company",
    "region",
    "contact",
    "role",
    "email",
    "linkedin",
    "program",
    "formId",
    "hook",
    "source",
    "subject",
    "body",
    "linkedinBody",
  ] as const)
    if (key in patch) p[key] = text(patch[key]);
  // Changing identity/domain is a new prospect operation; it cannot bypass suppression history.
  for (const key of ["verified", "trackerChecked", "programReviewed"] as const)
    if (key in patch) {
      if (typeof patch[key] !== "boolean") throw new Error("Invalid verification flag");
      p[key] = patch[key];
    }
  if (patch.fields) {
    if (Array.isArray(patch.fields) || typeof patch.fields !== "object")
      throw new Error("Invalid form fields");
    p.fields = Object.fromEntries(
      Object.entries(patch.fields).map(([k, v]) => [text(k, 200), text(v)]),
    );
  }
  if (patch.status) {
    if (!["new", "replied", "meeting", "paused", "opted_out"].includes(String(patch.status)))
      throw new Error("Invalid status");
    if (p.status === "opted_out" && patch.status !== "opted_out")
      throw new Error("Opt-out cannot be cleared here.");
    p.status = patch.status as Prospect["status"];
  }
  if (contactChanged) p.verified = false;
  if (programChanged) p.programReviewed = false;
  p.revision++;
}

Bun.serve({
  hostname: "127.0.0.1",
  port,
  idleTimeout: 255,
  async fetch(req) {
    const url = new URL(req.url);
    if (req.headers.get("host") !== `127.0.0.1:${port}`)
      return json({ error: "Open the app through its loopback URL." }, 403);
    if (req.method === "GET") {
      if (url.pathname === "/api/tracker.csv")
        return new Response(trackerCsv(store.read()), {
          headers: {
            ...headers,
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": 'attachment; filename="outreach-tracker.csv"',
          },
        });
      if (url.pathname === "/api/state")
        return json({ state: store.read(), caps: adapters.caps, csrf });
      if (url.pathname === "/api/export")
        return new Response(JSON.stringify(store.read(), null, 2), {
          headers: {
            ...headers,
            "Content-Type": "application/json",
            "Content-Disposition": 'attachment; filename="outreach-workspace.json"',
          },
        });
      if (["/client.js", "/client.css"].includes(url.pathname))
        return new Response(Bun.file(`${root}/dist${url.pathname}`), { headers });
      if (url.pathname === "/")
        return new Response(await Bun.file(`${root}/src/index.html`).text(), {
          headers: { ...headers, "Content-Type": "text/html" },
        });
      return json({ error: "Not found" }, 404);
    }
    if (
      req.method !== "POST" ||
      req.headers.get("origin") !== origin ||
      req.headers.get("x-outreach-csrf") !== csrf ||
      !req.headers.get("content-type")?.startsWith("application/json")
    )
      return json({ error: "Request could not be verified. Reload the workspace." }, 403);
    try {
      if (Number(req.headers.get("content-length")) > 1_000_000)
        throw new Error("Import too large");
      const raw = await req.text();
      if (raw.length > 1_000_000) throw new Error("Import too large");
      const body = JSON.parse(raw);
      if (url.pathname === "/api/approve")
        return json({ state: await approveAndRun(store, body, adapters.caps, adapters) });
      if (url.pathname === "/api/tracker-prepare-batch") {
        const preparation = store.change((s) => prepareBatch(s, body));
        return json({ state: store.read(), preparation });
      }
      if (
        [
          "/api/tracker-resolve",
          "/api/tracker-update",
          "/api/tracker-log",
          "/api/tracker-prepare",
        ].includes(url.pathname)
      ) {
        store.change((s) => changeTracker(s, url.pathname.slice(5), body));
      } else if (url.pathname === "/api/sender") {
        store.change((s) =>
          switchSender(s, text(body.id, 300), body.revision, text(body.sender, 200)),
        );
      } else if (url.pathname === "/api/prospect") {
        store.change((s) => {
          const p = s.prospects.find((x) => x.id === body.id);
          if (!p || busy(p.id)) throw new Error("Prospect missing or executing");
          if (p.revision !== body.revision)
            throw new Error("Draft changed elsewhere. Refresh first.");
          updateProspect(p, body.patch);
          syncPublishedEmailEvidence(p, matchCompany(s, p));
        });
      } else if (url.pathname === "/api/add") {
        store.change((s) => {
          const c = s.campaigns.find((x) => x.id === body.campaignId);
          if (!c) throw new Error("Campaign missing");
          const domain = canonicalDomain(text(body.domain, 300));
          if (s.prospects.some((x) => x.domain === domain))
            throw new Error("Company already belongs to this workspace. Check its owner first.");
          const p = blankProspect(c.id, text(body.company, 300), domain);
          s.prospects.push({ ...p, ...compose(p, c) });
        });
      } else if (url.pathname === "/api/campaign") {
        store.change((s) => {
          const c = s.campaigns.find((x) => x.id === body.id);
          if (c && s.prospects.some((p) => p.campaignId === c.id && busy(p.id)))
            throw new Error("Campaign has executing actions");
          const input: Campaign = {
            id: c?.id || crypto.randomUUID(),
            name: text(body.name, 200),
            kind: body.kind,
            sender: text(body.sender, 200),
            senderEmail: text(body.senderEmail, 300),
            company: text(body.company, 200),
            offer: text(body.offer),
            ask: text(body.ask),
          };
          if (!["provider", "customer", "partnership"].includes(input.kind))
            throw new Error("Invalid campaign type");
          if (c) {
            Object.assign(c, input);
            for (const p of s.prospects.filter((p) => p.campaignId === c.id)) {
              Object.assign(p, compose(p, c));
              p.revision++;
              p.verified = false;
              p.trackerChecked = false;
            }
          } else s.campaigns.push(input);
        });
      } else if (url.pathname === "/api/compose") {
        store.change((s) => {
          const p = s.prospects.find((x) => x.id === body.id);
          const c = s.campaigns.find((c) => c.id === p?.campaignId);
          if (!p || !c || busy(p.id) || p.revision !== body.revision)
            throw new Error("Refresh current draft before composing");
          Object.assign(p, compose(p, c));
          p.revision++;
        });
      } else if (url.pathname === "/api/research") {
        const p = store.read().prospects.find((x) => x.id === body.id);
        const c = store.read().campaigns.find((c) => c.id === p?.campaignId);
        if (!p || !c || busy(p.id)) throw new Error("Prospect unavailable");
        const patch = await research(p, c);
        store.change((s) => {
          const current = s.prospects.find((x) => x.id === p.id)!;
          if (current.revision !== p.revision || busy(p.id))
            throw new Error("Draft changed while research ran. No changes saved.");
          updateProspect(current, patch);
        });
      } else if (url.pathname === "/api/import") {
        const incoming = body.data?.providers || body.data?.prospects || body.data;
        if (!Array.isArray(incoming) || incoming.length > 500)
          throw new Error(
            "Import an array, provider research JSON, or exported prospects (max 500).",
          );
        store.change((s) => {
          const c = s.campaigns.find((x) => x.id === body.campaignId);
          if (!c) throw new Error("Campaign missing");
          for (const row of incoming) {
            const domain = canonicalDomain(
              text(row.domain || row.contact_route || row.source, 1000),
            );
            if (s.prospects.some((p) => p.domain === domain)) continue;
            const p = blankProspect(c.id, text(row.company, 300), domain);
            updateProspect(p, {
              contact: row.contact || "",
              role: row.role || row.contact_evidence || "",
              region: row.region || "",
              email: row.email || "",
              linkedin: row.linkedin || "",
              program: row.program || row.program_url || "",
              hook: row.hook || row.personalization || "",
              source: row.source || row.sources?.[0] || row.contact_route || "",
            });
            Object.assign(p, compose(p, c));
            s.prospects.push(p);
          }
        });
      } else if (url.pathname === "/api/reset-test") {
        store.change((s) => {
          if (s.receipts.some((r) => r.status === "running"))
            throw new Error("Wait for execution to finish");
          s.receipts = s.receipts.filter((r) => r.mode !== "test");
          s.approvals = s.approvals.filter((a) => a.mode !== "test");
        });
      } else return json({ error: "Not found" }, 404);
      return json({ state: store.read() });
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : "Request failed" }, 400);
    }
  },
});
console.log(`Outreach Studio: ${origin}`);
