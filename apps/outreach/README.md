# Outreach Studio

Local review-and-execute app for provider onboarding, partnerships and customer sales. You research a prospect, edit the email, LinkedIn and application copy, and approve one exact action set. Defaults to test mode and binds only to `127.0.0.1`.

## Run it

Bun 1.3.14 or later. From the repository root:

```sh
bun install
bun run start        # http://127.0.0.1:4310/
```

`bun run dev` reloads on change. State lives in `apps/outreach/.data/workspace.sqlite` (gitignored); closing the tab loses nothing.

## Source data

Studio builds its company tracker from a source folder: `OUTREACH_SOURCE_DIR`, default `apps/outreach/data`. The folder's `source.json` names the data files (paths relative to the folder) and holds instance settings:

| Key | What it is |
|---|---|
| `files.providers` | Researched companies by region, with people and reference drafts. Required. |
| `files.sheet` | Tracker sheet rows: company, POC, partner status, story, NCP, sales status, location, owner (columns A to H). Required. |
| `files.sheetLatest` | A newer sheet snapshot merged on startup if the workspace's last sheet import is older. |
| `files.curated` | Companies added outside the sheet, already in tracker shape. |
| `files.emailResearch` | Published business-email ledger. Fills blank draft emails once, preferring a matching named contact, then partnership and sales inboxes. |
| `files.samples` | Sample prospects for a fresh workspace. |
| `aliases` | Sheet name to research name, where the two sources spell a company differently. |
| `knownPriorContact` | Company ids contacted before the tracker existed. They stay blocked from fresh live outreach. |
| `curated.draft`, `curated.park` | Curated companies that get a draft, or a paused prospect with a reason, on startup. |
| `sheetUrl`, `artifactUrl` | Links shown on each company record. |

`tests/fixtures/` is a complete example made of fictional companies; `tests/fixtures/make-fixtures.py` regenerates it. Tests always run on it, never on your data.

## Try the workflow

1. Open **Review inbox** and pick a sample prospect, or create a customer campaign with your own sender and offer.
2. Edit the company fact, source and contact under Research. Refresh the drafts, or use connected research.
3. Check the Email, LinkedIn and Application tabs. Starter application answers are proposed fields, not verified form mappings.
4. **Review actions**: choose application, email and/or LinkedIn handoff, and inspect the exact sender, destinations and content.
5. Approve once. Activity shows a receipt and an immutable content snapshot per action. Test mode makes no external calls.
6. Approve the same action again: blocked. Edit a draft while another tab shows its approval screen: the stale approval is rejected.
7. In Connections, clear test receipts to repeat. Live history is kept.

## Company tracker

**Choose companies → review message → approve actions.** In Company tracker, pick a region and the sender for new drafts, then **Add filtered to review**. Adding drafts never sends.

- Bulk preparation adds one primary draft per company, preferring the sheet POC, then partnership and product leaders. Companies with prior activity stay paused. Unknown websites and duplicate domains are reported for review. It never researches externally, marks contacts verified, or invents email addresses.
- After sending outside Studio, **Mark email sent**, **Mark LinkedIn sent** or **Mark application submitted** records sender, contact, date, destination and the exact draft. **Log past activity** covers older records. Both only write local history.
- **Tracking & research** edits owner, POC, sales and partner status, next step, follow-up and notes. The latest sheet values stay visible for comparison.
- **Prepare draft** uses the chosen campaign's sender and the company hook. It never copies a reference draft's sender or an "already applied" claim. Copy says "We've already applied through [company]'s partner program" only when the tracker says Applied without a sheet conflict, a manual applied event exists, or a live application receipt confirms it.
- **Tracker CSV** exports status and recorded messages. The workspace JSON export in Connections holds everything.

Unknown history stays unknown until logged. A sales stage does not prove which contact got a message. Test receipts and LinkedIn handoffs never count as outreach. SMTP acceptance is not delivery. Opt-outs are sticky.

Source import runs once on startup. Restarts never overwrite tracking edits, and nothing is written back to the sheet.

