import { useEffect, useRef, useState } from "react";
import { type State, safeLink } from "./model";
import {
  activityKinds,
  hasReached,
  inferCompanyDomain,
  matchCompany,
  needsHistory,
  type Person,
  platforms,
  type TrackedCompany,
  trackedReceipts,
} from "./tracker-model";
import "./tracker.css";

function Link({ url, children }: { url: string; children: string }) {
  return safeLink(url) ? (
    <a href={safeLink(url)} target="_blank" rel="noreferrer">
      {children} ↗
    </a>
  ) : (
    <span>{children}: unavailable</span>
  );
}
export function TrackerView({
  state,
  post,
  onOpen,
}: {
  state: State;
  post: (path: string, body: unknown) => Promise<State>;
  onOpen: (id: string, s: State, region?: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [region, setRegion] = useState("");
  const [owner, setOwner] = useState("");
  const [status, setStatus] = useState("");
  const [scope, setScope] = useState("");
  const [selected, setSelected] = useState("");
  const drawer = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (selected && drawer.current && !drawer.current.open) drawer.current.showModal();
  }, [selected]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showColumns, setShowColumns] = useState(false);
  const [batchCampaign, setBatchCampaign] = useState(state.campaigns[0]?.id || "");
  const [batchSender, setBatchSender] = useState("Akshit");
  const tracker = state.tracker;
  if (!tracker) return <p>Tracker source has not been installed.</p>;
  const companies = tracker.companies;
  const current = companies.find((c) => c.id === selected);
  const filtered = companies.filter(
    (c) =>
      (!region || c.region === region) &&
      (!owner || (c.owner || "Unassigned") === owner) &&
      (!status || (c.salesStatus || "Not recorded") === status) &&
      (!scope ||
        (scope === "reached"
          ? hasReached(state, c)
          : scope === "missing"
            ? needsHistory(state, c)
            : !hasReached(state, c))) &&
      [c.name, c.sheetName, c.poc, c.owner, ...c.people.map((p) => p.name)]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  async function run(path: string, body: unknown) {
    setPending(true);
    setError("");
    setNotice("");
    try {
      const s = await post(path, body);
      setNotice(
        path === "tracker-log" ? "Activity recorded. Nothing sent." : "Saved to local workspace.",
      );
      return s;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
      throw e;
    } finally {
      setPending(false);
    }
  }
  async function prepare(companies: TrackedCompany[]) {
    try {
      const next = await run("tracker-prepare-batch", {
        campaignId: batchCampaign,
        sender: batchSender,
        companies: companies.map(({ id, revision }) => ({ id, revision })),
      });
      const missing = companies.filter(
        (c) => !next.prospects.some((p) => matchCompany(next, p)?.id === c.id),
      );
      setNotice(
        `${next.prospects.length - state.prospects.length} drafts added. Existing drafts preserved. ${missing.length ? `Website or duplicate domain needs review: ${missing.map((c) => c.name).join(", ")}.` : "All selected companies have a review draft."} Nothing sent.`,
      );
    } catch {
      /* run displays the error */
    }
  }
  async function markActivity(c: TrackedCompany, platform: "email" | "linkedin" | "application") {
    const prospect = state.prospects.find((p) => matchCompany(state, p)?.id === c.id);
    const campaign = prospect
      ? state.campaigns.find((item) => item.id === prospect.campaignId)
      : undefined;
    const label =
      platform === "application"
        ? "partner application submitted"
        : `${platform === "linkedin" ? "LinkedIn" : "Email"} sent`;
    const missing = !prospect
      ? "Prepare a draft first so Studio can preserve the exact message."
      : platform === "email" && (!prospect.email || !prospect.body.trim())
        ? "Add the recipient email and prepare the email before marking it sent."
        : platform === "linkedin" && (!prospect.linkedin || !prospect.linkedinBody.trim())
          ? "Add the LinkedIn profile and prepare the message before marking it sent."
          : platform === "application" &&
              !(prospect.program || c.routes.partner) &&
              !Object.keys(prospect.fields).length
            ? "Add the partner-program route or application details before marking it submitted."
            : "";
    if (missing) {
      setSelected(c.id);
      setNotice(missing);
      return;
    }
    const actor = campaign?.sender || c.owner || batchSender;
    const contact = prospect!.contact || c.poc || `${c.name} team`;
    if (!window.confirm(`Confirm ${label} to ${contact} as ${actor}?`)) return;
    const message =
      platform === "email"
        ? prospect!.body
        : platform === "linkedin"
          ? prospect!.linkedinBody
          : Object.keys(prospect!.fields).length
            ? JSON.stringify(prospect!.fields, null, 2)
            : "Application submitted; form response was not available in Studio.";
    try {
      await run("tracker-log", {
        id: c.id,
        revision: c.revision,
        entry: {
          actor,
          contact,
          platform,
          kind: platform === "application" ? "applied" : "sent",
          occurredAt: new Date().toISOString().slice(0, 10),
          subject: platform === "email" ? prospect!.subject : "",
          message,
          evidence:
            platform === "application"
              ? prospect!.program || c.routes.partner || "Marked in Studio"
              : platform === "email"
                ? prospect!.email
                : prospect!.linkedin,
        },
      });
      setNotice(`${label[0].toUpperCase()}${label.slice(1)} recorded with message snapshot.`);
    } catch {
      /* run displays the error */
    }
  }
  return (
    <section className="tracker" aria-label="Company outreach tracker">
      <div className="tracker-stats">
        <div>
          <strong>{companies.length}</strong>
          <span>Companies</span>
        </div>
        <div>
          <strong>{companies.reduce((n, c) => n + c.people.length, 0)}</strong>
          <span>Contact entries</span>
        </div>
        <div>
          <strong>{companies.filter((c) => hasReached(state, c)).length}</strong>
          <span>Prior activity recorded</span>
        </div>
        <div>
          <strong>{companies.filter((c) => needsHistory(state, c)).length}</strong>
          <span>History to complete</span>
        </div>
      </div>
      <details className="tracker-sync-details">
        <summary>Sheet sync & export</summary>
        <div className="tracker-source">
          <span>
            {tracker?.sheetSync
              ? `Sheet checked ${new Date(tracker.sheetSync.checkedAt).toLocaleString()} · ${tracker.sheetSync.changed} companies changed on last check. Local edits preserved.`
              : "Sheet + artifact snapshot · Awaiting first sheet check. Local edits preserved."}
          </span>
          <a href="/api/tracker.csv" download>
            Export tracker CSV ↓
          </a>
        </div>
      </details>
      {!!tracker?.sheetSync?.conflicts.length && (
        <section className="tracker-notice" aria-label="Sheet conflicts">
          <strong>Sheet changes need review</strong>
          {tracker.sheetSync.conflicts.map((x) => (
            <div key={`${x.companyId}-${x.field}`}>
              <p>
                {x.company} · {x.field}: local “{x.local || "Empty"}”; sheet “{x.sheet || "Empty"}”
              </p>
              {["local", "sheet"].map((choice) => (
                <button
                  type="button"
                  key={choice}
                  disabled={pending}
                  onClick={() =>
                    void run("tracker-resolve", {
                      id: x.companyId,
                      revision: companies.find((c) => c.id === x.companyId)?.revision,
                      field: x.field,
                      choice,
                    })
                  }
                >
                  {choice === "local" ? "Keep local" : "Use sheet"}
                </button>
              ))}
            </div>
          ))}
        </section>
      )}
      {!!tracker?.sheetSync?.missing.length && (
        <p className="tracker-notice">
          Missing from latest sheet; kept in tracker: {tracker.sheetSync.missing.join(", ")}
        </p>
      )}
      <div className="tracker-filters">
        <label className="tracker-search">
          Search companies or people
          <input
            aria-label="Search companies or people"
            placeholder="Company, person or owner…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <label>
          Region
          <select aria-label="Region" value={region} onChange={(e) => setRegion(e.target.value)}>
            <option value="">All regions</option>
            {[...new Set(companies.map((c) => c.region))].sort().map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
        </label>
        <label>
          Send new drafts as
          <select
            aria-label="Send new drafts as"
            value={batchSender}
            onChange={(e) => setBatchSender(e.target.value)}
          >
            <option>Akshit</option>
            <option>Chinmay</option>
          </select>
        </label>
        <details className="more-filters">
          <summary>More filters</summary>
          <div className="extra-filters">
            <label>
              Owner
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">All owners</option>
                {[...new Set(companies.map((c) => c.owner || "Unassigned"))].sort().map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <label>
              Sales stage
              <select value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">All stages</option>
                {[...new Set(companies.map((c) => c.salesStatus || "Not recorded"))]
                  .sort()
                  .map((v) => (
                    <option key={v}>{v}</option>
                  ))}
              </select>
            </label>
            <label>
              History
              <select value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="">All companies</option>
                <option value="reached">Prior activity</option>
                <option value="new">No activity recorded</option>
                <option value="missing">Missing history</option>
              </select>
            </label>
          </div>
        </details>
      </div>
      {error && (
        <p role="alert" className="error-banner">
          {error}
        </p>
      )}
      <section className="tracker-batch" aria-label="Prepare outreach in bulk">
        <div>
          <strong>Your next step: review a message</strong>
          <p>
            Select a company below for its contacts and history, or open your drafts to start
            outreach.
          </p>
        </div>
        <details>
          <summary>Choose campaign details</summary>
          <label>
            Campaign for new drafts
            <select
              value={batchCampaign}
              onChange={(e) => {
                const id = e.target.value;
                setBatchCampaign(id);
                const sender = state.campaigns.find((c) => c.id === id)?.sender;
                if (sender === "Akshit" || sender === "Chinmay") setBatchSender(sender);
              }}
            >
              {state.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name.endsWith(` · ${c.sender}`) ? c.name : `${c.name} · ${c.sender}`}
                </option>
              ))}
            </select>
          </label>
        </details>
        <div className="tracker-batch-actions">
          <button
            className="primary"
            type="button"
            disabled={pending}
            onClick={() => onOpen("all", state, region)}
          >
            Review drafts →
          </button>
          <button
            type="button"
            disabled={pending || !filtered.length}
            onClick={() => void prepare(filtered)}
          >
            Add filtered to review ({filtered.length})
          </button>
          <button type="button" disabled={pending} onClick={() => void prepare(companies)}>
            Add all to review ({companies.length})
          </button>
        </div>
        <small>
          New drafts use {batchSender}. Existing drafts and prior outreach are preserved; each
          existing draft can be switched to either founder during review. Nothing is sent here.
        </small>
      </section>
      {notice && (
        <p role="status" className="tracker-notice">
          {notice}
        </p>
      )}
      <div className="tracker-count">
        <span>
          {filtered.length} companies ·{" "}
          {
            filtered.filter((c) =>
              state.prospects.some((p) => matchCompany(state, p)?.id === c.id && p.email),
            ).length
          }{" "}
          with an email
        </span>
        <label>
          <input
            type="checkbox"
            checked={showColumns}
            onChange={(e) => setShowColumns(e.target.checked)}
          />{" "}
          Show all tracking columns
        </label>
      </div>
      <div className="tracker-table-wrap">
        <table className={`tracker-table ${showColumns ? "" : "simple-columns"}`}>
          <thead>
            <tr>
              {[
                "Company / people",
                "POC",
                "Owner",
                "Sales status",
                "Mark activity",
                "History / channels",
                "Partner program",
                "NCP",
                "Location",
                "Next step",
              ].map((x) => (
                <th key={x}>{x}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => {
              const entries = tracker.touchpoints.filter(
                (t) => t.companyId === c.id && t.kind !== "note",
              );
              const receipts = trackedReceipts(state, c).filter((r) =>
                ["accepted", "submitted"].includes(r.status),
              );
              const channels = [
                ...new Set([...entries.map((t) => t.platform), ...receipts.map((r) => r.channel)]),
              ];
              return (
                <tr key={c.id} className={selected === c.id ? "selected" : ""}>
                  <td>
                    <button
                      type="button"
                      className="company-open"
                      onClick={() => {
                        setSelected(c.id);
                        setNotice("");
                        setError("");
                      }}
                    >
                      {c.name}
                    </button>
                    <small>
                      {c.people.length} contacts · {c.region}
                    </small>
                  </td>
                  <td>
                    {c.poc || "Contact to research"}
                    <small>
                      {state.prospects.find((p) => matchCompany(state, p)?.id === c.id)?.email ||
                        "Email not found yet"}
                    </small>
                  </td>
                  <td>{c.owner || "Unassigned"}</td>
                  <td>
                    <span className={hasReached(state, c) ? "stage active" : "stage"}>
                      {c.salesStatus || "Not recorded"}
                    </span>
                  </td>
                  <td>
                    <div className="quick-log">
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => void markActivity(c, "email")}
                      >
                        Mark email sent
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => void markActivity(c, "linkedin")}
                      >
                        Mark LinkedIn sent
                      </button>
                      <button
                        type="button"
                        disabled={pending}
                        onClick={() => void markActivity(c, "application")}
                      >
                        Mark application submitted
                      </button>
                    </div>
                  </td>
                  <td>
                    {channels.length
                      ? channels.join(", ")
                      : hasReached(state, c)
                        ? "Channel unknown"
                        : "No activity recorded"}
                    {needsHistory(state, c) && (
                      <small className="history-gap">Message / date history incomplete</small>
                    )}
                  </td>
                  <td>{c.partnerStatus || "Not recorded"}</td>
                  <td>{c.ncp || "—"}</td>
                  <td>{c.location}</td>
                  <td>
                    {c.nextStep || "—"}
                    {c.followUp && <small>Follow up {c.followUp}</small>}
                  </td>
                </tr>
              );
            })}
            {!filtered.length && (
              <tr>
                <td colSpan={10}>No matches. Try clearing a filter.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {current && (
        <dialog
          className="tracker-overlay"
          ref={drawer}
          aria-label={`${current.name} tracker`}
          onCancel={(e) => {
            e.preventDefault();
            if (!pending) setSelected("");
          }}
        >
          <section className="tracker-drawer" aria-label={`${current.name} tracker`}>
            <div className="tracker-drawer-head">
              <div>
                <span className="eyebrow">COMPANY RECORD</span>
                <h2>{current.name}</h2>
                <p>
                  {current.region} · {current.people.length} contact entries
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => setSelected("")}
                aria-label="Close company tracker"
              >
                Close ×
              </button>
            </div>
            {error && (
              <p role="alert" className="error-banner">
                {error}
              </p>
            )}
            {notice && (
              <p role="status" className="tracker-notice">
                {notice}
              </p>
            )}
            <CompanyDetail
              key={`${current.id}-${current.revision}`}
              company={current}
              state={state}
              pending={pending}
              run={run}
              onOpen={onOpen}
            />
          </section>
        </dialog>
      )}
    </section>
  );
}
function CompanyDetail({
  company: c,
  state,
  pending,
  run,
  onOpen,
}: {
  company: TrackedCompany;
  state: State;
  pending: boolean;
  run: (path: string, body: unknown) => Promise<State>;
  onOpen: (id: string, s: State) => void;
}) {
  const [tab, setTab] = useState("history");
  const [fields, setFields] = useState({
    poc: c.poc,
    owner: c.owner,
    salesStatus: c.salesStatus,
    partnerStatus: c.partnerStatus,
    ncp: c.ncp,
    nextStep: c.nextStep,
    followUp: c.followUp,
    notes: c.notes,
  });
  const [person, setPerson] = useState<Person>();
  const [domain, setDomain] = useState(() => inferCompanyDomain(c));
  const [campaign, setCampaign] = useState(state.campaigns[0]?.id || "");
  const [entry, setEntry] = useState({
    actor: c.owner || "Akshit",
    contact: c.poc,
    platform: "unknown",
    kind: "sent",
    occurredAt: "",
    subject: "",
    message: "",
    evidence: "",
  });
  const entries = state.tracker!.touchpoints.filter((t) => t.companyId === c.id);
  const receipts = trackedReceipts(state, c);
  const submit = (path: string, body: object) => {
    void run(path, { id: c.id, revision: c.revision, ...body }).catch(() => {});
  };
  return (
    <>
      <div className="tracker-tabs">
        {[
          ["history", "Activity & messages"],
          ["people", `People (${c.people.length})`],
          ["details", "Tracking & research"],
        ].map(([id, label]) => (
          <button
            type="button"
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "history" && (
        <div className="tracker-section">
          <div className="source-summary">
            <strong>Imported status · not a message receipt</strong>
            <p>
              Sales: {c.sheetValues.F || "not recorded"} · Partner program:{" "}
              {c.sheetValues.C || "not recorded"} · Owner: {c.sheetValues.H || "unassigned"}
            </p>
            <p>
              Sheet contains no channel, send date or message body. Those details remain unknown.
            </p>
            {c.knownPriorContact && ["lambda", "coreweave", "corvex", "crusoe"].includes(c.id) && (
              <p>User also reported this company was already contacted.</p>
            )}
            {c.sheetValues.C === "NA" && /Applied/.test(c.sheetValues.F) && (
              <p className="history-gap">
                Source conflict: sales status says applied; partner column says NA. Verify before
                updating.
              </p>
            )}
            <Link url={c.sheetSource}>View original sheet row</Link>
          </div>
          <h3>Recorded activity</h3>
          {!entries.length && !receipts.length && (
            <p className="tracker-empty">
              No detailed activity recorded yet. Add past outreach below; missing details can stay
              blank.
            </p>
          )}
          {entries.map((e) => (
            <article className="touchpoint" key={e.id}>
              <div>
                <strong>
                  {e.platform} · {e.kind}
                </strong>
                <span>{e.occurredAt || "Date unknown"}</span>
              </div>
              <p>
                {e.actor} → {e.contact || "Contact not recorded"}
              </p>
              {e.subject && <h4>{e.subject}</h4>}
              <pre>{e.message || "Message not recorded"}</pre>
              {e.evidence && <p>Evidence: {e.evidence}</p>}
              <small>Manually logged {new Date(e.recordedAt).toLocaleString()}</small>
            </article>
          ))}
          {receipts.map((r) => (
            <article className="touchpoint" key={r.id}>
              <div>
                <strong>
                  {r.channel} · {r.status}
                </strong>
                <span>{new Date(r.at).toLocaleString()}</span>
              </div>
              <p>
                {r.snapshot.campaign.sender} →{" "}
                {r.snapshot.prospect.contact || r.snapshot.prospect.company}
              </p>
              <p>{r.detail}</p>
              {r.status === "handoff" && <p>Prepared for manual sending; not confirmed sent.</p>}
              <pre>
                {r.channel === "email"
                  ? `${r.snapshot.prospect.subject}\n\n${r.snapshot.prospect.body}`
                  : r.channel === "linkedin"
                    ? r.snapshot.prospect.linkedinBody
                    : JSON.stringify(r.snapshot.prospect.fields, null, 2)}
              </pre>
            </article>
          ))}
          <form
            className="tracker-form"
            onSubmit={(e) => {
              e.preventDefault();
              submit("tracker-log", { entry });
            }}
          >
            <h3>Log past activity</h3>
            <p>Records history only. Does not send a message or submit an application.</p>
            <div className="tracker-form-grid">
              <label>
                Performed by
                <input
                  required
                  value={entry.actor}
                  onChange={(e) => setEntry({ ...entry, actor: e.target.value })}
                />
              </label>
              <label>
                Contact
                <input
                  list="tracked-people"
                  value={entry.contact}
                  onChange={(e) => setEntry({ ...entry, contact: e.target.value })}
                />
                <datalist id="tracked-people">
                  {c.people.map((p) => (
                    <option key={p.id} value={p.name} />
                  ))}
                </datalist>
              </label>
              <label>
                Platform
                <select
                  value={entry.platform}
                  onChange={(e) => setEntry({ ...entry, platform: e.target.value })}
                >
                  {platforms.map((p) => (
                    <option key={p}>{p}</option>
                  ))}
                </select>
              </label>
              <label>
                Activity type
                <select
                  value={entry.kind}
                  onChange={(e) => setEntry({ ...entry, kind: e.target.value })}
                >
                  {activityKinds.map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
              </label>
              <label>
                Date (blank if unknown)
                <input
                  type="date"
                  value={entry.occurredAt}
                  onInput={(e) => setEntry({ ...entry, occurredAt: e.currentTarget.value })}
                  onChange={(e) => setEntry({ ...entry, occurredAt: e.target.value })}
                />
              </label>
              <label>
                Subject
                <input
                  value={entry.subject}
                  onChange={(e) => setEntry({ ...entry, subject: e.target.value })}
                />
              </label>
            </div>
            <label>
              Exact message or notes
              <textarea
                rows={5}
                value={entry.message}
                placeholder="Paste the actual sent message. Leave blank if unavailable."
                onChange={(e) => setEntry({ ...entry, message: e.target.value })}
              />
            </label>
            <label>
              Evidence / conversation reference
              <input
                value={entry.evidence}
                onChange={(e) => setEntry({ ...entry, evidence: e.target.value })}
              />
            </label>
            <button className="primary" disabled={pending} type="submit">
              Save activity record
            </button>
          </form>
        </div>
      )}
      {tab === "people" && (
        <div className="tracker-section">
          <p>
            All artifact entries plus sheet-only contacts. Roles and profiles need verification
            before outreach. Reference drafts are unsent and retain their original author.
          </p>
          {c.people.map((p) => (
            <article className="person-card" key={p.id}>
              <h3>
                {p.name} <small>{p.source}</small>
              </h3>
              <p>{p.bio}</p>
              <Link url={p.profile}>Profile</Link>
              {p.referenceDraft && (
                <details>
                  <summary>Original reference draft · unsent</summary>
                  <pre>{p.referenceDraft}</pre>
                </details>
              )}
              <button
                type="button"
                onClick={() => {
                  setPerson(p);
                  setDomain(inferCompanyDomain(c));
                }}
                disabled={p.role === "placeholder"}
              >
                Prepare draft for {p.name}
              </button>
            </article>
          ))}
          {!c.people.length && (
            <p>
              No named contacts in either source. Company contact routes appear under Tracking &
              research.
            </p>
          )}
          {person && (
            <form
              className="tracker-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run("tracker-prepare", {
                  id: c.id,
                  revision: c.revision,
                  personId: person.id,
                  campaignId: campaign,
                  domain,
                })
                  .then((s) => {
                    const p = s.prospects.find((p) => p.companyId === c.id || p.company === c.name);
                    if (p) onOpen(p.id, s);
                  })
                  .catch(() => {});
              }}
            >
              <h3>Prepare {person.name} for review</h3>
              <p>
                Uses the selected campaign’s sender. If a draft already exists for this company,
                opens it without overwriting it. Prior activity pauses live outreach.
              </p>
              <label>
                Campaign
                <select value={campaign} onChange={(e) => setCampaign(e.target.value)}>
                  {state.campaigns.map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.name} · {x.sender}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Company website
                <input
                  required={
                    !state.prospects.some((p) => p.companyId === c.id || p.company === c.name)
                  }
                  value={domain}
                  placeholder="company.com"
                  onChange={(e) => setDomain(e.target.value)}
                />
                <small>
                  Found from imported official contact and partner routes. Edit if needed.
                </small>
              </label>
              <button className="primary" disabled={pending} type="submit">
                Open in review inbox
              </button>
            </form>
          )}
        </div>
      )}
      {tab === "details" && (
        <div className="tracker-section">
          <form
            className="tracker-form"
            onSubmit={(e) => {
              e.preventDefault();
              submit("tracker-update", { patch: fields });
            }}
          >
            <h3>Tracking fields</h3>
            <div className="tracker-form-grid">
              {(
                [
                  ["poc", "Primary contact"],
                  ["owner", "Owner"],
                  ["salesStatus", "Sales status"],
                  ["partnerStatus", "Partner program status"],
                  ["ncp", "NVIDIA NCP (sheet)"],
                  ["followUp", "Follow-up date"],
                ] as const
              ).map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    type={key === "followUp" ? "date" : "text"}
                    value={fields[key]}
                    onInput={(e) => setFields({ ...fields, [key]: e.currentTarget.value })}
                    onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
            <label>
              Next step
              <input
                value={fields.nextStep}
                onChange={(e) => setFields({ ...fields, nextStep: e.target.value })}
              />
            </label>
            <label>
              Notes
              <textarea
                rows={3}
                value={fields.notes}
                onChange={(e) => setFields({ ...fields, notes: e.target.value })}
              />
            </label>
            <button type="submit" className="primary" disabled={pending}>
              Save tracking changes
            </button>
          </form>
          <h3>Company research</h3>
          <p>{c.summary}</p>
          <blockquote>{c.hook}</blockquote>
          <Link url={c.story}>Read personalization source</Link>
          <p>{c.routing}</p>
          {Object.entries(c.routes).map(([key, value]) => (
            <p key={key}>
              <strong>{key}: </strong>
              {value}
            </p>
          ))}
          <p>
            Routes and artifact research are source notes; addresses are not automatically verified
            recipients.
          </p>
          <div className="tracker-links">
            <Link url={c.sheetSource}>Source sheet</Link>
            <Link url={c.artifactSource}>Source artifact</Link>
          </div>
          <details>
            <summary>Latest sheet source fields</summary>
            <pre>{JSON.stringify(c.sheetValues, null, 2)}</pre>
          </details>
        </div>
      )}
    </>
  );
}
