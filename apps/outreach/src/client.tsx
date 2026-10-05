import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { fillPublishedEmail } from "./email-research";
import {
  blockers,
  type Capabilities,
  type Channel,
  compose,
  type Mode,
  type Prospect,
  type State,
  safeLink,
} from "./model";
import { TrackerView } from "./tracker";
import { matchCompany } from "./tracker-model";
import { installReviewTools } from "./webmcp";
import "./style.css";

type View = "tracker" | "inbox" | "activity" | "campaigns" | "connections";
type Tab = "email" | "linkedin" | "application" | "research";
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    inbox: (
      <>
        <path d="M4 4h16v15H4zM4 13h5l2 3h2l2-3h5" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    check: <path d="m5 12 4 4L19 6" />,
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m3 6 9 7 9-7" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="9" />
        <ellipse cx="12" cy="12" rx="4" ry="9" />
        <path d="M3 12h18" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="15" cy="17" r="3" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 6v6l4 2" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 5 5" />
      </>
    ),
    link: (
      <>
        <path d="m10 7 3-3a5 5 0 0 1 7 7l-3 3M14 17l-3 3a5 5 0 0 1-7-7l3-3m1 9 8-8" />
      </>
    ),
    file: (
      <>
        <path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6" />
      </>
    ),
    bolt: <path d="m13 2-9 12h7l-1 8 10-13h-8z" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.file}
    </svg>
  );
}
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: Each Field wraps its input/select/textarea child.
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}
function Dialog({
  title,
  children,
  close,
  error,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  error?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog ref={ref} onCancel={close} aria-label={title}>
      <div className="dialog-head">
        <h2>{title}</h2>
        <button type="button" className="icon-button" onClick={close} aria-label="Close dialog">
          ×
        </button>
      </div>
      {error && (
        <div className="error-banner" role="alert">
          {error}
        </div>
      )}
      {children}
    </dialog>
  );
}
function External({ href, children }: { href: string; children: ReactNode }) {
  return safeLink(href) ? (
    <a href={safeLink(href)} target="_blank" rel="noreferrer">
      {children}
    </a>
  ) : (
    <span>{children}</span>
  );
}

