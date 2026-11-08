import type { AiSettings } from "./ai";

// The records Evenkeel stores (DESIGN.md §4). Client and server share these.
// Every record is saved whole (PUT /api/<kind>/<id>); `updatedAt` and `rev` are set by the server.

export type Id = string;

/** What every stored record has. */
export interface Base {
  id: Id;
  deleted: boolean;
  createdAt: number;
  updatedAt: number;
  rev: number;
}

/**
 * Where an item sits (DESIGN.md §4.2). Not a priority: three tiers I'll actually respect, plus
 * the inbox things land in before they're filed.
 */
export const TIERS = ["inbox", "hard", "chip", "back"] as const;
export type Tier = (typeof TIERS)[number];
export const TIER_LABEL: Record<Tier, string> = { inbox: "Inbox", hard: "Hard date", chip: "Chipping away", back: "Back burner" };
export const TIER_SHORT: Record<Tier, string> = { inbox: "Inbox", hard: "Hard", chip: "Chip", back: "Back" };
/** The tiers an item can be filed into (inbox is where it starts). */
export const FILED_TIERS = ["hard", "chip", "back"] as const satisfies readonly Tier[];

/** A task's state. An item with no status is a note: something set down, not something to do. */
export const STATUSES = ["open", "done", "skipped", "dropped"] as const;
export type Status = (typeof STATUSES)[number];
export const STATUS_LABEL: Record<Status, string> = { open: "Open", done: "Done", skipped: "Skipped", dropped: "Dropped" };

export const ENERGIES = ["low", "med", "high"] as const;
export type Energy = (typeof ENERGIES)[number];
export const ENERGY_LABEL: Record<Energy, string> = { low: "Low", med: "Medium", high: "High" };

/**
 * Everything is an item (DESIGN.md §4.1): a task is an item with a status, a project is an item
 * with children, a note is an item with a body and no status. One can become another without moving.
 */
export interface Item extends Base {
  /** The item this is a step of; null at the top. */
  parentId: Id | null;
  /** Order among its siblings (lower first); new ones go last. */
  position: number;
  title: string;
  /** Markdown. */
  body: string;
  /** null = a note. */
  status: Status | null;
  tier: Tier;
  /** A free label: home, health, money… "" = none. */
  area: string;
  /** A real consequence date, YYYY-MM-DD. */
  deadline: string | null;
  /** The day I plan to do it, YYYY-MM-DD. */
  scheduled: string | null;
  estMinutes: number | null;
  energy: Energy | null;
  /** The one concrete next step, small enough to do without thinking. */
  nextAction: string;
  /** Items this waits on. */
  blockedBy: Id[];
  /** When it was last marked done, skipped or dropped. */
  doneAt: number | null;
  /** How it comes back (DESIGN.md §6.1); null = it doesn't. */
  repeat: Repeat | null;
  /** A repeating item's done and skipped days, oldest first (the last 100). */
  log: LogEntry[];
  /** Said "doesn't repeat" to the Chores area's "How often?". */
  oneOff: boolean;
  /** Later: kept off Today (and out of All's picks) until this day, YYYY-MM-DD. */
  snoozedUntil: string | null;
}

export const REPEAT_KINDS = ["about", "on"] as const;
export const REPEAT_UNITS = ["day", "week", "month"] as const;
export type RepeatUnit = (typeof REPEAT_UNITS)[number];

/**
 * A repeating item (DESIGN.md §6.1). "about": every so often, counted from when it was last done
 * (a chore: missing a day just makes it a bit staler). "on": on a calendar schedule, counted from
 * `start` (every Friday, the 1st of every month).
 */
export interface Repeat {
  kind: (typeof REPEAT_KINDS)[number];
  every: number;
  unit: RepeatUnit;
  /** "on" by the week: the weekdays (0 = Sunday). By the month: the day of the month (one; 31 = the last). */
  days: number[];
  /** "on": the first day it's due (YYYY-MM-DD); also fixes which weeks or months count. */
  start: string;
}

