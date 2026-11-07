# Evenkeel — design

The spec lives here; the code points at its sections (`DESIGN.md §5.3`). The longer planning
doc (*Personal Task & Notes System — Spec*, a Claude Doc) has the background, the AI prompts and
the name list; this file is what's built and decided. Update it when a decision changes.

## 1. Purpose

A single-user, self-hosted app that replaces Todoist first, then takes in notes and calendar.
**North star: relief, not productivity.** The goal isn't to finish everything; it's to put things
down and stop carrying them. Three promises, and a test for every feature:

1. **Nothing gets lost.** Capture is so cheap that holding something in my head is never easier.
2. **Nothing stays foggy.** Vague things become a first step that takes no thinking.
3. **Nothing nags.** Things come back at the right moment, never with scolding. Missed plans
   shift; nothing turns red; counts are information, not alarms.

Does it help nothing get lost, nothing stay foggy, or nothing nag? If not, it's feature creep.
Built for one person: no teams, sharing or invites.

## 2. Stack

The same as foodlab and sideshow, so anything learned there applies: an npm workspace with
`shared` (types, validation, derived views, pure), `server` (Node + Hono + `node:sqlite`) and
`web` (React + Vite, an installable PWA with a share target). Hosted on the mini PC beside them,
port 8083, `https://evenkeel.evans.tools` behind Cloudflare Access (docs/runbook.md).

## 3. Phases

1. **Capture and clarify.** Items, inbox, typed capture, Today, All, item pages, PWA install
   (**built 2026-11-07**); then voice rambles with AI extraction and the clarify interview (next).
2. **Chores and reminders.** Cadences with freshness instead of overdue, Web Push, Todoist import.
3. **Planning and calendar.** "I have time this weekend", estimates, one Google Calendar.
4. **Notes.** Markdown view, attachments, folders/tags, notes as `.md` files, Obsidian import.

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

Skip is "didn't do it this time, and that's fine" (for chores, phase 2); Drop is "not doing it".
A step takes its parent's tier when added. Deleting an item deletes its steps; Undo restores both.

### 4.2 Tiers, not priorities

No priority flags. Three tiers I'll actually respect, and the inbox before them:

- **Hard date**: has a real deadline (sorted soonest first in All).
- **Chipping away**: worked at over time.
- **Back burner**: someday.

### 4.3 Settings and dev notes

`settings` has one record, `app`: the areas list. Colors are per device (localStorage).
Dev notes (🧪, as in foodlab) are notes about the app itself, with the page they were written on,
mirrored to `data/dev-notes.md` for the next build session.

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
  not waiting on anything; untouched longest first.

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

### 5.5 Item (`/items/<id>`)

Title with its box; the **Next step** box up top (the clarify interview will fill it); Kind
(Task/Note), Where (tier), Area, Deadline, Planned for (+ Today), Takes (min), Energy, Waits on;
Notes; Steps (add with Enter, reorder ↑↓, tick off); Skip · Drop · Delete. Everything saves as
you go (`DraftInput` on Enter or leaving the box, as in foodlab).

### 5.6 Next: AI (phase 1, part 2)

Reuses foodlab's AI module (Claude and GPT, cost in `ai_usage`, monthly cap). Both write
**proposals**, never items: nothing is committed without a tap.

- **Ramble**: hold the mic, record; the server transcribes (OpenAI, the key foodlab has);
  the model extracts candidate items (title, kind, area, tier, dates, duplicate-of, the quote);
  the inbox shows them to keep, edit or discard.
- **Clarify**: on any item, 3–6 questions, then a next step, steps with estimates, a "have
  ready" list, and unknowns as "find out" steps.

The prompts are in the planning doc.

### 5.7 Settings (⚙️)

Colors (per device); Areas, one per line. Things in an area keep it if it's taken off the list.

## 9. Sync

foodlab's model: the app keeps the server's state in localStorage and an **outbox** of whole
records laid over it; every save is `PUT /api/<kind>/<id>` with the whole record, idempotent,
last write wins, sent in first-changed order (a parent before its new step). `GET /api/state`
returns everything with ETag = rev. A 4xx drops the record with a toast; network errors retry.
`X-Evenkeel-Build` tells an old installed app to offer ↻ Update. Deletions are tombstones.

## 10. Later, maybe

Shared AI module with sideshow and foodlab; Gmail read-only lookups; a weekly review; a
Capacitor shell for Android if widgets or offline reminders are missed (planning doc,
"Platform strategy").
