import { hasReached, matchCompany, type Tracker } from "./tracker-model";
export type Channel = "application" | "email" | "linkedin";
export type Mode = "test" | "live";
export interface Campaign {
  id: string;
  name: string;
  kind: "provider" | "customer" | "partnership";
  sender: string;
  senderEmail: string;
  company: string;
  offer: string;
  ask: string;
}
export const GRIDLINE_PROVIDER_OFFER =
  "Gridline routes customers’ on-demand GPU workloads to available clusters across providers, using availability, price-performance, and each workload’s privacy, security, and compliance requirements as routing criteria.";
export interface Prospect {
  emailEvidence?: {
    address: string;
    kind: "team" | "person";
    contact: string;
    source: string;
    checkedAt: string;
  };
  companyId?: string;
  id: string;
  campaignId: string;
  company: string;
  domain: string;
  region: string;
  contact: string;
  role: string;
  email: string;
  linkedin: string;
  program: string;
  formId: string;
  hook: string;
  source: string;
  subject: string;
  body: string;
  linkedinBody: string;
  fields: Record<string, string>;
  status: "new" | "replied" | "meeting" | "paused" | "opted_out";
  verified: boolean;
  trackerChecked: boolean;
  programReviewed: boolean;
  revision: number;
}
export interface Receipt {
  id: string;
  prospectId: string;
  domain: string;
  mode: Mode;
  channel: Channel;
  status: "running" | "simulated" | "accepted" | "submitted" | "handoff" | "uncertain" | "canceled";
  at: string;
  detail: string;
  snapshot: { prospect: Prospect; campaign: Campaign };
  approvalId: string;
}
export interface Approval {
  id: string;
  prospectId: string;
  revision: number;
  reviewer: string;
  mode: Mode;
  channels: Channel[];
  at: string;
}
export interface State {
  tracker?: Tracker;
  version: number;
  campaigns: Campaign[];
  prospects: Prospect[];
  receipts: Receipt[];
  approvals: Approval[];
}
export interface Capabilities {
  liveEnabled: boolean;
  smtp: boolean;
  smtpFrom: string;
  smtpMailboxes?: string[];
  research: boolean;
  forms: { id: string; name: string; url: string; fields: string[]; terms: string }[];
}
export function canonicalDomain(value: string): string {
  const url = new URL(value.includes("://") ? value : `https://${value}`);
  if (!/^https?:$/.test(url.protocol) || url.username || url.password)
    throw new Error("Use a company website domain.");
  return url.hostname.toLowerCase().replace(/^www\./, "");
}
export function safeLink(value: string): string | undefined {
  try {
    const u = new URL(value);
    return /^https?:$/.test(u.protocol) && !u.username && !u.password ? u.href : undefined;
  } catch {
    return undefined;
  }
}
export function compose(
  p: Prospect,
  c: Campaign,
): Pick<Prospect, "subject" | "body" | "linkedinBody" | "fields"> {
  const greeting = p.contact ? p.contact.split(" ")[0] : `${p.company} team`;
  if (c.kind === "provider" && c.company.toLowerCase() === "gridline") {
    const offer = [
      "We're building a unified interface for GPU compute across providers.",
      "We're building a unified way for teams to find and access GPU compute across providers.",
    ].includes(c.offer)
      ? GRIDLINE_PROVIDER_OFFER
      : c.offer;
    const emailGreeting =
      p.emailEvidence?.address === p.email && p.emailEvidence.kind === "team"
        ? `${p.company} team`
        : greeting;
    const intro = `Hi ${emailGreeting}, I'm ${c.sender}, founder of ${c.company} (Entrepreneurs First F26), think OpenRouter for GPUs. ${offer}`;
    const detail = `${p.hook.trim()} We'd like to explore partnering with ${p.company} so Gridline can route suitable customer workloads to available capacity on your platform.`;
    const ask = [
      "Would you be open to a 15-minute call to explore a small pilot?",
      "Would you be open to a 15-minute introductory call next week?",
    ].includes(c.ask)
      ? "Would you be open to a 15-minute call next week to discuss a potential partnership?"
      : c.ask;
    // Reference drafts sometimes claim an application was submitted. Never inherit that claim.
    const message = `${intro}\n\n${detail}\n\n${ask}`;
    const linkedinPosition =
      "Gridline routes on-demand GPU workloads to available capacity across providers, matching for price-performance and requirements such as privacy, security, and compliance.";
    return {
      subject: `${p.company} × ${c.company} — provider partnership`,
      body: message,
      linkedinBody: `Hi ${greeting}, I'm ${c.sender}, founder of ${c.company}.\n\n${linkedinPosition} ${p.hook.trim()}\n\nWe're exploring a partnership with ${p.company}. Would you be open to a 15-minute call next week?`,
      fields: {
        "Full name": c.sender,
        "Business name": c.company,
        Email: c.senderEmail,
        Message: message,
      },
    };
  }
  const proposal =
    c.kind === "customer"
      ? `I'd like to explore whether ${c.company} could help your team with this workflow.`
      : `We'd like to explore a small partnership with ${p.company}, with scope, billing and support agreed up front.`;
  return {
    subject: `${p.company} × ${c.company} — ${c.kind === "customer" ? "quick introduction" : "partnership"}`,
    body: `Hi ${greeting},\n\nI'm ${c.sender} from ${c.company}. ${c.offer}\n\n${p.hook}\n\n${proposal}\n\n${c.ask}\n\nBest,\n${c.sender}`,
    linkedinBody: `Hi ${greeting} — I'm ${c.sender} from ${c.company}. ${p.hook} ${c.ask}`,
    fields: {
      "Full name": c.sender,
      "Business name": c.company,
      Email: c.senderEmail,
      Message: `${c.offer}\n\n${p.hook}\n\n${proposal}\n\n${c.ask}`,
    },
  };
}
export function blankProspect(campaignId: string, company: string, domain: string): Prospect {
  return {
    id: crypto.randomUUID(),
    campaignId,
    company,
    domain: canonicalDomain(domain),
    region: "",
    contact: "",
    role: "",
    email: "",
    linkedin: "",
    program: "",
    formId: "",
    hook: "",
    source: "",
    subject: "",
    body: "",
    linkedinBody: "",
    fields: {},
    status: "new",
    verified: false,
    trackerChecked: false,
    programReviewed: false,
    revision: 1,
  };
}
export function blockers(
  s: State,
  p: Prospect,
  c: Campaign,
  mode: Mode,
  channels: Channel[],
  caps: Capabilities,
): string[] {
  const problems: string[] = [];
  if (
    !channels.length ||
    new Set(channels).size !== channels.length ||
    channels.some((x) => !["email", "linkedin", "application"].includes(x))
  )
    problems.push("Choose distinct actions to review.");
  if (!c.sender || !c.company || !c.offer) problems.push("Complete sender and campaign offer.");
  if (!p.hook || !safeLink(p.source)) problems.push("Add a company-specific fact and its source.");
  if (p.status !== "new") problems.push(`Company is ${p.status}; outreach is paused.`);
  if (
    s.prospects.some(
      (x) =>
        x.domain === p.domain &&
        x.id !== p.id &&
        (x.campaignId !== p.campaignId || x.status !== "new"),
    )
  )
    problems.push(
      "Company has another owner/campaign or a paused conversation. Reconcile before proceeding.",
    );
  for (const channel of channels) {
    if (
      s.receipts.some(
        (r) =>
          r.domain === p.domain &&
          r.mode === mode &&
          r.channel === channel &&
          !["canceled"].includes(r.status),
      )
    )
      problems.push(
        `${channel} already attempted for this company in ${mode} mode. Check activity; no automatic retry.`,
      );
  }
  if (channels.includes("email") && (!p.body || !p.subject)) problems.push("Email draft is empty.");
  if (
    channels.includes("linkedin") &&
    (!p.linkedinBody || !safeLink(p.linkedin)?.startsWith("https://www.linkedin.com/"))
  )
    problems.push("Add an exact LinkedIn profile and message.");
  if (mode === "live") {
    const tracked = matchCompany(s, p);
    if (tracked && hasReached(s, tracked))
      problems.push(
        "Tracker records prior activity for this company. Continue the existing conversation manually; fresh outreach is paused.",
      );
    if (!caps.liveEnabled) problems.push("Live actions are disabled on this server.");
    if (!p.verified) problems.push("Confirm contact and evidence verification.");
    if (!p.trackerChecked) problems.push("Check current shared tracker, ownership and replies.");
    if (channels.includes("email")) {
      if (
        !caps.smtp ||
        !(caps.smtpMailboxes || [caps.smtpFrom]).some(
          (address) => address.toLowerCase() === c.senderEmail.trim().toLowerCase(),
        )
      )
        problems.push("Connect a mailbox matching this campaign's sender email.");
      if (!/^[^\s<>@,;]+@[^\s<>@,;]+\.[^\s<>@,;]+$/.test(p.email))
        problems.push("Provide one verified business email address.");
      if (c.kind !== "customer" && !p.programReviewed)
        problems.push("Review partner-program suitability first.");
      if (
        c.kind !== "customer" &&
        p.program &&
        !channels.includes("application") &&
        !s.receipts.some(
          (r) =>
            r.domain === p.domain &&
            r.mode === "live" &&
            r.channel === "application" &&
            r.status === "submitted",
        )
      )
        problems.push("Apply first, or clear the program URL if the program is not applicable.");
    }
    if (channels.includes("application")) {
      const form = caps.forms.find((f) => f.id === p.formId);
      if (!form || form.url !== p.program)
        problems.push("This program needs a configured, reviewed form adapter.");
      else if (form.fields.some((key) => !p.fields[key]?.trim()))
        problems.push("Complete every required application field.");
    }
  }
  return problems;
}
