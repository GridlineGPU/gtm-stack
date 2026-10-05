---
name: outreach
description: Research a named company (credit union, bank, or other financial institution) and produce a ready-to-use outreach list — the right people to contact, their LinkedIn search strings and URLs, a one-line bio each, and a personalized connection request written underneath each person. Use this skill whenever the user names a company and asks who to reach out to, who to connect with, who to talk to, who is relevant, or asks for an outreach list, prospect list, or contact list. Also use it when the user pastes a bare company name into a conversation that has already been about outreach, since that is a request to run the same workflow again. Do not wait for the user to say the word "outreach."
---

# Outreach

Turn a company name into a usable outreach list: who to contact, how to find them, and what to send.

The user works in technology for credit unions. Their goal is **conversations and learning**, not pipeline. Every choice in this skill should serve that. A list of senior titles is easy and useless; the value is in finding the specific people who will actually reply, and giving the user a reason to write to each one that is true of that person.

## What the user provides

Usually just a company name. Sometimes a batch. Occasionally a variation on the message framing. Take the company name and run the whole workflow without asking clarifying questions — the format is established, and asking again wastes their time.

## Step 1: Research

Use the Parallel Search MCP (`Parallel Search Mcp:web_search`) with multiple queries per call. Run three or four calls, each with a different purpose. Reuse the same `session_id` across calls within a company so results build on each other.

**Call 1 — executive leadership.** Query the leadership page, the CEO, the CIO/CTO, the COO. Institution websites usually have an "our leadership" or "about us" page that lists the full executive team, and that page is the most reliable source. Prefer it over data aggregators.

**Call 2 — the operators.** IT managers, network and systems administrators, information security, digital banking, quality assurance, contact center, member experience, operations support. These are the people who feel the pain and they rarely appear in press releases. Use `"Company Name" linkedin <role>` phrasing, since that surfaces profile data.

**Call 3 — recent events and public voices.** Mergers, core conversions, AI launches, digital banking rebuilds, executive appointments, conference talks, podcast appearances, bylined articles. This call produces the *hooks* — the specific public thing you will reference in each message. Without it the messages have nothing true to say.

**Call 4 (optional) — fill gaps.** If a specific person looks important but thin, or the leadership page listed seven department heads and you only found three, run a targeted follow-up.

Fetch the leadership page directly with `Parallel Search Mcp:web_fetch` when search snippets truncate it.

### What to extract

For each person: name, exact title, tenure, career path (especially whether they came up through the ranks or arrived from outside), certifications, prior employers, and anything they have done publicly. Career path matters more than title. Someone who started as a sysadmin and is now the CIO is a completely different conversation from someone who arrived from consulting.

## Step 2: Rank

Order the list by **who will actually reply and teach the user something**, not by seniority. Lead with whoever is the closest functional match or has the most public footprint, and say plainly in the intro who to write to first.

Four tiers, in rough priority:

1. **Public voices.** People who already write, speak, or podcast about the industry. Someone who spends energy explaining their job to strangers is the person most likely to explain it to one more. These are gold and they are often senior.
2. **Functional counterparts.** Quality assurance, IT operations, digital experience, infrastructure. The user's actual peers.
3. **Adjacent-but-unsellable.** Board members with technical day jobs, former employees now at vendors or other institutions, retired executives. They cannot buy anything, so their guard is down. Often the single best learning conversation on a list — flag them explicitly when you find one.
4. **Senior buyers.** CEO, CFO, CLO. Include them, but be honest that reply rates are lower.

## Step 3: Write the output

Open with a short company header: asset size, member count, employee count, core processor if known, and any live situation (a merger mid-integration, a core conversion four weeks old, an AI assistant in production). Then one short paragraph of judgment — what makes this company interesting, who to message first, and why. Keep it to a few sentences. The user wants the list, not an essay.

Then each person as a block:

