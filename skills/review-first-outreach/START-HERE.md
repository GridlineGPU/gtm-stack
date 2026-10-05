# Outreach kit — for any founder or campaign

This is an assistant-driven workflow you run on demand, with a local versioned review queue. It supports selling to customers, onboarding providers and forming partnerships. It researches and drafts using the assistant's available browser/connectors. It does not send messages, submit applications, sync a CRM by itself, or run in the background until separately configured.

## Start without installing anything

Unzip this folder. Give an assistant access to the folder, your prospect sources and your shared tracker. Ask it to read `SKILL.md` and follow the workflow. Browser access or suitable connectors are needed for research and tracker reads; if unavailable, provide exports and expect unresolved checks to be flagged. Python 3.9+ is needed only for the included queue helper.

Fill `references/campaign-brief.md`, or explain those details in chat. Keep separate campaigns for each sender/offer. Share one tracker across founders so each sees company ownership, previous outreach and replies.

Copy this prompt:

> Read this folder's SKILL.md and run review-first-outreach. Use my campaign brief and shared tracker. Research the first five eligible companies, reconcile prior contact and owner, find the right person and a verified business contact route, and draft a personalized email plus LinkedIn copy for each. For a partnership campaign, inspect relevant partner programs and prepare application answers first. Save evidence, unresolved checks and versioned review cards. Do not send anything, create accounts or submit forms. Do not imply I've applied or contacted anyone unless tracker activity confirms it.

For Codex installation, ask: “Install this review-first-outreach folder as my personal skill.” Then use `$review-first-outreach` with the campaign brief. The original author's copy is installed locally; your own installation and account access are separate.

## What review looks like

Each card shows exact sender, recipient/destination, personalized text, evidence, blockers and next action. Approve a specific version or request edits. Changing sender, recipient or content invalidates old approval. Approval does not send anything. Send manually after review, then record actual activity in the shared tracker.

Minimum shared tracker fields: company/domain/aliases, campaign, owner, primary contact, role, business email/profile or form, program status, outreach status, exact last-send timestamp/channel, reply or meeting state, next review date, evidence links, draft version and approval. Preserve historical sender ownership.

## Repeat or schedule

Ask “Run the next five eligible prospects” or “Check confirmed sends for follow-ups due for review.” New drafts are not evidence that messages were sent. Replies, declines, opt-outs, meetings and active conversations pause further outbound drafts.

For recurring work, specify campaign, cadence, timezone and connected tracker. Ask your assistant to configure its supported scheduler for research and review drafts only. Local schedules may require the computer and app to stay running. No background schedule is included in this archive. Review notifications should appear only for meaningful changes or required action.

## Share safely

This archive contains generic instructions and a queue helper. It contains no prospect records, private conversations, account credentials or founder identity. Share the whole archive with your cofounder; each founder supplies their own brief and access.
