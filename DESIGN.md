# Evenkeel — design

The spec lives here; the code points at its sections (`DESIGN.md §5.3`). It says what's built
and decided, and (§6–8, §10) what's planned for later phases. Update it when a decision changes.
The planning doc it grew from (*Personal Task & Notes System — Spec v0.1*, Oct 2026) has been
merged in; the original stays out of the repo (it's ignored) for the name list and the history.

## 1. Purpose

A single-user, self-hosted app that replaces Todoist first, then takes in notes and calendar.
**North star: relief, not productivity.** The goal isn't to finish everything; it's to put things
down and stop carrying them. Three promises, and a test for every feature:

1. **Nothing gets lost.** Capture is so cheap that holding something in my head is never easier.
2. **Nothing stays foggy.** Vague things become a first step that takes no thinking.
3. **Nothing nags.** Things come back at the right moment, never with scolding. Missed plans
   shift; nothing turns red; counts are information, not alarms.

Does it help nothing get lost, nothing stay foggy, or nothing nag? If not, it's feature creep.

Why it works: unfinished intentions keep pulling at attention until they're done or handed to a
system you trust, and making a concrete plan is enough to quiet them (Masicampo and Baumeister,
2011). The app is the ship's hold: everything stowed and secured, so the deck stays clear.

- **Built for one person.** No teams, sharing, invites or monetization.
- **Notes and tasks are the same object** (§4.1): one can become the other as it evolves.
- **AI proposes, I decide.** It extracts, questions, estimates and suggests; nothing is
  committed without a tap.
- **Review beats writing.** The usual move is answering a question or approving a suggestion,
  not filling in fields.
- **No guilt UI.** Missed things shift or fade; nothing sits in red.
- **Portable data.** Notes end up as plain Markdown files (phase 4).
- **Fast.** Open and take a capture in under two seconds on the phone.

**Scope.** v1 replaces Todoist's personal, Reminders and Back Burner projects; work tasks stay in
sideshow for now. Eventually: steps, recurrence, deadlines, durations, dependencies; quick add,
voice rambles, AI extraction; clarify and breakdown; chores on flexible cadences; push to
Android; scheduling into one Google Calendar; notes with attachments, folders and tags.
**Out:** native apps (PWA only, §10), anything multi-user, email, chat, a backlinks graph,
plugins, and sideshow's ConnectWise workflows.

## 2. Stack

The same as foodlab and sideshow, so anything learned there applies: an npm workspace with
`shared` (types, validation, derived views, pure), `server` (Node + Hono + `node:sqlite`) and
`web` (React + Vite, an installable PWA with a share target). Hosted on the mini PC beside them,
port 8083, `https://evenkeel.evans.tools` behind Cloudflare Access (docs/runbook.md).

## 3. Phases

1. **Capture and clarify.** Items, inbox, typed capture, Today, All, item pages, PWA install
   (**built 2026-11-07**); then voice rambles with AI extraction and the clarify interview
   (**built 2026-11-08**, §5.6).
   *Done when* a 10-minute ramble becomes reviewed inbox items, and a vague admin task has a
   next action and a "have ready" checklist.
2. **Chores and reminders** (§6). Cadences with freshness instead of overdue, Web Push, Todoist
   import. *Done when* the Sunday chores run here for 3 weeks and Todoist isn't opened.
   Todoist gets cancelled after this phase.
3. **Planning and calendar** (§7). "I have time this weekend", estimates, one Google Calendar.
   *Done when* a weekend plan is proposed, accepted, and shows up in Google Calendar.
4. **Notes** (§8). Markdown view, attachments, folders/tags, notes as `.md` files, Obsidian
   import. *Done when* a home project (the kitchen renovation) lives here as one note with its
   tasks.

## 4. Records

### 4.1 Items

Everything is an **item**. A task is an item with a status; a project is an item with steps
(children); a note is an item with no status. One can become another without moving.

| Field | Meaning |
| --- | --- |
| `parentId`, `position` | A step of another item, and its order among its siblings |
| `title`, `body` | The name; Markdown notes |
| `status` | `open` · `done` · `skipped` · `dropped`; **null = a note** |
| `tier` | `inbox` · `hard` · `chip` · `back` (§4.2) |
| `area` | A free label (Home, Health, Money…); Settings lists the ones offered |
| `deadline` | A real consequence date |
| `scheduled` | The day I plan to do it |
| `estMinutes`, `energy` | How long, how much it takes out of me |
| `nextAction` | The one concrete next step |
| `blockedBy` | Items it waits on |
| `doneAt` | When it was finished, skipped or dropped |
| `repeat` | How it comes back, or null (§6.1): `{ kind: about · on, every, unit: day · week · month, days, start }` |
| `log` | A repeating item's done and skipped days, `[{ day, did }]`, the last 100 |
| `oneOff` | Answered "Doesn't repeat" to the Chores area's "How often?" |
| `snoozedUntil` | Later: off Today and out of All's picks until this day (§6.1) |

Skip is "didn't do it this time, and that's fine" (for chores, phase 2); Drop is "not doing it".
A step takes its parent's tier when added. Deleting an item deletes its steps; Undo restores both.

### 4.2 Tiers, not priorities

No priority flags. Three tiers I'll actually respect, and the inbox before them:

- **Hard date**: has a real deadline (sorted soonest first in All).
- **Chipping away**: worked at over time.
- **Back burner**: someday.

### 4.3 Settings and dev notes

`settings` has one record, `app`: the areas list. Colors and fonts are per device (localStorage).
Dev notes (🧪, the same as foodlab's and sideshow's) are notes about the app itself: editable,
optionally linked to the page they were written on ("Link it to this page", remembered per
device), with files attached (📎, or paste a screenshot into the box). Copy puts the open ones
on the clipboard as Markdown. Files are uploaded to `POST /api/files`, kept in `data/files`
under their ids (the `files` table has their names and types) and backed up with the database.
Mirrored to `data/dev-notes.md`, with each note's files, for the next build session.

### 4.4 Planned records

Added with the phase that needs them (each a new migration in server `db.ts`):

| Table | Holds | Phase |
| --- | --- | --- |
| `captures` | Raw input: typed text or audio, transcript, source (quick add, ramble), processed | 1 |
| `proposals` | AI suggestions awaiting review: kind (new item, split, question, schedule), payload, pending / accepted / rejected | 1 |
| `questions` | Clarify questions on an item, with my answers | 1 |
| `push_subscriptions` | Web Push endpoint and keys per device | 2 |
| `calendar_links` | Item ↔ Google Calendar event, sync state | 3 |
| `attachments` | File, type, item | 4 |

Tags (phase 4) get a join table.

## 5. Screens

Phone-first; under 860px a top bar, a bottom tab bar (More · Today · All · Inbox · Capture,
Capture rightmost for the thumb) and a floating +. Desktop has the sidebar. Keys: Alt+N adds;
C, I, T, A go to Capture, Inbox, Today, All.

### 5.1 Capture (`/`, the landing page)

One box, one thing per line, straight into the inbox. List markers and checkboxes are dropped
(`- [ ]`, `*`, `1.`; `[x]` makes it done); an **indented line becomes a step** of the line above,
so a pasted Todoist or Obsidian list keeps its shape. Tab indents. Ctrl+Enter adds. Lines over
200 characters get a cut title with the whole text in the body. The draft survives closing the
app. **Quick add** (+, Alt+N) adds one thing; "Today" also plans it for today. **Share to
Evenkeel** from Android opens Quick add with the shared title and the link in the notes.

### 5.2 Inbox (`/inbox`)

Unfiled top-level items, **in the order captured** (a ramble reads as it was said). Each row
files in one tap: Hard · Chip · Back · Note, with an area picker. Done and delete are there too.

### 5.3 Today (`/today`)

- **Planned**: scheduled for today. "Not today" takes it off the plan.
- **Still on deck**: scheduled for an earlier day and not done. Never red, never "overdue":
  "from Tue", with Today / Not today.
- **Deadlines this week**: up to 7 days out; a passed one says "was due Tue" quietly.
- **Quick wins**: up to 3 open hard/chip items with a next step or ≤ 20 minutes, no open steps,
  not waiting on anything, not repeating; untouched longest first.
- **Chores**: repeating items that are due (§6.1), stalest first, in their own group at the end,
  with Later and Skip. Not in the Today count.

The Today count is planned + on deck + deadlines due today or passed.

### 5.4 All (`/all`)

**On trial (2026-11-07).** A long list of equal rows is what makes to-do apps stop working for me:
too many choices, too much to do. So All has four views to try, and use decides what stays. The
view is remembered per device and sits in the address (`?v=`), with the filters.

- **Three**: three things and no totals. Hard and chip items that aren't waiting; a project offers
  its first open step. The day fixes the shuffle. "Something else" swaps one for this session, and
  passed-over ones return only when nothing else is left. The back burner and notes aren't offered.
- **Areas** (the default): a tile per area with its count; one open at a time, so only that list is
  on screen.
- **Board**: every area at once, in as many columns as fit.
- **List**: by tier: Hard date, Chipping away, Back burner, Notes.

Areas get a color by their place among the areas in use, A–Z, so adding an area can shift colors.
No reds. Rows are tight, one line where the title fits; back-burner items and notes are quieter.
Search looks in title, next step, notes and area, and into steps (a matching step shows its
top-level item). Area filter, "Finished too".

Three is a first, dumb version of the planner (§7): when estimates, energy and a time window
exist, it should pick by those instead of a shuffle.

### 5.5 Item (`/items/<id>`)

Title with its box; the **Next step** box up top (the clarify interview will fill it); Kind
(Task/Note), Where (tier), Area, Deadline, Planned for (+ Today), Takes (min), Energy, Waits on;
Notes; Steps (add with Enter, reorder ↑↓, tick off); Skip · Drop · Delete. Everything saves as
you go (`DraftInput` on Enter or leaving the box, as in foodlab).

### 5.6 AI (phase 1, part 2; built 2026-11-08)

Reuses foodlab's AI module (Claude and GPT, cost in `ai_usage`, monthly cap). Both write
**proposals**, never items: nothing is committed without a tap.

**As built** (2026-11-08; the plan it came from follows):

- **Capture page: 🎙 Talk and ✨ Sort.** 🎙 records on the device; the server transcribes it
  (OpenAI's `gpt-transcribe`, sideshow's dictation) and the words land in the capture box, where
  they can be fixed or added to (typing or pasting a ramble works the same). ✨ Sort sends the box
  to the **fast model** (Settings → AI → Sort a ramble, Haiku by default). The review lists each
  candidate with a Keep box, its title, kind (Task, Project, Chore, Note), tier, area, a deadline
  chip (✕ to drop it), an estimate, the speaker's words, and a project's steps (editable, ✕).
  One that looks like an open item is unticked and links to it. **Keep N** makes the items (steps
  under them, his words quoted in the notes; Undo takes them back); **Edit the text** puts the
  ramble back in the box; **Discard all**. The review is kept on the device until it's done.
- **Item page: ✨ Clarify** (any item). The **stronger model** (Settings → AI → Clarify, Opus by
  default) answers with up to 6 questions and a draft plan at once: a clearer title, a next step,
  steps with minutes (and the total), "find out" steps, a "have ready" list. Answer what's easy
  (each has **Don't know**) and **Redraft with my answers**, or accept the draft as it is. Everything
  in the plan is editable and removable. **Accept** sets the title and next step, adds the steps
  and find-outs as steps, and adds **Have ready** (a checklist) and the answers (**Clarified**,
  dated) to the notes. Undo puts it all back.
- The model only sees what it needs: today, the areas, open top-level items (for duplicates,
  ramble only), and for clarify the item, its path, notes, steps and earlier answers. Its answer
  is checked before it's shown (`shared/ai.ts`): areas only from the list, real future dates only
  (a hard tier without one becomes chip), duplicates only of open items.
- **Settings → AI**: the two models (Clarify's "Off" turns all AI off), which keys the server
  has, this month's estimated cost with a meter and recent calls, the monthly cap ($5 by default)
  and alerts. Kept on the settings record (`ai`), so it's the same on every device.
- **Not yet:** recordings kept across closing the app (IndexedDB, below); a recording that fails
  to send has Try again while the app stays open. A ramble's whole transcript isn't stored, only
  each kept item's quote.

**The plan:**

- **Ramble**: hold the mic, record; the server transcribes (OpenAI, the key foodlab has);
  the model extracts candidate items (title, kind, area, tier, dates, duplicate-of, the quote);
  the inbox shows them to keep, edit or discard. The raw transcript stays with its capture.
- **Clarify**: on any item, 3–6 questions, then a next step, steps with estimates, a "have
  ready" list, and unknowns as "find out" steps. "Don't know" is a fine answer: it becomes a
  step. Then accept all, edit, or reject.

One function per job, each returning JSON that's checked before it becomes a proposal (with Zod,
as foodlab's `ai.ts` does; `validate.ts` stays hand-written). A fast model for extraction, a
stronger one for clarify and planning.

Recordings wait on the phone until they're sent, so a ramble on bad signal isn't lost: that's
audio, which localStorage can't hold, so offline captures move to IndexedDB. (localStorage's
~5 MB is fine for the synced state for now, 48 KB at 111 items; notes in phase 4 will need
IndexedDB for that too.) Every call gets a short context:
today's date, the areas, and the titles of open items in the same area (to catch duplicates).

**Extract (ramble → items)**

```text
You turn a rambling voice transcript into discrete candidate items for a personal task system.

Rules:
- One item per distinct thing to do, remember, or think about. Don't merge unrelated things.
- Write titles as short imperatives ("Call the dentist to move the cleaning"), under 70 characters.
- Classify kind: task | project (needs several steps) | chore (recurs) | note (idea or info, no action).
- Suggest area from: {areas}. Suggest tier: hard if a real deadline is mentioned, chip if ongoing, back if vague or someday.
- Pull any dates, durations or people mentioned into fields; never invent them.
- If an item likely duplicates one in EXISTING, set duplicate_of to its id.
- Keep the speaker's own words in source_quote so he can recognize it.

EXISTING: {open_item_titles_with_ids}
TODAY: {date}
TRANSCRIPT: {transcript}

Return JSON: {"items":[{"title","kind","area","tier","deadline","est_minutes","duplicate_of","source_quote"}]}
```

**Clarify (one item → a plan)**

```text
You help a person who finds it hard to start vague tasks. Your job is to make this item concrete enough that the first step takes no thinking.

Item: {title}
Notes so far: {body}
Previous answers: {qa_pairs}

Step 1 - If key facts are missing, ask 3 to 6 questions. Prefer questions he can answer from memory in a few words. Include questions about what information or documents the task will need (account numbers, dates, contact names, what outcome he wants).
Step 2 - Draft a breakdown:
- next_action: one physical, visible step under 15 minutes.
- subtasks: ordered, each completable in one sitting, with est_minutes.
- have_ready: things to gather before a call or appointment.
- unknowns: answers he didn't know, each phrased as a small "find out" subtask.
- is_project: true if this needs more than 4 subtasks or spans weeks.
Don't pad. Fewer, clearer steps beat many.

Return JSON: {"questions":[...],"next_action","subtasks":[{"title","est_minutes","blocked_by_index"}],"have_ready":[...],"unknowns":[...],"is_project"}
```

*Example* (made up): "Renew passport". Questions: when does it expire, any trips booked, is the
old one at hand, has your name changed? Next action: "Find the old passport and check its expiry
date (5 min)". Have ready: old passport, a photo, a payment card, the trip dates.

### 5.7 Settings (⚙️)

Sections down the side, as in foodlab (the last one opened is remembered): **General**, Colors
(per device); **Areas** (below); **Experimental**, things being tried out: the header and app font pickers (Google Fonts, per
device; temporary, like foodlab's).

**Areas** are one list: Settings' `areas` in order, then any others found on items. Each row has
its name, how many top-level items use it, ↑ ↓ (saves the whole order, so the others join the
list) and ✕. **Rename** changes it on every item in it; renaming onto another area's name merges
the two (a stray "Ch" into Chores). **Delete** takes it off the list and off its items, which stay
with no area; Undo puts both back. An item's **Area** field is a picker, as foodlab's "Kind of":
typing filters, Enter or a tap picks, and a new area is made only by choosing **+ Add the area
"…"** (which also adds it to the list). Inbox's area menu offers the same list.

## 6. Chores and reminders (phase 2, planned)

### 6.1 Repeating items (built 2026-11-08)

Any task can repeat (`repeat` on the item, §4.1), in one of two ways, set on its page under
**Repeats**:

- **About every…** N days, weeks or months, counted from the last time it was done or skipped
  (chores). A missed week just means it's a bit staler; there's no due date to go red.
  - **Freshness** = days since last done ÷ the interval (a month counts as 30 days). Under 0.8
    it's fresh and stays out of the way, 0.8–1 due soon, from 1 due.
  - **Shown as** "↻ 18 days (usually 21)" with a small bar, which turns the accent color when
    it's nearly due. Never red, never "overdue". Never done (or not known) = due now.
- **On a schedule**: every N days, every N weeks on chosen weekdays ("every Friday" for
  laundry), or every N months on a day (31 = the last day). Counted from **Starting**, which also
  fixes which weeks or months count. Done counts for the latest due day; the next is the first
  after today, so missed ones don't pile up ("since Tue", then "next Fri").
- **No preferred day by default**: weekends stay free unless I choose otherwise. A day for
  something is just a schedule ("every Friday").
- **Done** (the checkbox) logs today and the item stays open for next time. **Skip this time**
  starts the clock again without counting as done. **Drop** stops it repeating. Undo puts it
  back. A repeating item's done steps open again when it's done, so a routine (a "Sunday reset")
  can be one item with a checklist.
- **Later** (snooze): Tomorrow, In 3 days or Next week. Off Today and out of All's picks until
  then, without counting as done or skipped (the clock keeps running); "later: back Wed" on its
  row; **Back now** on its page undoes it. Done or Skip clears it.
- **Last done** can be set by hand (it changes the latest log entry), so a new chore starts in
  the right place.
- **Where it shows**: Today's **Chores** group once due (§5.3); All with its ↻ fact; the All
  views offer it only when due. Not in Quick wins.
- **The Chores area asks "How often does this come around?"** on a top-level task with no
  repeat: Weekly, Every 2 weeks, Monthly, Every 3 months (all "about every…"), or "Doesn't
  repeat" (`oneOff`), which makes the question go away. A suggestion, never required. Later the
  clarify step (§5.6) could guess from the title.
- **Hard schedules stay exact.** Bills and medication use "on a schedule" (and, later,
  reminders, §6.2), not freshness.
- **Later, if wanted**: a tolerance per chore, a history view, and
  a separate cadence per step of a routine.

### 6.2 Notifications

Web Push from the installed PWA; the server decides when, the phone only receives.

- VAPID keys once; the service worker subscribes and posts to `/api/push/subscribe`; sent with
  the `web-push` package.
- A loop in the server checks every minute and records what it sent, so a restart doesn't
  send twice.
- **What notifies:** explicit reminders, hard deadlines (that morning, plus a lead time I set),
  preferred-day chores that are due, and maybe one morning summary. Nothing else by default.
- **In the notification:** Done and Snooze 1 h, handled without opening the app.
- Needs HTTPS (Cloudflare has it), the server always on, and Chrome exempt from battery
  optimization on the phone. If Web Push proves unreliable, send to a self-hosted ntfy topic
  instead (same scheduler, different sender).

## 7. Planning and calendar (phase 3, planned)

**"I have time this weekend."** In: a time window, optionally energy and where I am (home,
out). Candidates: open items with a next step, ranked by deadline pressure, how long a chip item
has gone untouched, chores near due, and quick wins that fit gaps. Out: 3–8 suggestions, each with
a one-line reason ("due Nov 3", "untouched 3 weeks", "20 min, fits after laundry"), the total
time and an order. Accepted ones get planned (`scheduled`) and, with sync, a calendar event.

**Google Calendar**, one calendar (the three leftover Todoist calendars go first). OAuth for one
user. Busy time feeds the planner; planned items become events tagged with the item id; moving
or deleting the event updates the item on the next sync.

## 8. Notes (phase 4, planned)

A Markdown editor with live preview (CodeMirror 6 or Milkdown), pasted images, PDFs as
attachments. Folders are real directories under `notes/`; tags in frontmatter. A note can turn
selected lines into tasks that stay linked to it. Full-text search with SQLite FTS5. Import from
Obsidian (copy the folder), OneNote and Evernote later. `notes/` and attachments sit beside the
database, and the nightly backup covers them.

## 9. Sync

foodlab's model: the app keeps the server's state in localStorage and an **outbox** of whole
records laid over it; every save is `PUT /api/<kind>/<id>` with the whole record, idempotent,
last write wins, sent in first-changed order (a parent before its new step). `GET /api/state`
returns everything with ETag = rev. A 4xx drops the record with a toast; network errors retry.
`X-Evenkeel-Build` tells an old installed app to offer ↻ Update. Deletions are tombstones.

## 10. Platform

A PWA. The costly parts (data, server logic, AI, sync, scheduling) live on the server and in
`shared`, so a platform change only touches the UI, and Capacitor could wrap it without a
rewrite.

What a PWA can't do on Android: home-screen widgets; capture from outside the app (no
quick-settings tile, lock-screen capture or voice assistant; the share sheet and long-press
shortcuts do work); offline reminders (every reminder is a push, so a down server or an offline
phone misses it); reliable background work (no location reminders, no recording with the
screen off); dependable badge counts.

Options, least to most effort: the **PWA** (now); **Capacitor** for Android (the same React app
in a native shell, an APK outside the Play Store: offline scheduled notifications, share intents,
background tasks; a widget or tile needs a little Kotlin); a Trusted Web Activity (gains almost
nothing; skip); React Native or Kotlin (only if it outgrows personal scope).

To keep Capacitor cheap: logic stays on the server or in `shared`, and every browser-specific
feature (notifications, recording, sharing, offline storage) goes through one `platform` module.
**Decision point:** after about a month of phase 2, wrap it if widgets or offline reminders are
missed (the same rule as foodlab).

## 11. Later, maybe

Shared AI module with sideshow and foodlab; Gmail read-only lookups; a weekly review.

**Open questions**

- Todoist import: everything, or only Back Burner and Reminders?
- Does sideshow's work inbox eventually merge here, or stay separate with a shared AI module?
- A morning push summary, or is that noise?
- Areas: keep the starting list, or let the AI propose from the first rambles?