```
### Full Name linkedin Company Name
https://linkedin.com/in/their-slug
One or two lines: title, tenure, career path, anything notable.

> The connection request message.
```

The heading is formatted as `Name` + `linkedin` + `Company Name` so the user can copy the whole line straight into Google without retyping. Keep it exactly in that order.

Include the LinkedIn URL **only if a real one appeared in search results.** Never construct one from a name pattern. If there is no URL, omit the line entirely and say so if it matters.

Close with a short notes section: conflicting information, stale titles, people you could not name and how the user can find them, and any sequencing caution.

## Step 4: Write the messages

This is the part that matters most and the part most likely to go wrong. The messages must read as though a human wrote each one after spending two minutes on that person's profile.

### Structure

Three or four short, plain sentences. This is the default pattern:

> Hey [Name], I work in credit union tech. Saw that you [what they do / what you read]. Would love to learn about [topic area, phrased impersonally]. Would be great to connect!

Two real examples:

> Hey Ray, I work in credit union tech. Read your CUInsight pieces on agentic AI and the NIST framework. Would love to learn about current validation practices before agents touch production and during production. Would be great to connect!

> Hey Teresa, I work in credit union tech. Saw that you run digital experience at Securityplus. Would love to learn about the reliability practices the team currently has in place. Would be great to connect!

**Ask about a topic, not about them.** This is the single most important rule and the easiest to get wrong. "Would love to learn about current validation practices" works. "I'd want to ask how you validate an agent before it touches member accounts" does not, even though it is more specific. The second version asks a stranger to account for how they personally do their job, which is presumptuous in a cold connection request and carries a faint implication of audit. Phrase the subject impersonally: "current practices," "the team," "how X works today." Not "your process," not "how do you."

**Plain over clever.** Do not make sharp observations at the recipient's expense, even accurate ones. "Usually the contact center knows something's broken before IT does" is true and it is still the wrong thing to send a stranger, because it tells them you have opinions about their organization before you have met. Say the boring version instead.

**Specifics are optional, plainness is not.** Naming concrete systems can help when the person is genuinely associated with them, but do not force it. "Saw that you run digital experience at Securityplus" is enough. A long parenthetical of vendor names can read as performance rather than homework.

Why each part works, so you can reproduce the effect rather than the words:

**"Hey" not "Hi".** Warmer, reads like a person rather than a template.

**"I work in credit union tech."** Four words, own sentence, done. Do not explain further. Longer self-introductions read as setup for a pitch.

**The parenthetical is the whole message.** `(IVR, Interface.ai)` is compressed proof of homework. Two or three concrete named things — a vendor, a platform, a project, a system — do more than a paragraph of context. Name real specifics: Fiserv DNA, Alkami, Lumin Digital, Jack Henry, a named AI assistant, a named merger, a core conversion. If you cannot fill the parenthetical with something real and specific, you have not researched enough. Go back to Step 1.

**When there is no strong overlap, say so plainly.** Not every person has a hook that connects neatly to reliability. Do not manufacture one. "Would love to learn about the reliability practices the team currently has in place" is a fine ask for almost anyone with an operational seat. Plain and honest beats forced relevance.

**"Would be great to connect!"** Warm, asks for nothing beyond connecting. The exclamation is fine.

Keep it around 200 characters. Shorter is better.

Vary the phrasing across people so a batch to one company does not read as a mail merge. Rotate the opener ("Saw that you lead...", "Saw that you run...", "Read your...") and vary the topic to match the seat: monitoring and incident response for infrastructure, model and vendor risk for compliance, service issues surfacing for the contact center.

### Rules

**Never use em dashes.** This is non-negotiable and applies to the whole response, not just the messages.

**Reference public company work, not the person's career history.** "Read about how you did a core conversion, a CRM and new digital banking all at once" is friendly. "You were a sysadmin here, left for 13 years, came back" is forensic and reads like being profiled. The distinction: talk about what the company did, and let the person's role be the reason you are asking them.