## Sheet updates

Export the sheet as XLSX and run from the repository root:

```sh
bun apps/outreach/scripts/sync-sheet.ts /absolute/path/to/sheet-export.xlsx
```

Needs Python 3 and an initialized workspace (`OUTREACH_DATA_DIR` picks another one). Headers are validated first; a failed check changes nothing. New companies and POCs are added; missing rows are kept and flagged. A sheet value merges only where the local field is unchanged. Otherwise **Keep local / Use sheet** resolves the conflict. Updated companies lose verification, so their drafts need review again. You can schedule this with any local automation; it only reads the sheet.

To collect published business emails with Studio running: `bun apps/outreach/scripts/find-business-emails.ts`. Raw results go to the ignored `.data/email-research/`. Review them before adding them to your ledger. Addresses are never guessed from name patterns.

## Email

Sender identities are currently Gridline's two founders, selectable per draft under **Review inbox → Send as**. Switching regenerates that prospect's copy, clears verification and needs fresh approval. Making senders configurable is on the roadmap.

Create `apps/outreach/.env` (never commit it). One mailbox:

```dotenv
OUTREACH_ENABLE_LIVE=true
OUTREACH_SMTP_HOST=your-mail-provider-smtp-host
OUTREACH_SMTP_PORT=465
OUTREACH_SMTP_USER=your-business-email
OUTREACH_SMTP_PASSWORD=your-app-password
OUTREACH_SMTP_FROM=your-business-email
```

Per-founder mailboxes use the same keys with a sender prefix (`OUTREACH_SMTP_AKSHIT_*`, `OUTREACH_SMTP_CHINMAY_*`). Studio picks the credentials whose `FROM` matches the approved campaign address. Port 465 uses TLS; other ports use STARTTLS. Credentials stay server-side. Restart, then select Live mode in Connections.

One approval executes one exact snapshot and action set. A timeout or crash leaves the action `uncertain` and blocks automatic retry; check the mailbox before resolving it. There is no mass-send queue: approvals are per company. Check your mail provider's bulk-sending policy.

## Research

```dotenv
OPENAI_API_KEY=your-api-key
OUTREACH_RESEARCH_MODEL=your-web-search-capable-model-id
```

Research & draft calls the OpenAI Responses API with web search. It sends the company domain and campaign offer, never credentials or tracker history. Generated contacts stay unverified.

## Partner application adapters

Automatic form submission needs a mapping a developer has inspected. `forms.example.json` shows the shape; it is not a real integration. Point `OUTREACH_FORMS_FILE` at a local JSON array and run `bunx playwright install chromium` once.

An adapter names the exact HTTPS URL, allowed hosts, expected visible form text, field selectors, submit control, success marker and terms. Execution fills approved values only and stops on a changed form, an unreviewed populated control or a missing field. If a form needs login, CAPTCHA or uploads, use the native form. Do not bypass those controls.

## LinkedIn

LinkedIn prohibits unauthorized automation. Studio prepares a handoff: copy the approved message and open the profile, then send in LinkedIn's own composer. It never logs in, scrapes or sends. A handoff receipt does not mean a message was sent. Policy: https://www.linkedin.com/help/linkedin/answer/a1341387/prohibited-software-and-extensions

## Boundaries

- Local, single operator. Export/import shares research, not live state. No hosted auth. Do not tunnel the loopback server.
- Initial outreach only: a repeated live action on the same channel and company is blocked. Follow-up scheduling is not built.
- Replies are recorded by hand.
- Tested locally: test execution, approval invariants, browser UX. Real SMTP delivery, paid research and live form submission are untested until configured and approved.

## Validation

```sh
bun run test
bun run typecheck
bun run lint
bun run build
```

Actions are reserved in a SQLite transaction before dispatch. Approval is tied to prospect revision and workspace version. Cross-origin writes and unknown Host headers are rejected.

API sources: https://nodemailer.com/smtp · https://playwright.dev/docs/input · https://developers.openai.com/api/docs/guides/tools-web-search
