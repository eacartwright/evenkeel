# evenkeel — notes for Claude

Evan's place to set things down: capture, file, break down and plan tasks, and (later) notes and
calendar, on desktop and his Android phone. North star: relief, not productivity; nothing gets
lost, nothing stays foggy, nothing nags. **[DESIGN.md](DESIGN.md) is the spec**; read the relevant
section before changing behavior, and update it when a decision changes. Same stack and
conventions as foodlab (`C:\Dev\foodlab`) and sideshow (`C:\Dev\sideshow`); when in doubt, do it
the way foodlab does (much of this was copied from it).

## Run / test

```sh
npm install
npm run dev        # server :8789 + web :5175 (proxies /api); the phone uses the LAN "Network" URL
npm test           # vitest: capture parsing, dates, validation, derived views (shared), the store (server)
npm run typecheck  # tsc (TypeScript 7) over all three packages
```

Data is `data/evenkeel.db` (SQLite, git-ignored, per machine). Test against a scratch DB:
`EVENKEEL_DB=<scratch>/t.db PORT=7799 node --import tsx packages/server/src/index.ts` after
`npm run build` (the server then serves the app too). Browser checks: `playwright-core` with
`channel: "msedge"` on NOSTROMO, headless, in a scratch folder.

## Architecture

- `packages/shared` — `types.ts` (`Item`, `DevNote`, `Settings`, tiers, `blank.*`, dates:
  `today`, `addDays`, `dayLabel`, `minutesLabel`), `validate.ts` (body → clean record, run by the
  server on every save), `capture.ts` (`captureLines`: lines → items, indent = step;
  `fromShared`), `derive.ts` (`View`: children / ancestors / `wouldLoop`, `progress`, `inbox`,
  `today`, `all`, `areas`, `blocked`), `repeat.ts` (repeating items: `repeatState`, `nextOn`,
  `repeatLabel`, `logged`, `newRepeat`; DESIGN.md §6.1). Pure; tests in `shared.test.ts`.
- `packages/server` — Node + Hono + `node:sqlite` (Node ≥ 22.13). `db.ts`: tables `items`,
  `dev_notes`, `settings` (one row, `app`), `meta.rev`; `loadState` / `save.<kind>`. `store.ts`:
  the state in memory; `put(kind, id, body)` validates, checks parents (exist, no loops) and
  `blockedBy`, bumps `rev`. `index.ts`: `GET /api/state` (ETag = rev), `PUT /api/<kind>/<id>`,
  `/api/health`, `GET|POST /api/files` (dev note attachments), the built app with SPA fallback.
  `files.ts`: `data/files` + table `files` (foodlab's). `backup.ts`: daily `VACUUM INTO`, 30
  kept, files copied once. `devNotesFile.ts`: `data/dev-notes.md`.
- `packages/web` — React + Vite PWA, share target `/share`. `sync.ts` is foodlab's (localStorage
  state + outbox of whole records). `actions.ts`: every change builds on the **latest** record
  (`data().state`), never the one from the last render. `components/`: `CapturePage`,
  `InboxPage`, `TodayPage`, `AllPage`, `ItemPage`, `ItemRow` (`Check`, `Facts`), `QuickAdd`,
  `Settings` (sections: General, Areas, Experimental), `DevNotes` (foodlab's: edit, files, page
  link, Copy), `controls.tsx` (foodlab's `DraftInput`, `TitleInput`, `NumberInput`,
  `DraftTextarea`, `Segmented`, `Field`). `uploads.ts`, `fonts.ts` + `fonts-sans.ts` (the
  temporary font tester) are foodlab's. **Before building something foodlab or sideshow already
  has, port theirs** rather than writing a smaller version.

Schema changes: **append** a migration to `MIGRATIONS` in `server/src/db.ts`; never edit one
that has been committed, even if it seems unreleased (a dev DB on another machine may have run it,
and a database never runs the same migration twice). An extra migration costs nothing. Deletions are tombstones (`deleted`), restorable with Undo or the page's Restore.