function App() {
  const [state, setState] = useState<State>();
  const [caps, setCaps] = useState<Capabilities>();
  const [csrf, setCsrf] = useState("");
  const [campaignId, setCampaignId] = useState("all");
  const [selected, setSelected] = useState("sample-0");
  const [draft, setDraft] = useState<Prospect>();
  const [dirty, setDirty] = useState(false);
  const [view, setView] = useState<View>("tracker");
  const [tab, setTab] = useState<Tab>("email");
  const [mode, setMode] = useState<Mode>("test");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [inboxRegion, setInboxRegion] = useState("");
  const [inboxSender, setInboxSender] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [review, setReview] = useState<{ p: Prospect; s: State }>();
  const [channels, setChannels] = useState<Channel[]>(["email"]);
  const [ack, setAck] = useState(false);
  const [modal, setModal] = useState<"add" | "campaign" | "import" | null>(null);
  const [newCampaign, setNewCampaign] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const toolState = useRef({ state, dirty });
  toolState.current = { state, dirty };
  useEffect(
    () =>
      installReviewTools(
        () => toolState.current.state,
        (id) => {
          const current = toolState.current;
          if (current.dirty) throw new Error("Save edits before opening another review.");
          const p = current.state?.prospects.find((p) => p.id === id);
          if (!p || !current.state) throw new Error("Workspace unavailable");
          flushSync(() => {
            setSelected(id);
            setCampaignId(p.campaignId);
            setView("inbox");
            setChannels(["email"]);
            setAck(false);
            setReview({ p, s: current.state! });
          });
        },
      ),
    [],
  );
  const effectiveCampaignId =
    campaignId === "all" ? state?.prospects.find((p) => p.id === selected)?.campaignId : campaignId;
  const campaign =
    state?.campaigns.find((c) => c.id === effectiveCampaignId) || state?.campaigns[0];
  const prospects =
    state?.prospects.filter((p) => campaignId === "all" || p.campaignId === campaign?.id) || [];
  const companyRecord = state && draft ? matchCompany(state, draft) : undefined;
  const attempted = (p: Prospect) =>
    state?.receipts.some(
      (r) => r.prospectId === p.id && r.mode === mode && r.status !== "canceled",
    );
  const filteredProspects = (region: string, sender: string) =>
    prospects.filter(
      (p) =>
        `${p.company} ${p.contact}`.toLowerCase().includes(search.toLowerCase()) &&
        (!region || p.region === region) &&
        (!sender || state?.campaigns.find((c) => c.id === p.campaignId)?.sender === sender) &&
        (filter === "all" ||
          (filter === "email" && !!p.email && p.status === "new" && !attempted(p)) ||
          (filter === "paused" ? p.status !== "new" : p.status === "new" && !attempted(p))),
    );
  const visible = filteredProspects(inboxRegion, inboxSender);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/state");
      if (!r.ok) throw new Error("Workspace unavailable");
      const data = await r.json();
      setState(data.state);
      setCaps(data.caps);
      setCsrf(data.csrf);
    } catch (e) {
      setError(String(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    setDraft(state?.prospects.find((p) => p.id === selected));
    setDirty(false);
  }, [state, selected]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 6000);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  async function post(path: string, body: unknown): Promise<State> {
    const r = await fetch(`/api/${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-outreach-csrf": csrf },
      body: JSON.stringify(body),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Request failed");
    setState(data.state);
    return data.state;
  }
  async function act(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  function edit<K extends keyof Prospect>(key: K, value: Prospect[K]) {
    if (draft) {
      setDraft({ ...draft, [key]: value });
      setDirty(true);
    }
  }
  async function save(): Promise<State> {
    if (draft && dirty)
      return post("prospect", { id: draft.id, revision: draft.revision, patch: draft });
    return state!;
  }
  async function choose(id: string) {
    await act(async () => {
      await save();
      setSelected(id);
    });
  }
  async function changeInboxFilters(region: string, sender: string) {
    await act(async () => {
      await save();
      setInboxRegion(region);
      setInboxSender(sender);
      const next = filteredProspects(region, sender);
      if (!next.some((p) => p.id === selected)) setSelected(next[0]?.id || "");
    });
  }
  async function openReview() {
    await act(async () => {
      const s = await save();
      const p = s.prospects.find((p) => p.id === selected)!;
      setChannels([
        tab === "application" ? "application" : tab === "linkedin" ? "linkedin" : "email",
      ]);
      setAck(false);
      setReview({ p, s });
    });
  }
  if (!state || !caps || !campaign)
    return (
      <div className="loading">
        <span className="brand-mark">g</span>
        <h1>Opening Outreach Studio</h1>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button type="button" onClick={() => void load()}>
              Try again
            </button>
          </>
        ) : (
          <p>Loading your review workspace…</p>
        )}
      </div>
    );
  const reviewCampaign = review?.s.campaigns.find((c) => c.id === review.p.campaignId);
  const problems =
    review && reviewCampaign
      ? blockers(review.s, review.p, reviewCampaign, mode, channels, caps)
      : [];
  const completed = state.receipts.filter(
    (r) =>
      r.mode === mode &&
      (campaignId === "all" || r.snapshot.campaign.id === campaign.id) &&
      !["canceled", "running"].includes(r.status),
  ).length;

  return (
    <div className="app-shell">
      <a className="skip" href="#main">
        Skip to workspace
      </a>
      <aside className="sidebar">
        <a className="brand" href="/" aria-label="Outreach Studio home">
          <span className="brand-mark">g</span>
          <span>
            gridline<span className="brand-sub">OUTREACH STUDIO</span>
          </span>
        </a>
        <div className="workspace-label">
          WORKSPACE <span>01</span>
        </div>
        <nav aria-label="Main navigation">
          {(
            [
              ["tracker", "Company tracker", "globe"],
              ["inbox", "Review inbox", "inbox"],
              ["activity", "Activity", "clock"],
              ["campaigns", "Campaigns", "globe"],
              ["connections", "Connections", "settings"],
            ] as const
          ).map(([id, label, icon]) => (
            <button
              type="button"
              key={id}
              className={view === id ? "nav-item active" : "nav-item"}
              onClick={() =>
                void act(async () => {
                  await save();
                  setView(id);
                })
              }
            >
              <Icon name={icon} />
              {label}
              {id === "inbox" && <span className="nav-count">{prospects.length}</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-note">
          <span className="mini-label">BUILT AROUND YOUR REVIEW</span>
          <p>
            Every action starts
            <br />
            with your approval.
          </p>
          <div className="tiny-flow">
            <span>Research</span>
            <i>→</i>
            <span>Review</span>
            <i>→</i>
            <span>Act</span>
          </div>
        </div>
        <div className="profile">
          <span className="avatar">{campaign.sender.slice(0, 1) || "?"}</span>
          <div>
            <strong>{campaign.sender || "Set sender"}</strong>
            <span>{campaign.company}</span>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Edit sender"
            onClick={() => {
              setNewCampaign(false);
              setModal("campaign");
            }}
          >
            ↗
          </button>
        </div>
      </aside>
      <div className="workspace">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <span>/</span>{" "}
            <strong>
              {view === "inbox" ? "Review inbox" : view[0].toUpperCase() + view.slice(1)}
            </strong>
          </div>
          <div className="topbar-actions">
            <span className={`mode-pill ${mode}`}>
              <i />
              {mode === "test"
                ? "Test mode · no external delivery"
                : "Live mode · approval required"}
            </span>
            <button
              type="button"
              className="text-button"
              onClick={() =>
                void act(async () => {
                  await save();
                  await load();
                  setNotice("Workspace refreshed");
                })
              }
            >
              Refresh
            </button>
          </div>
        </header>
        <main id="main">
          <div className="page-heading">
            <div>
              <div className="eyebrow">
                {view === "inbox" ? "RESEARCH → RELATIONSHIPS" : "OUTREACH STUDIO"}
              </div>
              <h1>
                {view === "tracker"
                  ? "Choose who to contact"
                  : view === "inbox"
                    ? "Review your outreach"
                    : view === "activity"
                      ? "Sent messages & activity"
                      : view === "campaigns"
                        ? "Senders & campaigns"
                        : "Connections & setup"}
              </h1>
              <p>
                {view === "tracker"
                  ? "Find a company, check its history, and add it to your review list."
                  : view === "inbox"
                    ? "Choose a draft, check the recipient and message, then approve the actions you want."
                    : view === "activity"
                      ? "Approval snapshots and receipts stay here, even when drafts change."
                      : view === "campaigns"
                        ? "Keep each founder’s identity, offer and prospects in a separate campaign."
                        : "Test the complete flow first. Connect services when you’re ready."}
              </p>
            </div>
            {view === "inbox" && (
              <button type="button" className="primary" onClick={() => setModal("add")}>
                <Icon name="plus" />
                Add prospect
              </button>
            )}
          </div>
          {(view === "tracker" || view === "inbox") && (
            <section className="workflow-steps" aria-label="Outreach steps">
              <span className={view === "tracker" ? "current" : ""}>1 · Choose companies</span>
              <span className={view === "inbox" ? "current" : ""}>2 · Review message</span>
              <span>3 · Approve actions</span>
            </section>
          )}
          {error && (
            <div className="error-banner" role="alert">
              {error}
              <button type="button" onClick={() => setError("")} aria-label="Dismiss error">
                ×
              </button>
            </div>
          )}
          <div aria-live="polite" className={notice ? "toast" : "sr-only"}>
            {notice}
          </div>

          {view === "tracker" && (
            <TrackerView
              state={state}
              post={post}
              onOpen={(id, s, region) => {
                if (id === "all") {
                  setSelected(s.prospects.find((p) => !region || p.region === region)?.id || "");
                  setCampaignId("all");
                  setSearch("");
                  setFilter("all");
                  setInboxRegion(region || "");
                  setInboxSender("");
                  setView("inbox");
                  return;
                }
                const p = s.prospects.find((p) => p.id === id);
                if (p) {
                  setSelected(id);
                  setCampaignId(p.campaignId);
                  setDraft(p);
                  setDirty(false);
                  setView("inbox");
                }
              }}
            />
          )}
          {view === "inbox" && (
            <>
              <section className="campaign-bar" aria-label="Campaign overview">
                <Field label="ACTIVE CAMPAIGN">
                  <select
                    aria-label="Active campaign"
                    value={campaignId === "all" ? "all" : campaign.id}
                    onChange={(e) => {
                      const id = e.target.value;
                      void act(async () => {
                        await save();
                        setCampaignId(id);
                        setSelected(
                          state.prospects.find((p) => id === "all" || p.campaignId === id)?.id ||
                            "",
                        );
                      });
                    }}
                  >
                    <option value="all">All campaigns · all senders</option>
                    {state.campaigns.map((c) => (
                      <option value={c.id} key={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="metric">
                  <strong>{String(prospects.length).padStart(2, "0")}</strong>
                  <span>prospects</span>
                </div>
                <div className="metric">
                  <strong>
                    {String(
                      prospects.filter((p) => p.status === "new" && !attempted(p)).length,
                    ).padStart(2, "0")}
                  </strong>
                  <span>to review</span>
                </div>
                <div className="metric">
                  <strong>{String(completed).padStart(2, "0")}</strong>
                  <span>{mode === "test" ? "test receipts" : "action receipts"}</span>
                </div>
                <button
                  type="button"
                  className="secondary compact"
                  onClick={() => setModal("import")}
                >
                  <Icon name="file" />
                  Import list
                </button>
              </section>
              <div className="review-workspace">
                <section className="prospect-pane" aria-label="Prospects">
                  <div className="list-tools">
                    <label className="search">
                      <Icon name="search" />
                      <input
                        aria-label="Search prospects"
                        placeholder="Find a company…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <div className="inbox-select-filters">
                      <label>
                        Region
                        <select
                          aria-label="Filter review inbox by region"
                          value={inboxRegion}
                          disabled={busy}
                          onChange={(e) => void changeInboxFilters(e.target.value, inboxSender)}
                        >
                          <option value="">All regions</option>
                          {[...new Set(prospects.map((p) => p.region).filter(Boolean))]
                            .sort()
                            .map((region) => (
                              <option key={region}>{region}</option>
                            ))}
                        </select>
                      </label>
                      <label>
                        Sender
                        <select
                          aria-label="Filter review inbox by sender"
                          value={inboxSender}
                          disabled={busy}
                          onChange={(e) => void changeInboxFilters(inboxRegion, e.target.value)}
                        >
                          <option value="">Both founders</option>
                          <option>Akshit</option>
                          <option>Chinmay</option>
                        </select>
                      </label>
                    </div>
                    <div className="filter-row">
                      {[
                        ["all", "All prospects"],
                        ["email", "Has email"],
                        ["new", "To review"],
                        ["paused", "Paused"],
                      ].map(([id, name]) => (
                        <button
                          type="button"
                          key={id}
                          onClick={() => setFilter(id)}
                          className={filter === id ? "selected" : ""}
                        >
                          {name}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="prospect-list">
                    {visible.length ? (
                      visible.map((p, i) => (
                        <button
                          type="button"
                          key={p.id}
                          className={`prospect-card ${selected === p.id ? "selected" : ""}`}
                          onClick={() => void choose(p.id)}
                        >
                          <div className={`company-icon color-${i % 5}`}>
                            {p.company.slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <strong>{p.company}</strong>
                            <span>{p.contact || "Contact to research"}</span>
                            <small>
                              <i className={p.status === "new" ? "dot" : "dot muted"} />
                              {p.status !== "new"
                                ? p.status.replace("_", " ")
                                : attempted(p)
                                  ? mode === "test"
                                    ? "Test activity recorded"
                                    : "Check activity"
                                  : p.email
                                    ? "Email found · review next"
                                    : "Find an email or use LinkedIn"}
                            </small>
                          </div>
                          <span className="chevron">›</span>
                        </button>
                      ))
                    ) : (
                      <div className="empty small">
                        No prospects here.
                        <br />
                        Add a company or adjust your filter.
                      </div>
                    )}
                  </div>
                  <div className="list-footer">
                    <Icon name="globe" />
                    {campaign.kind === "customer"
                      ? "Customer sales"
                      : "Provider & partner outreach"}
                  </div>
                </section>
                {draft ? (
                  <section className="detail-pane" aria-label={`${draft.company} review`}>
                    <div className="detail-heading">
                      <div className="company-icon large">
                        {draft.company.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <h2>{draft.company}</h2>
                        <div className="company-meta">
                          <External href={`https://${draft.domain}`}>{draft.domain} ↗</External>
                          <span>·</span>
                          {draft.region || "Region not set"}
                        </div>
                      </div>
                      <span className="status-tag">
                        {dirty ? "Unsaved edits" : `Draft v${draft.revision}`}
                      </span>
                    </div>
                    <div className="sender-switch">
                      <Field label="SEND AS">
                        <select
                          aria-label="Send as"
                          value={campaign.sender}
                          disabled={busy}
                          onChange={(e) => {
                            const sender = e.target.value;
                            void act(async () => {
                              const saved = await save();
                              const p = saved.prospects.find((p) => p.id === draft.id)!;
                              const s = await post("sender", {
                                id: p.id,
                                revision: p.revision,
                                sender,
                              });
                              const changed = s.prospects.find((p) => p.id === draft.id)!;
                              setCampaignId(changed.campaignId);
                              setDraft(changed);
                              setDirty(false);
                              setNotice(
                                `Draft regenerated as ${sender}. Review the new content before approving.`,
                              );
                            });
                          }}
                        >
                          {!["Akshit", "Chinmay"].includes(campaign.sender) && (
                            <option>{campaign.sender}</option>
                          )}
                          <option>Akshit</option>
                          <option>Chinmay</option>
                        </select>
                      </Field>
                      <p>
                        Changing sender regenerates this draft and application answers. A matching
                        mailbox is required for live email.
                      </p>
                    </div>
                    <div className="tabs" role="tablist" aria-label="Review content">
                      {(
                        [
                          ["email", "Email", "mail"],
                          ["linkedin", "LinkedIn", "link"],
                          ["application", "Application", "file"],
                          ["research", "Research", "globe"],
                        ] as const
                      ).map(([id, label, icon]) => (
                        <button
                          type="button"
                          key={id}
                          role="tab"
                          aria-selected={tab === id}
                          className={tab === id ? "active" : ""}
                          onClick={() => setTab(id)}
                        >
                          <Icon name={icon} size={16} />
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="editor-content">
                      <div className="editor-main">
                        {tab === "email" && (
                          <>
                            <div className="message-meta">
                              <span>FROM</span>
                              <strong>
                                {campaign.sender}{" "}
                                <small>{campaign.senderEmail || "Mailbox not connected"}</small>
                              </strong>
                            </div>
                            <Field label="TO · BUSINESS EMAIL">
                              <input
                                aria-label="Recipient email"
                                value={draft.email}
                                placeholder="Add a verified business email"
                                onChange={(e) => edit("email", e.target.value)}
                              />
                            </Field>
                            {draft.emailEvidence?.address === draft.email ? (
                              <div className="email-evidence">
                                <strong>
                                  {draft.emailEvidence.kind === "team"
                                    ? "Published team inbox"
                                    : `Published business email · ${draft.emailEvidence.contact}`}
                                </strong>
                                <span>
                                  {draft.emailEvidence.kind === "team"
                                    ? "Email addresses the team; LinkedIn keeps your named contact."
                                    : "Listed publicly for this contact."}
                                </span>
                                <External href={draft.emailEvidence.source}>
                                  Email source ↗
                                </External>
                                <small>
                                  Checked{" "}
                                  {new Date(draft.emailEvidence.checkedAt).toLocaleDateString()}.
                                  Publication does not confirm delivery.
                                </small>
                              </div>
                            ) : (
                              !draft.email && (
                                <div className="next-step">
                                  <strong>No business email found yet</strong>
                                  <span>
                                    {companyRecord?.emailResearch
                                      ? "Checked public sources. Use LinkedIn or the company's contact form, or add a confirmed email."
                                      : "Add a confirmed email, or use the LinkedIn tab to contact this person."}
                                  </span>
                                  <button
                                    className="text-button"
                                    type="button"
                                    onClick={() => setTab("linkedin")}
                                  >
                                    Use LinkedIn →
                                  </button>
                                </div>
                              )
                            )}
                            <Field label="SUBJECT">
                              <input
                                aria-label="Email subject"
                                value={draft.subject}
                                onChange={(e) => edit("subject", e.target.value)}
                              />
                            </Field>
                            <textarea
                              className="message-body"
                              aria-label="Email message"
                              value={draft.body}
                              onChange={(e) => edit("body", e.target.value)}
                            />
                            <div className="editor-foot">
                              <span>{draft.body.trim().split(/\s+/).length} words</span>
                              <span>
                                <Icon name="bolt" size={13} />
                                Personalized around one relevant fact
                              </span>
                            </div>
                          </>
                        )}
                        {tab === "linkedin" && (
                          <>
                            <div className="info-box">
                              <strong>Reviewed here. Sent on LinkedIn.</strong>
                              <p>
                                LinkedIn restricts unauthorized automation. Approval prepares your
                                copy; you send from the native composer.
                              </p>
                            </div>
                            <Field label="LINKEDIN PROFILE">
                              <input
                                value={draft.linkedin}
                                onChange={(e) => edit("linkedin", e.target.value)}
                                placeholder="https://www.linkedin.com/in/…"
                              />
                            </Field>
                            <External
                              href={
                                draft.linkedin ||
                                `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(`${draft.contact} ${draft.company}`)}`
                              }
                            >
                              {draft.linkedin
                                ? "Open contact profile ↗"
                                : "Find profile on LinkedIn ↗"}
                            </External>
                            <Field label="MESSAGE">
                              <textarea
                                rows={9}
                                value={draft.linkedinBody}
                                onChange={(e) => edit("linkedinBody", e.target.value)}
                              />
                            </Field>
                            <span className="muted-text">
                              {draft.linkedinBody.length} characters · Check the native composer’s
                              current limit.
                            </span>
                          </>
                        )}
                        {tab === "application" && (
                          <>
                            {companyRecord && (
                              <div className="info-box">
                                <strong>
                                  Imported partner route ·{" "}
                                  {companyRecord.partnerStatus || "Status unknown"}
                                </strong>
                                <p>
                                  {companyRecord.routes.partner ||
                                    "No partner route recorded. Research suitability first."}
                                </p>
                                <External href={`https://${draft.domain}`}>
                                  Open company website ↗
                                </External>
                              </div>
                            )}
                            <div className="info-box">
                              <strong>Partner program first.</strong>
                              <p>
                                {mode === "test"
                                  ? "Test approval captures these answers without opening or submitting the real form."
                                  : "Automatic submission requires a configured form. Login, CAPTCHA or changed fields stop execution."}
                              </p>
                            </div>
                            <Field label="PROGRAM URL">
                              <input
                                value={draft.program}
                                placeholder="Relevant program or application URL"
                                onChange={(e) => edit("program", e.target.value)}
                              />
                            </Field>
                            <Field label="SUBMISSION ROUTE">
                              <select
                                value={draft.formId}
                                onChange={(e) => {
                                  const f = caps.forms.find((f) => f.id === e.target.value);
                                  setDraft({
                                    ...draft,
                                    formId: e.target.value,
                                    program: f?.url || draft.program,
                                    fields: f
                                      ? Object.fromEntries(
                                          f.fields.map((key) => [key, draft.fields[key] || ""]),
                                        )
                                      : draft.fields,
                                  });
                                  setDirty(true);
                                }}
                              >
                                <option value="">
                                  {mode === "test"
                                    ? "Test application inbox"
                                    : "No live form configured"}
                                </option>
                                {caps.forms.map((f) => (
                                  <option key={f.id} value={f.id}>
                                    {f.name}
                                  </option>
                                ))}
                              </select>
                            </Field>
                            {Object.entries(draft.fields).map(([key, value]) => (
                              <Field label={key.toUpperCase()} key={key}>
                                {value.length > 120 || key === "Message" ? (
                                  <textarea
                                    rows={5}
                                    value={value}
                                    onChange={(e) =>
                                      edit("fields", { ...draft.fields, [key]: e.target.value })
                                    }
                                  />
                                ) : (
                                  <input
                                    value={value}
                                    onChange={(e) =>
                                      edit("fields", { ...draft.fields, [key]: e.target.value })
                                    }
                                  />
                                )}
                              </Field>
                            ))}
                            {caps.forms.find((f) => f.id === draft.formId)?.terms && (
                              <p className="muted-text">
                                Terms: {caps.forms.find((f) => f.id === draft.formId)?.terms}
                              </p>
                            )}
                            <p className="muted-text">
                              Starter answers are proposed fields. Verify the actual form before
                              live use.
                            </p>
                          </>
                        )}
                        {tab === "research" && (
                          <>
                            {!!companyRecord?.people.length && (
                              <Field label="CHOOSE AN IMPORTED CONTACT">
                                <select
                                  value={
                                    companyRecord.people.find((p) => p.name === draft.contact)
                                      ?.id || ""
                                  }
                                  onChange={(e) => {
                                    const person = companyRecord.people.find(
                                      (p) => p.id === e.target.value,
                                    );
                                    if (!person) return;
                                    const next = {
                                      ...draft,
                                      contact: person.name,
                                      role: person.bio,
                                      email: "",
                                      emailEvidence: undefined,
                                      linkedin: /^https:\/\/(?:[a-z]+\.)?linkedin\.com\/in\//.test(
                                        person.profile,
                                      )
                                        ? person.profile.replace(
                                            /^https:\/\/[a-z]+\.linkedin/,
                                            "https://www.linkedin",
                                          )
                                        : "",
                                      verified: false,
                                      trackerChecked: false,
                                      programReviewed: false,
                                    };
                                    fillPublishedEmail(next, companyRecord);
                                    setDraft({ ...next, ...compose(next, campaign) });
                                    setDirty(true);
                                  }}
                                >
                                  <option value="">Current / custom contact</option>
                                  {companyRecord.people
                                    .filter((p) => p.role !== "placeholder")
                                    .map((p) => (
                                      <option value={p.id} key={p.id}>
                                        {p.name} — {p.bio}
                                      </option>
                                    ))}
                                </select>
                                <small>
                                  Choosing a contact updates this draft and uses a published address
                                  when available. Save, then check their current role and address.
                                </small>
                              </Field>
                            )}
                            {companyRecord && (
                              <details className="info-box">
                                <summary>Contact routes & email research</summary>
                                {!!companyRecord.emailResearch?.candidates.length && (
                                  <ul>
                                    {companyRecord.emailResearch.candidates
                                      .filter((e) => e.kind !== "unclassified")
                                      .map((e) => (
                                        <li key={e.address}>
                                          <strong>{e.address}</strong> ·{" "}
                                          {e.kind === "team" ? "Team inbox" : e.contact}{" "}
                                          <External href={e.source}>Source ↗</External>
                                        </li>
                                      ))}
                                  </ul>
                                )}
                                {Object.entries(companyRecord.routes).map(([key, route]) => (
                                  <p key={key}>
                                    {key}: {route}
                                  </p>
                                ))}
                                <External href={`https://${draft.domain}`}>
                                  Open company website ↗
                                </External>
                                <p>
                                  {companyRecord.people.length} contacts available in company
                                  tracker.
                                </p>
                              </details>
                            )}
                            <div className="section-title">
                              <h3>Company & contact</h3>
                              <button
                                type="button"
                                className="secondary compact"
                                disabled={busy || !caps.research}
                                title={
                                  caps.research
                                    ? "Uses configured research service"
                                    : "Connect a research API in Connections"
                                }
                                onClick={() =>
                                  void act(async () => {
                                    const s = await save();
                                    await post("research", {
                                      id: s.prospects.find((p) => p.id === selected)!.id,
                                    });
                                    setNotice(
                                      "Research saved. Verify facts and contact before live approval.",
                                    );
                                  })
                                }
                              >
                                <Icon name="bolt" />
                                Research & draft
                              </button>
                            </div>
                            <div className="two-fields">
                              <Field label="CONTACT">
                                <input
                                  value={draft.contact}
                                  onChange={(e) => edit("contact", e.target.value)}
                                />
                              </Field>
                              <Field label="ROLE">
                                <input
                                  value={draft.role}
                                  onChange={(e) => edit("role", e.target.value)}
                                />
                              </Field>
                            </div>
                            <Field label="WHY THIS COMPANY · ONE VERIFIED FACT">
                              <textarea
                                rows={4}
                                value={draft.hook}
                                onChange={(e) => edit("hook", e.target.value)}
                              />
                            </Field>
                            <Field label="SUPPORTING SOURCE">
                              <input
                                value={draft.source}
                                onChange={(e) => edit("source", e.target.value)}
                              />
                            </Field>
                            <Field label="CONVERSATION STATUS">
                              <select
                                value={draft.status}
                                onChange={(e) =>
                                  edit("status", e.target.value as Prospect["status"])
                                }
                              >
                                <option value="new">Not contacted / ready for review</option>
                                <option value="replied">Replied — pause outreach</option>
                                <option value="meeting">Meeting — pause outreach</option>
                                <option value="paused">Paused / already contacted</option>
                                <option value="opted_out">Opted out — suppress</option>
                              </select>
                            </Field>
                            <button
                              type="button"
                              className="secondary"
                              disabled={busy || !draft.hook}
                              onClick={() =>
                                void act(async () => {
                                  const s = await save();
                                  const p = s.prospects.find((p) => p.id === selected)!;
                                  await post("compose", { id: p.id, revision: p.revision });
                                  setTab("email");
                                  setNotice(
                                    "Drafts refreshed from your current sender, offer and company fact.",
                                  );
                                })
                              }
                            >
                              Refresh drafts from these facts <Icon name="arrow" />
                            </button>
                          </>
                        )}
                      </div>
                      <aside className="context-rail">
                        <details className="message-evidence">
                          <summary>Company fact & contact</summary>
                          <div className="rail-label">
                            <Icon name="bolt" size={14} />
                            THE PERSONAL TOUCH
                          </div>
                          <blockquote>
                            {draft.hook || "Add a relevant company fact in Research."}
                          </blockquote>
                          <External href={draft.source}>View source ↗</External>
                          <hr />
                          <div className="rail-label">CONTACT ROUTE</div>
                          <strong>{draft.contact || "Needs research"}</strong>
                          <p>{draft.role || "Verify role and remit"}</p>
                          <hr />
                        </details>
                        <div className="rail-label">REVIEW CHECKLIST</div>
                        {(
                          [
                            ["verified", "Contact & facts verified"],
                            ["trackerChecked", "Tracker & replies checked"],
                            ["programReviewed", "Partner route reviewed"],
                          ] as const
                        )
                          .filter(
                            ([key]) => campaign.kind !== "customer" || key !== "programReviewed",
                          )
                          .map(([key, label]) => (
                            <label className="checkline" key={key}>
                              <input
                                type="checkbox"
                                checked={draft[key]}
                                onChange={(e) => edit(key, e.target.checked)}
                              />
                              <span>{label}</span>
                            </label>
                          ))}
                        <p className="rail-note">
                          Check these after reviewing the sources and company history.
                        </p>
                      </aside>
                    </div>
                    <footer className="approval-footer">
                      <div>
                        <span className="shield">
                          <Icon name="check" size={14} />
                        </span>
                        <div>
                          <strong>You’re in control</strong>
                          <span>
                            {mode === "test"
                              ? "Approval runs a simulation only."
                              : "Only the actions you review will run."}
                          </span>
                        </div>
                      </div>
                      <button
                        type="button"
                        className="secondary"
                        disabled={!dirty || busy}
                        onClick={() =>
                          void act(async () => {
                            await save();
                            setNotice(
                              "Draft saved. Previous approval never applies to edited content.",
                            );
                          })
                        }
                      >
                        Save edits
                      </button>
                      <button
                        type="button"
                        className="primary"
                        disabled={busy}
                        onClick={() => void openReview()}
                      >
                        Review actions <Icon name="arrow" />
                      </button>
                    </footer>
                  </section>
                ) : (
                  <section className="empty">
                    <Icon name="inbox" size={40} />
                    <h2>Your next introduction starts here.</h2>
                    <p>Add a prospect, or choose one from the list.</p>
                    <button type="button" className="primary" onClick={() => setModal("add")}>
                      Add prospect
                    </button>
                  </section>
                )}
              </div>
            </>
          )}

          {view === "activity" && (
            <section className="panel activity">
              <div className="section-title">
                <h2>Approval & execution log</h2>
                <a className="secondary compact" href="/api/export" download>
                  Export workspace
                </a>
              </div>
              {state.receipts.length ? (
                [...state.receipts].reverse().map((r) => (
                  <article className="receipt" key={r.id}>
                    <span className={`receipt-icon ${r.status}`}>
                      <Icon
                        name={
                          r.channel === "email"
                            ? "mail"
                            : r.channel === "linkedin"
                              ? "link"
                              : "file"
                        }
                      />
                    </span>
                    <div>
                      <h3>
                        {r.snapshot.prospect.company}{" "}
                        <span className="status-tag">
                          {r.mode} · {r.status}
                        </span>
                      </h3>
                      <p>{r.detail}</p>
                      <small>
                        {new Date(r.at).toLocaleString()} · {r.snapshot.campaign.sender} · Draft v
                        {r.snapshot.prospect.revision}
                      </small>
                      <details>
                        <summary>View exact approved content</summary>
                        <p>
                          Sender: {r.snapshot.campaign.sender} ·{" "}
                          {r.snapshot.campaign.senderEmail || "test sender"}
                        </p>
                        <p>
                          Destination:{" "}
                          {r.channel === "email"
                            ? r.snapshot.prospect.email || "test inbox"
                            : r.channel === "application"
                              ? r.snapshot.prospect.program || "test form"
                              : r.snapshot.prospect.linkedin}
                        </p>
                        <pre>
                          {r.channel === "application"
                            ? JSON.stringify(r.snapshot.prospect.fields, null, 2)
                            : r.channel === "email"
                              ? `${r.snapshot.prospect.subject}\n\n${r.snapshot.prospect.body}`
                              : r.snapshot.prospect.linkedinBody}
                        </pre>
                      </details>
                      {r.status === "handoff" && (
                        <div className="button-row">
                          <button
                            type="button"
                            className="secondary compact"
                            onClick={() =>
                              void act(async () => {
                                await navigator.clipboard.writeText(
                                  r.snapshot.prospect.linkedinBody,
                                );
                                setNotice("Approved LinkedIn message copied");
                              })
                            }
                          >
                            Copy approved message
                          </button>
                          <External href={r.snapshot.prospect.linkedin}>Open LinkedIn ↗</External>
                        </div>
                      )}
                    </div>
                  </article>
                ))
              ) : (
                <div className="empty">
                  <Icon name="clock" size={36} />
                  <h3>No actions yet.</h3>
                  <p>Approve a test action to see its receipt and exact content here.</p>
                </div>
              )}
            </section>
          )}

          {view === "campaigns" && (
            <div className="campaign-grid">
              {state.campaigns.map((c) => (
                <article className="panel campaign-card" key={c.id}>
                  <span className="tag">{c.kind}</span>
                  <h2>{c.name}</h2>
                  <p>{c.offer}</p>
                  <div className="campaign-owner">
                    <span className="avatar">{c.sender[0]}</span>
                    <div>
                      <strong>
                        {c.sender} · {c.company}
                      </strong>
                      <span>{c.senderEmail || "Mailbox not set"}</span>
                    </div>
                  </div>
                  <div className="button-row">
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => {
                        setCampaignId(c.id);
                        setNewCampaign(false);
                        setModal("campaign");
                      }}
                    >
                      Edit brief
                    </button>
                    <button
                      type="button"
                      className="primary"
                      onClick={() => {
                        setCampaignId(c.id);
                        setSelected(state.prospects.find((p) => p.campaignId === c.id)?.id || "");
                        setView("inbox");
                      }}
                    >
                      Open inbox <Icon name="arrow" />
                    </button>
                  </div>
                </article>
              ))}
              <button
                type="button"
                className="new-campaign"
                onClick={() => {
                  setNewCampaign(true);
                  setModal("campaign");
                }}
              >
                <Icon name="plus" size={28} />
                <strong>Create a campaign</strong>
                <span>Another founder, offer or audience.</span>
              </button>
            </div>
          )}

          {view === "connections" && (
            <>
              <section className="panel mode-panel">
                <div>
                  <h2>Execution mode</h2>
                  <p>
                    Test mode never contacts external recipients. Live mode uses your configured
                    services.
                  </p>
                </div>
                <div className="segmented">
                  <button
                    type="button"
                    className={mode === "test" ? "active" : ""}
                    onClick={() => setMode("test")}
                  >
                    Test mode
                  </button>
                  <button
                    type="button"
                    disabled={!caps.liveEnabled}
                    className={mode === "live" ? "active" : ""}
                    onClick={() => setMode("live")}
                  >
                    Live mode
                  </button>
                </div>
              </section>
              <div className="connection-grid">
                {[
                  [
                    "mail",
                    "Email delivery",
                    caps.smtp
                      ? `Configured: ${(caps.smtpMailboxes || [caps.smtpFrom]).join(", ")}`
                      : "Not connected",
                    "Send through your own SMTP mailbox after approval. Sender must match the connected mailbox.",
                  ],
                  [
                    "file",
                    "Partner applications",
                    caps.forms.length
                      ? `${caps.forms.length} configured`
                      : "No live forms configured",
                    "Mapped forms submit approved answers. CAPTCHA, login or changed forms stop the sequence.",
                  ],
                  [
                    "link",
                    "LinkedIn",
                    "Native handoff",
                    "Review and copy your message, then open LinkedIn to send it yourself. No browser automation.",
                  ],
                  [
                    "globe",
                    "Research",
                    caps.research ? "Configured" : "Manual or import",
                    "With a research API connected, find sourced company facts and contact routes. Verify results before sending.",
                  ],
                ].map(([icon, title, status, description]) => (
                  <article className="panel connection" key={title}>
                    <Icon name={icon} size={25} />
                    <h2>{title}</h2>
                    <span className="status-tag">{status}</span>
                    <p>{description}</p>
                  </article>
                ))}
              </div>
              <section className="panel">
                <h2>Local test workspace</h2>
                <p>
                  Changes persist on this computer. Export a copy to share with your cofounder. A
                  shared, authenticated deployment and automatic Google Sheets/inbox sync are not
                  configured.
                </p>
                <div className="button-row">
                  <a className="secondary" href="/api/export" download>
                    Export workspace
                  </a>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy}
                    onClick={() =>
                      void act(async () => {
                        await post("reset-test", {});
                        setNotice("Test receipts cleared. Live history preserved.");
                      })
                    }
                  >
                    Clear test receipts
                  </button>
                </div>
                <details>
                  <summary>Connection setup for your developer</summary>
                  <p>
                    Zoho: Akshit uses akshit@gridlinegpu.com; Chinmay uses chinmay@gridlinegpu.com.
                    Both mailboxes can be connected together. Add each account below to
                    apps/outreach/.env, using its own app password.
                  </p>
                  <pre>{`OUTREACH_SMTP_AKSHIT_HOST=smtppro.zoho.com
OUTREACH_SMTP_AKSHIT_PORT=465
OUTREACH_SMTP_AKSHIT_USER=akshit@gridlinegpu.com
OUTREACH_SMTP_AKSHIT_FROM=akshit@gridlinegpu.com
OUTREACH_SMTP_AKSHIT_PASSWORD=YOUR_APP_PASSWORD

OUTREACH_SMTP_CHINMAY_HOST=smtppro.zoho.com
OUTREACH_SMTP_CHINMAY_PORT=465
OUTREACH_SMTP_CHINMAY_USER=chinmay@gridlinegpu.com
OUTREACH_SMTP_CHINMAY_FROM=chinmay@gridlinegpu.com
OUTREACH_SMTP_CHINMAY_PASSWORD=YOUR_APP_PASSWORD`}</pre>
                  <p>
                    Use the SMTP host shown in your Zoho account; host varies by account plan and
                    data center. Do not paste passwords into chat. Restart Studio after saving.
                  </p>
                  <External href="https://www.zoho.com/mail/help/zoho-smtp.html">
                    Zoho SMTP setup ↗
                  </External>
                  <p>
                    Keep credentials in a local .env file; never in the browser or Git. See
                    apps/outreach/README.md for setup.
                  </p>
                  <pre>
                    OUTREACH_ENABLE_LIVE=true{"\n"}OUTREACH_SMTP_HOST=…{"\n"}OUTREACH_SMTP_PORT=465
                    {"\n"}OUTREACH_SMTP_USER=…{"\n"}OUTREACH_SMTP_PASSWORD=…{"\n"}
                    OUTREACH_SMTP_FROM=…{"\n"}OUTREACH_FORMS_FILE=/absolute/path/forms.local.json
                    {"\n"}OPENAI_API_KEY=…{"\n"}OUTREACH_RESEARCH_MODEL=…
                  </pre>
                  <p>Credentials remain on the server. Restart after configuration changes.</p>
                  <External href="https://www.linkedin.com/help/linkedin/answer/a1341387">
                    LinkedIn automation policy ↗
                  </External>
                </details>
              </section>
            </>
          )}
        </main>
        <footer className="workspace-footer">
          <span>OUTREACH STUDIO</span>
          <span>Local workspace · Saved on this computer</span>
          <span>{busy ? "Working…" : "All actions require review"}</span>
        </footer>
      </div>

      {review && reviewCampaign && (
        <Dialog
          error={error}
          title="One approval. Exact actions."
          close={() => {
            if (!busy) setReview(undefined);
          }}
        >
          <div className="dialog-body">
            <span className={`mode-pill ${mode}`}>
              <i />
              {mode === "test"
                ? "SIMULATION · No external delivery"
                : "LIVE · These actions contact recipients"}
            </span>
            <p className="review-intro">
              {review.p.company} · {reviewCampaign.sender} · Draft v{review.p.revision}
            </p>
            <div className="action-choices">
              {(
                [
                  ["application", "Apply to partner program"],
                  ["email", "Send email"],
                  ["linkedin", "Prepare LinkedIn handoff"],
                ] as const
              ).map(([key, label]) => (
                <label className="checkline" key={key}>
                  <input
                    type="checkbox"
                    disabled={busy}
                    checked={channels.includes(key)}
                    onChange={(e) => {
                      setChannels(
                        e.target.checked ? [...channels, key] : channels.filter((x) => x !== key),
                      );
                      setAck(false);
                    }}
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
            <p className="muted-text">
              Application runs first. An uncertain result stops the remaining actions. Future
              follow-ups require their own review.
            </p>
            {(["application", "email", "linkedin"] as Channel[])
              .filter((c) => channels.includes(c))
              .map((channel) => (
                <section className="approval-preview" key={channel}>
                  <div className="rail-label">{channel.toUpperCase()}</div>
                  <p>
                    <strong>From:</strong> {reviewCampaign.sender} ·{" "}
                    {reviewCampaign.senderEmail || "Test sender only"}
                  </p>
                  <p>
                    <strong>To:</strong>{" "}
                    {channel === "email"
                      ? review.p.email || "Test inbox only — live address missing"
                      : channel === "application"
                        ? review.p.program || "Test form only"
                        : review.p.linkedin}
                  </p>
                  {channel === "email" && (
                    <p>
                      <strong>Subject:</strong> {review.p.subject}
                    </p>
                  )}
                  <pre>
                    {channel === "application"
                      ? Object.entries(review.p.fields)
                          .map(([key, value]) => `${key}: ${value}`)
                          .join("\n\n")
                      : channel === "email"
                        ? review.p.body
                        : review.p.linkedinBody}
                  </pre>
                  {channel === "application" && (
                    <p>
                      {caps.forms.find((f) => f.id === review.p.formId)?.terms ||
                        "No live form adapter or terms acceptance is configured."}
                    </p>
                  )}
                </section>
              ))}
            {problems.length > 0 && (
              <div className="blockers">
                <strong>Resolve before approval</strong>
                <ul>
                  {problems.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </div>
            )}
            <label className="checkline consent">
              <input
                type="checkbox"
                checked={ack}
                disabled={busy}
                onChange={(e) => setAck(e.target.checked)}
              />
              <span>
                {mode === "test"
                  ? "I reviewed this content and approve a simulation only."
                  : "I reviewed the sender, destinations, exact content and any form terms. Run these actions once."}
              </span>
            </label>
          </div>
          <div className="dialog-footer">
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setReview(undefined)}
            >
              Back to editing
            </button>
            <button
              type="button"
              className="primary"
              disabled={!ack || problems.length > 0 || busy}
              onClick={() =>
                void act(async () => {
                  const s = await post("approve", {
                    prospectId: review.p.id,
                    revision: review.p.revision,
                    stateVersion: review.s.version,
                    reviewer: reviewCampaign.sender,
                    mode,
                    channels,
                  });
                  setReview(undefined);
                  setView("activity");
                  setNotice(
                    s.receipts.some((r) => r.prospectId === review.p.id && r.status === "uncertain")
                      ? "Execution needs checking. Remaining actions stopped."
                      : mode === "test"
                        ? "Simulation complete. Nothing sent externally."
                        : "Approved actions processed. Review receipts for outcomes.",
                  );
                })
              }
            >
              {busy ? "Processing…" : mode === "test" ? "Approve & run test" : "Approve & execute"}
              <Icon name="arrow" />
            </button>
          </div>
        </Dialog>
      )}

      {modal === "add" && (
        <Dialog error={error} title="Add a prospect" close={() => setModal(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              void act(async () => {
                const s = await post("add", {
                  campaignId: campaign.id,
                  company: fd.get("company"),
                  domain: fd.get("domain"),
                });
                setSelected(s.prospects.at(-1)!.id);
                setTab("research");
                setView("inbox");
                setModal(null);
              });
            }}
          >
            <div className="dialog-body">
              <Field label="COMPANY">
                <input name="company" required placeholder="Company name" />
              </Field>
              <Field label="WEBSITE">
                <input name="domain" required placeholder="company.com" />
              </Field>
              <p>We’ll check for existing ownership before adding this company.</p>
            </div>
            <div className="dialog-footer">
              <button type="submit" className="primary" disabled={busy}>
                Add to campaign <Icon name="arrow" />
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {modal === "campaign" && (
        <Dialog
          error={error}
          title={newCampaign ? "Create a campaign" : "Edit campaign brief"}
          close={() => setModal(null)}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = Object.fromEntries(new FormData(e.currentTarget));
              void act(async () => {
                const s = await post("campaign", {
                  ...fd,
                  id: newCampaign ? undefined : campaign.id,
                });
                if (newCampaign) {
                  setCampaignId(s.campaigns.at(-1)!.id);
                  setSelected("");
                }
                setModal(null);
                setNotice("Campaign saved. Drafts regenerated with this sender and offer.");
              });
            }}
          >
            <div className="dialog-body">
              <Field label="CAMPAIGN NAME">
                <input
                  name="name"
                  required
                  defaultValue={newCampaign ? "" : campaign.name}
                  placeholder="e.g. US developer tools · customer sales"
                />
              </Field>
              <Field label="CAMPAIGN TYPE">
                <select name="kind" defaultValue={newCampaign ? "customer" : campaign.kind}>
                  <option value="customer">Customer sales</option>
                  <option value="provider">Provider onboarding</option>
                  <option value="partnership">Partnerships</option>
                </select>
              </Field>
              <div className="two-fields">
                <Field label="SENDER NAME">
                  <input name="sender" required defaultValue={newCampaign ? "" : campaign.sender} />
                </Field>
                <Field label="BUSINESS EMAIL">
                  <input
                    name="senderEmail"
                    type="email"
                    defaultValue={newCampaign ? "" : campaign.senderEmail}
                  />
                </Field>
              </div>
              <Field label="YOUR COMPANY">
                <input name="company" required defaultValue={newCampaign ? "" : campaign.company} />
              </Field>
              <Field label="OFFER · WHAT YOU ACTUALLY DO">
                <textarea
                  name="offer"
                  required
                  rows={3}
                  defaultValue={newCampaign ? "" : campaign.offer}
                />
              </Field>
              <Field label="YOUR ASK">
                <input
                  name="ask"
                  required
                  defaultValue={
                    newCampaign
                      ? "Would you be open to a brief call to see if this fits?"
                      : campaign.ask
                  }
                />
              </Field>
              <p className="muted-text">
                Saving regenerates this campaign’s current drafts and clears verification. Prior
                approval receipts remain unchanged.
              </p>
            </div>
            <div className="dialog-footer">
              <button type="submit" className="primary" disabled={busy}>
                Save campaign <Icon name="arrow" />
              </button>
            </div>
          </form>
        </Dialog>
      )}
      {modal === "import" && (
        <Dialog error={error} title="Import your prospect list" close={() => setModal(null)}>
          <div className="dialog-body">
            <div className="upload-area">
              <Icon name="file" size={32} />
              <h3>Bring your research with you.</h3>
              <p>
                Provider research JSON, an exported workspace, or a prospect array. Existing company
                domains are skipped.
              </p>
              <input
                ref={upload}
                className="sr-only"
                aria-label="Prospect JSON file"
                type="file"
                accept=".json,application/json"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    void act(async () => {
                      if (file.size > 900_000) throw new Error("Choose a file under 900 KB");
                      const data = JSON.parse(await file.text());
                      await post("import", { data, campaignId: campaign.id });
                      setModal(null);
                      setNotice(
                        "Prospects imported. Existing companies preserved; sender comes from this campaign.",
                      );
                    });
                }}
              />
              <button
                type="button"
                className="primary"
                disabled={busy}
                onClick={() => upload.current?.click()}
              >
                Choose JSON file
              </button>
            </div>
            <p>
              Imported text is regenerated using this campaign’s identity. Activity history is not
              imported; reconcile prior sends in your shared tracker before live use.
            </p>
            <details>
              <summary>Supported prospect format</summary>
              <pre>
                {JSON.stringify(
                  [
                    {
                      company: "Example",
                      domain: "example.com",
                      contact: "",
                      role: "",
                      email: "",
                      linkedin: "",
                      hook: "A verified fact about this company.",
                      source: "https://example.com",
                      program: "",
                    },
                  ],
                  null,
                  2,
                )}
              </pre>
            </details>
          </div>
        </Dialog>
      )}
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
