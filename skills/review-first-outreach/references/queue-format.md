# Versioned review queue

Python 3 standard library only. Assistant writes input JSON then runs:

`python3 scripts/review_queue.py build INPUT_JSON OUTPUT_DIRECTORY`

Paths above are relative to this skill folder; use absolute paths when invoking elsewhere. Creates `queue.json` and readable `review.md`. On repeated builds in the same output directory, keeps unchanged items and approval, archives replaced/removed versions in history, and invalidates approvals on changes. Removed items leave the active queue. All items remain manual-action only. Keep per-campaign output folders; never build concurrently into the same folder.

Input object has `campaign_id`, `sender` object (at least `name`), and `items` array. Each item:

| Field | Meaning |
|---|---|
| id | Stable item identifier; distinct initial/follow-up/application IDs |
| company | Display name |
| company_domain | Canonical lowercase domain; reconcile aliases in shared tracker first |
| channel | email / linkedin / application |
| destination | Exact email, LinkedIn URL or form URL; empty when unresolved |
| subject | Email subject, otherwise empty |
| body | Draft text; for applications describe purpose and include fields below |
| fields | Optional exact form field-to-answer mapping |
| evidence | List of objects with url, checked_at, claim |
| blockers | List of unresolved checks; empty only after all checks pass |

All fields belong to content fingerprint. An unresolved destination automatically blocks approval. Missing evidence blocks approval. Add blockers for stale roles, missing sender details, unread tracker, unsent application prerequisites, stale reply check or missing actual send timestamps for follow-ups. Helper cannot determine these itself.

After explicit human approval of the displayed exact version:

`python3 scripts/review_queue.py approve OUTPUT_DIRECTORY ITEM_ID VERSION_HASH REVIEWER_NAME`

Use full hash from queue JSON or review card. This records review approval, NOT permission or execution of a send. No automatic approval from sentiment, silence, a prior campaign, or bulk approval of unseen drafts. Rejection or requested changes should remain blockers on the revised input.

Activity remains in the shared tracker: company domain + aliases, owner, campaign, item/version, destination/channel, actual sent/submitted timestamp, reply/status, next review date. Queue approval must never be used to populate sent_at.