export interface LogEntry {
  day: string;
  did: "done" | "skipped";
}

/** A file attached to a dev note: a screenshot or anything else (as in foodlab). */
export interface Attachment {
  id: Id;
  name: string;
  type: string;
}
export const fileUrl = (id: Id, name = "") => `/api/files/${id}${name ? `/${encodeURIComponent(name)}` : ""}`;

export interface DevNote extends Base {
  text: string;
  /** The page it was written on, or "" if it wasn't linked to one. */
  path: string;
  done: boolean;
  files: Attachment[];
}

export const SETTINGS_ID = "app";

/** App-wide settings: one record, id "app". Per-device choices (colors) stay in localStorage. */
export interface Settings extends Base {
  /** The areas offered when filing, in this order. Items can still use others. */
  areas: string[];
  /** AI models, monthly cap and alerts (DESIGN.md §5.6); null = the defaults. */
  ai: AiSettings | null;
}

export const DEFAULT_AREAS = ["Home", "Health", "Money", "Admin", "Chores", "Projects"];

export type Records = { items: Item; devnotes: DevNote; settings: Settings };
export type Kind = keyof Records;
export const KINDS: Kind[] = ["items", "devnotes", "settings"];
export type AnyRecord = Records[Kind];

/** Everything, keyed by id per kind. Deleted records are included (tombstones). */
export type State = { [K in Kind]: Record<Id, Records[K]> } & { rev: number };

export const emptyState = (): State => ({ rev: 0, items: {}, devnotes: {}, settings: {} });

const baseOf = (id: Id, now = Date.now()): Base => ({ id, deleted: false, createdAt: now, updatedAt: now, rev: 0 });

/** New records with every field at its default. */
export const blank = {
  item: (id: Id, title: string, now = Date.now()): Item => ({
    ...baseOf(id, now),
    parentId: null,
    position: now,
    title,
    body: "",
    status: "open",
    tier: "inbox",
    area: "",
    deadline: null,
    scheduled: null,
    estMinutes: null,
    energy: null,
    nextAction: "",
    blockedBy: [],
    doneAt: null,
    repeat: null,
    log: [],
    oneOff: false,
    snoozedUntil: null,
  }),
  devnote: (id: Id, text: string, path: string, now = Date.now()): DevNote => ({ ...baseOf(id, now), text, path, done: false, files: [] }),
  settings: (now = Date.now()): Settings => ({ ...baseOf(SETTINGS_ID, now), areas: [...DEFAULT_AREAS], ai: null }),
};

export const settingsOf = (state: State): Settings => state.settings[SETTINGS_ID] ?? blank.settings(0);

/** A record's name, for messages ("Couldn't save “…”"). */
export const nameOf = (r: AnyRecord): string => ("title" in r ? r.title : "text" in r ? r.text.slice(0, 40) : r.id);

// ---- dates (local, YYYY-MM-DD) ----

const pad = (n: number) => String(n).padStart(2, "0");

export function today(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The date `n` days after `day` (negative for before). */
export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return today(new Date(y, m - 1, d + n));
}

/** Whole days from `a` to `b` (b − a). */
export function daysBetween(a: string, b: string): number {
  const t = (s: string) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((t(b) - t(a)) / 86_400_000);
}

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A date as people say it, relative to `now`: Today, Tomorrow, Fri, Nov 21, Mar 3 2027. */
export function dayLabel(day: string, now = today()): string {
  const n = daysBetween(now, day);
  if (n === 0) return "Today";
  if (n === 1) return "Tomorrow";
  if (n === -1) return "Yesterday";
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const date = new Date(y, m - 1, d);
  if (n > 1 && n < 7) return WEEKDAY[date.getDay()]!;
  const md = `${MONTH[m - 1]} ${d}`;
  return y === Number(now.slice(0, 4)) ? md : `${md} ${y}`;
}

/** Minutes as a short duration: 20 min, 1 h, 1 h 30. */
export function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h} h ${r}` : `${h} h`;
}