## UI conventions (same as foodlab)

- All colors are tokens in `web/src/styles.css` (light + dark), keyed on `html[data-theme]`.
  Evenkeel's accent is blue (`--primary`). `styles.css` is foodlab's general sections plus an
  "evenkeel" section at the end.
- Nothing red that isn't an error or Delete: missed plans are "still on deck", counts are calm.
- A placeholder is never a box's name; every box has a label or `aria-label`.
- The phone's Back closes the drawer, Quick add and Settings.

## Gotchas (from foodlab and sideshow)

- `tsx watch` hangs under `concurrently` on Windows; the server uses `node --watch --import tsx`.
- `listen EACCES` on a free port = Windows NAT reserved it (8577–8976 on NOSTROMO). Reserve 8789
  and 5175 the way 8787 / 8788 were; don't just pick another port.
- Android install needs the manifest and icons reachable without the Access login (runbook),
  or there's no share target.
- `crypto.randomUUID` needs a secure context; use `newId()` from shared.

## Working with Evan

- Commit and push only when asked.
- Deploys with the **Update Evenkeel** shortcut on ripley's desktop (it runs `scripts\update.ps1`);
  point him to that, not the script.
- **"Dev notes" means the live ones** on the mini PC (ripley), never this machine's dev DB:
  read `\\ripley\C\Apps\evenkeel\data\dev-notes.md` (`Z:\Apps\evenkeel\...` on the laptop). Read
  only; never open the live `.db` over the share.
- Prefers the Claude desktop app / claude.ai over the terminal; give GUI steps where possible.
- Develops on NOSTROMO (desktop) and HPBROBOOK (laptop), `C:\Dev\evenkeel`. Phone: Android
  (Pixel 8a). The mini PC will host the real app at `C:\Apps\evenkeel`, port 8083.

## Status

- 2026-11-07: **Phase 1, part 1 built** in a cloud session (DESIGN.md §3, §5.1–5.5): capture with
  indented steps, inbox filing, Today, All, item pages with steps and waits-on, Quick add, share
  target, settings (areas), dev notes. 24 tests, typecheck, build, and a headless walkthrough
  (capture → file → plan → Today/All, search into steps, Quick add, offline add then sync,
  share, phone layout in dark, Back closing the drawer). Not yet run on NOSTROMO or deployed.
- 2026-11-07: Master inventory loaded into the HPBROBOOK dev DB (111 items). All now has four views
  on trial (Three, Areas, Board, List; DESIGN.md §5.4); Evan is trying them to see what works.
- 2026-11-08, Evan's dev notes: Dev Notes and Settings brought up to foodlab's (edit, attach or
  paste files, link to the page or not, Copy; Settings sections with Experimental → fonts).
  Migration 2: `files` table + `dev_notes.files`. 30 tests; headless check on a copy of the
  laptop DB.
- 2026-11-08: **Repeating items built** (DESIGN.md §6.1, Evan's choices): "about every…"
  (freshness) and "on a schedule" (e.g. every Friday); no preferred day by default (weekends
  free); due ones in their own **Chores** group on Today; the Chores area asks "How often?".
  **Later** (snooze: Tomorrow, In 3 days, Next week). Migration 3: `items.repeat`, `log`,
  `one_off`, `snoozed_until`. 37 tests; headless check on a copy of the laptop DB. Not yet: push
  reminders (§6.2; Web Push works for the installed app on Android, no native app needed).
- 2026-11-08, from Evan's first use on ripley: an item's Area is foodlab's `Picker` (in
  `controls.tsx`; new only via "+ Add", after a typed "Ch" became an area); Settings → Areas
  renames (items follow, merging onto an existing name), reorders and deletes areas (Undo).
  Later is full size on an item's page.
- **Next:** settle the views from use; run it on NOSTROMO; then ramble capture and the clarify interview (DESIGN.md §5.6),
  reusing foodlab's `ai.ts`.
