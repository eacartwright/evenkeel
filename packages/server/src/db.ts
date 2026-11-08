import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { emptyState, type Attachment, type DevNote, type Id, type Item, type Settings, type State } from "@evenkeel/shared";

// SQLite persistence: ordinary tables, one row per record, so the file reads well in any SQLite
// browser. Schema changes go in MIGRATIONS, appended, never edited (as in foodlab and sideshow).

const BASE = `
    deleted INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    rev INTEGER NOT NULL`;

const MIGRATIONS: string[] = [
  // 2026-11-07: phase 1 (DESIGN.md §4): items, dev notes, settings.
  `
  CREATE TABLE items (
    id TEXT PRIMARY KEY,
    parent_id TEXT,                         -- a step of
    position REAL NOT NULL,                 -- order among its siblings
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',          -- Markdown
    status TEXT,                            -- open · done · skipped · dropped; NULL = a note
    tier TEXT NOT NULL DEFAULT 'inbox',     -- inbox · hard · chip · back
    area TEXT NOT NULL DEFAULT '',
    deadline TEXT,                          -- YYYY-MM-DD
    scheduled TEXT,                         -- YYYY-MM-DD
    est_minutes INTEGER,
    energy TEXT,                            -- low · med · high
    next_action TEXT NOT NULL DEFAULT '',
    blocked_by TEXT NOT NULL DEFAULT '[]',  -- JSON [id]
    done_at INTEGER,${BASE}
  );
  CREATE INDEX items_parent ON items(parent_id);
  CREATE TABLE dev_notes (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    path TEXT NOT NULL DEFAULT '',          -- the page it was written on
    done INTEGER NOT NULL DEFAULT 0,${BASE}
  );
  CREATE TABLE settings (
    id TEXT PRIMARY KEY,
    areas TEXT NOT NULL DEFAULT '[]',       -- JSON [name]${BASE}
  );
  CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO meta (key, value) VALUES ('rev', '1');
  INSERT INTO settings (id, areas, created_at, updated_at, rev)
    VALUES ('app', '["Home","Health","Money","Admin","Chores","Projects"]', 0, 0, 1);
  `,
  // 2026-11-08: files on dev notes (as in foodlab); the files themselves are in data/files under
  // their ids (files.ts).
  `
  CREATE TABLE files (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    size INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  ALTER TABLE dev_notes ADD COLUMN files TEXT NOT NULL DEFAULT '[]';  -- JSON [{ id, name, type }]
  `,
  // 2026-11-08: repeating items (DESIGN.md §6.1). The rule, the done/skipped days, "doesn't
  // repeat" (an answer to the Chores area's "How often?"), and Later (snoozed until a day).
  `
  ALTER TABLE items ADD COLUMN repeat TEXT;                          -- JSON { kind, every, unit, days, start }
  ALTER TABLE items ADD COLUMN log TEXT NOT NULL DEFAULT '[]';       -- JSON [{ day, did }]
  ALTER TABLE items ADD COLUMN one_off INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE items ADD COLUMN snoozed_until TEXT;                   -- YYYY-MM-DD
  `,
  // 2026-11-08: AI (DESIGN.md §5.6): its settings on the settings record, and every call with
  // its estimated cost (foodlab's ai_usage; server-only, not synced).
  `
  ALTER TABLE settings ADD COLUMN ai TEXT;                            -- JSON { model, fastModel, monthlyLimitUsd, alertsAt }
  CREATE TABLE ai_usage (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at INTEGER NOT NULL,
    month TEXT NOT NULL,                    -- YYYY-MM, local
    model TEXT NOT NULL,
    purpose TEXT NOT NULL,                  -- ramble · clarify · transcribe
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cache_read_tokens INTEGER NOT NULL,
    cost_usd REAL NOT NULL,
    ok INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX ai_usage_month ON ai_usage(month);
  `,
];

export type DB = DatabaseSync;