**Aim for about 200 characters, hard cap 300.** LinkedIn connection requests are capped, and short reads as human anyway. If a message is running long, cut explanation first.

**Lead with what you saw, then the topic you want to learn about.**

**No pitch, no ask beyond connecting.** The user wants to learn. Let the message say that plainly.

### Phrases to avoid

These mark a message as machine-written or as sales:
- "I'd love to reach out" / "circle back" / "touch base" / "quick question"
- "I hope this finds you well"
- "in the space" as a standalone filler (fine inside "your read on the space")
- "excited to" / "thrilled to"
- "leverage" / "synergies" / "solutions"
- "As someone who..." openers
- Anything that flatters the recipient before saying anything of substance
- "it's rare to find someone who..." unless it is verifiably true of that specific person. Applied to anyone with a public track record in the thing you are praising, it is obviously false and reads as filler.
- Any compliment used in place of an actual reason for writing
- "how do you..." / "your process" / "your team" — phrase the subject impersonally instead
- Sharp observations about their organization, however accurate. You have not met them yet.

### Calibrating to the reader

Adjust the topic to the seat, not the tone to the person. Infrastructure and IT ops get monitoring and incident response. Risk and compliance get model and vendor evaluation. Contact center and member services get how issues surface. Digital and product get release and testing practice. Lending and finance get model validation. Someone who writes publicly on a subject should have their actual work referenced rather than a generic version of it, but the ask stays the same shape.

## Step 5: Notes and cautions

Always close with these when they apply:

**Sequencing.** At a 60 to 160 person institution, people in the same reporting line talk. Tell the user to space those messages out by a week or two and who to send first.

**Conflicts.** When two sources disagree on who holds a title, say so and name both, rather than picking silently. Aggregator sites (RocketReach, ZoomInfo, Datanyze, LeadIQ, TheOrg) go stale; the institution's own leadership page and recent press releases are more reliable.

**Name collisions.** Some institution names collide badly in search (Navigator vs Navigant, for example). Warn the user, since they will hit the same problem when they google the names.

**Gaps, honestly.** At small institutions the whole IT team may be four people with no public footprint. Say that plainly rather than padding the list with a sales assistant. Then tell the user how to close the gap themselves: LinkedIn company page filtered by role, or a recently posted job req that implies a new hire.

## What not to do

**Do not compile contact details.** Names, titles, and public LinkedIn URLs only. No emails, no phone numbers, no personal addresses, even when an aggregator result exposes them. If a company publishes executive emails on its own website, you can mention that the page is public, but do not transcribe the addresses into the list.

**Do not fabricate.** No invented LinkedIn URLs, no guessed titles, no assumed tenure. If a detail came from a low-quality source, mark it as needing verification.

**Do not pad.** A list of six real people beats a list of twelve where six are filler.

## Example output shape

```
**Example Credit Union**, Springfield IL. Around $400M, 22K members, 60 employees.
Just finished a core conversion and launched an AI voice assistant.

At 60 employees the person who fixes it is usually the person who decided it,
so the IT lead is your first message.

### Jane Doe linkedin Example Credit Union
https://linkedin.com/in/janedoe
VP of Information Technology. Came up through the help desk, now runs the whole
function. Quoted in the AI assistant launch.

> Hey Jane, I work in credit union tech. Saw that you lead IT at Example CU
> through the core conversion and the AI assistant launch. Would love to learn
> about the testing practices the team has in place. Would be great to connect!

### John Smith linkedin Example Credit Union
Chief Experience Officer. Owns contact center and member experience.
No public LinkedIn URL found.

> Hey John, I work in credit union tech. Saw that you lead member experience at
> Example CU. Would love to learn about how service issues surface from the
> contact center today. Would be great to connect!

---

**Notes.** Doe and Smith are two levels apart at a 60 person shop. Space them a
week apart, Doe first. TheOrg lists a different CEO than the company's own
leadership page; the leadership page is likely current.
```
