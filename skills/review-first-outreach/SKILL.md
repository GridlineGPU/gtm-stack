---
name: review-first-outreach
description: Research business prospects and prepare personalized outreach campaigns for human review, including customer sales, provider onboarding, and partnerships. Use for repeatable prospect research, contact selection, application drafts, and follow-up review queues.
---

# Review-first outreach

Run a reusable research → qualification → draft → review workflow. This package has no sending component. Produce files for review; do not send email, LinkedIn invitations/messages, submit forms, create accounts, accept terms, or enroll prospects into sending software. An approved draft is still a manual-action item. If user later requests sending, handle that as a separate explicitly authorized task.

## Campaign setup

Read [campaign-brief.md](references/campaign-brief.md). Use supplied context to fill it; ask only for facts essential to accurate copy that cannot be inferred. Keep unresolved fields explicit. Never inherit a different campaign's sender, employer, product, proof, or permissions. Default batch size: five companies. Keep campaign identity and sender stable across reruns.

Read the user's tracker and prior activity before choosing prospects. Reconcile canonical company domain, aliases, owner, contacts, prior sends, replies, opt-outs, meetings, and applications. Coordinate across founders through the shared company record: switching campaigns or senders must not bypass suppression. If tracker access fails, research and draft locally but mark collision checking incomplete; no item is ready for manual action.

## Research and qualify

1. Use the supplied list and geography/segment; browse current official sources. Save source URL and date for each company fact, role and contact address. Use public business information relevant to the offer. Do not infer private contact details or treat guessed email patterns as verified.
2. Explain why this company is a plausible fit and rank fit, access route and uncertainty. Do not fabricate buying intent, demand, budget, capacity, integrations or traction. Mark inference as inference outside copy.
3. For **provider/partnership** campaigns, inspect product/platform and program eligibility first. Distinguish integration, reseller, affiliate, referral and startup-credit tracks. Prepare exact application answers only for a relevant track. A partner directory is not an enrollment program. If no suitable program is found, record pages checked/date and proceed to a contact route. If program status is unknown, flag it. Never claim application submitted without confirmed activity.
4. For **customer sales**, inspect the relevant workflow/product/use case and likely buyer. Do not require partner applications or prospect platform signup. Connect a verified business fact to a plausible use case without asserting an unverified pain point.
5. Choose a primary contact whose current remit fits, and a backup only where supported. Prefer responsible functional leader over reflexively choosing CEO. Save exact profile links and published business email or official contact form. A company inbox is not a personal address; address its team and request routing. Mark stale roles and inaccessible sources for recheck.

## Write and review

Read [message-guide.md](references/message-guide.md). Draft one concise email and distinct LinkedIn copy per qualified prospect. One specific, verified company fact should explain relevance to the offer. Add one low-friction ask. Use only campaign-approved claims; do not invent personal familiarity, applications, deadlines or metrics.

Produce campaign brief, research ledger, application drafts when relevant, and review queue. Each review card contains sender, company, contact/role, exact destination or unresolved route, channel, subject/body or form fields, evidence, blockers, and next action. Include initial and conditional follow-up drafts; never queue follow-ups as due without actual send history.

Read [queue-format.md](references/queue-format.md) when generating a versioned queue. Use `scripts/review_queue.py build INPUT_JSON OUTPUT_DIRECTORY` to render it. Reuse stable item IDs across runs. This helper does not research, sync CRM, send, submit, check replies, or schedule runs. Browser/connector work is performed by the assistant with tools available in the current environment.

Follow-ups: default first review five business days after confirmed initial send, final review seven business days after confirmed first follow-up send. Use campaign timezone and holiday calendar if supplied; otherwise weekends-only and label that assumption. Fresh activity check required before marking due. A draft's creation/approval date is never its send date. Reply, decline, opt-out, meeting, active negotiation or unresolved ownership pauses company-level sequence. Do not contact a backup to bypass a pause.

Edits to sender, destination, subject, body, form fields, sources, or blockers invalidate previous approval. Record real manual sends separately with timestamp, channel, exact version and destination only when confirmed. Preserve prior history and owner; never silently overwrite another founder's activity.

## Repeat runs and handoff

On rerun, reconcile shared tracker, update evidence, detect replies/status changes and produce only new or changed review items. Report blockers and counts, not invented completion. If user requests recurring runs, use the environment's supported scheduler with a campaign-specific draft-only prompt and explicit cadence. Do not claim background automation exists until configured. Keep scheduler quiet on unchanged/non-actionable runs; notify for meaningful new review items, failures or required input.

Conclude with links to review files and explicit state: draft package, unresolved checks, tracker changes, and whether any schedule is active.