/** Open (creating if needed) and bring the schema up to date. */
export function openDb(file: string, upTo = MIGRATIONS.length): DB {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  const { user_version: version } = db.prepare("PRAGMA user_version").get() as { user_version: number };
  if (version > 0 && version < upTo) {
    // Keep a copy from before the schema changes, so a bad migration can be undone.
    const copy = `${file}.before-v${version + 1}.db`;
    if (!existsSync(copy)) db.exec(`VACUUM INTO '${copy.replaceAll("'", "''")}'`);
  }
  for (let v = version; v < upTo; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]!);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

/** Run `fn` in a write transaction; rolls back if it throws. */
export function transaction<T>(db: DB, fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function getRev(db: DB): number {
  const row = db.prepare("SELECT value FROM meta WHERE key = 'rev'").get() as { value: string } | undefined;
  return row ? Number(row.value) : 0;
}
export function setRev(db: DB, rev: number) {
  db.prepare("INSERT INTO meta (key, value) VALUES ('rev', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(rev));
}

type Row = Record<string, any>;
const base = (r: Row) => ({ id: r.id as Id, deleted: !!r.deleted, createdAt: r.created_at as number, updatedAt: r.updated_at as number, rev: r.rev as number });

export function loadState(db: DB): State {
  const s = emptyState();
  s.rev = getRev(db);
  for (const r of db.prepare("SELECT * FROM items").all() as Row[]) {
    s.items[r.id] = {
      ...base(r),
      parentId: r.parent_id,
      position: r.position,
      title: r.title,
      body: r.body,
      status: r.status,
      tier: r.tier,
      area: r.area,
      deadline: r.deadline,
      scheduled: r.scheduled,
      estMinutes: r.est_minutes,
      energy: r.energy,
      nextAction: r.next_action,
      blockedBy: JSON.parse(r.blocked_by),
      doneAt: r.done_at,
      repeat: r.repeat ? JSON.parse(r.repeat) : null,
      log: JSON.parse(r.log),
      oneOff: !!r.one_off,
      snoozedUntil: r.snoozed_until,
    } satisfies Item;
  }
  for (const r of db.prepare("SELECT * FROM dev_notes").all() as Row[]) {
    s.devnotes[r.id] = { ...base(r), text: r.text, path: r.path, done: !!r.done, files: JSON.parse(r.files) as Attachment[] } satisfies DevNote;
  }
  for (const r of db.prepare("SELECT * FROM settings").all() as Row[]) {
    s.settings[r.id] = { ...base(r), areas: JSON.parse(r.areas), ai: r.ai ? JSON.parse(r.ai) : null } satisfies Settings;
  }
  return s;
}

const baseCols = (x: { id: Id; deleted: boolean; createdAt: number; updatedAt: number; rev: number }) => ({
  id: x.id,
  deleted: x.deleted ? 1 : 0,
  created_at: x.createdAt,
  updated_at: x.updatedAt,
  rev: x.rev,
});

function upsert(db: DB, table: string, cols: Record<string, unknown>) {
  const names = Object.keys(cols);
  db.prepare(`INSERT OR REPLACE INTO ${table} (${names.join(", ")}) VALUES (${names.map((n) => `@${n}`).join(", ")})`).run(
    cols as Record<string, any>,
  );
}

export const save = {
  items(db: DB, x: Item) {
    upsert(db, "items", {
      ...baseCols(x),
      parent_id: x.parentId,
      position: x.position,
      title: x.title,
      body: x.body,
      status: x.status,
      tier: x.tier,
      area: x.area,
      deadline: x.deadline,
      scheduled: x.scheduled,
      est_minutes: x.estMinutes,
      energy: x.energy,
      next_action: x.nextAction,
      blocked_by: JSON.stringify(x.blockedBy),
      done_at: x.doneAt,
      repeat: x.repeat ? JSON.stringify(x.repeat) : null,
      log: JSON.stringify(x.log),
      one_off: x.oneOff ? 1 : 0,
      snoozed_until: x.snoozedUntil,
    });
  },
  devnotes(db: DB, x: DevNote) {
    upsert(db, "dev_notes", { ...baseCols(x), text: x.text, path: x.path, done: x.done ? 1 : 0, files: JSON.stringify(x.files) });
  },
  settings(db: DB, x: Settings) {
    upsert(db, "settings", { ...baseCols(x), areas: JSON.stringify(x.areas), ai: x.ai ? JSON.stringify(x.ai) : null });
  },
};
