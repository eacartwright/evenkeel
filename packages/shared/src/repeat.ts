import { addDays, dayLabel, daysBetween, today, type Item, type LogEntry, type Repeat, type RepeatUnit } from "./types";

// Repeating items (DESIGN.md §6.1). Two kinds:
// - "about": every so often, counted from the last time it was done or skipped. Fresh until most
//   of the interval has passed, then due; never "overdue", just staler.
// - "on": a calendar schedule from `start` (every Friday, the 1st of every month). Done counts for
//   the latest due day; the next one is the first after today, so missed ones don't pile up.

const UNIT_DAYS: Record<RepeatUnit, number> = { day: 1, week: 7, month: 30 };
const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const parts = (day: string) => day.split("-").map(Number) as [number, number, number];
export const weekday = (day: string) => {
  const [y, m, d] = parts(day);
  return new Date(y, m - 1, d).getDay();
};
const lastOfMonth = (y: number, m: number) => new Date(y, m, 0).getDate();

/** About how many days "every N units" is. */
export const intervalDays = (r: Pick<Repeat, "every" | "unit">) => r.every * UNIT_DAYS[r.unit];

/** The last day it was done or skipped, or null if never (or not known). */
export const lastDone = (i: Pick<Item, "log">): string | null => i.log.at(-1)?.day ?? null;

/** Does an "on" schedule fall on this day? */
export function occurs(r: Repeat, day: string): boolean {
  if (day < r.start) return false;
  if (r.unit === "day") return daysBetween(r.start, day) % r.every === 0;
  if (r.unit === "week") {
    const days = r.days.length ? r.days : [weekday(r.start)];
    if (!days.includes(weekday(day))) return false;
    const sunday = (d: string) => addDays(d, -weekday(d));
    return Math.floor(daysBetween(sunday(r.start), sunday(day)) / 7) % r.every === 0;
  }
  const [sy, sm, sd] = parts(r.start);
  const [y, m, d] = parts(day);
  if ((y * 12 + m - (sy * 12 + sm)) % r.every !== 0) return false;
  return d === Math.min(r.days[0] ?? sd, lastOfMonth(y, m));
}

/** The first day an "on" schedule is due after `after` (or from its start, if never done). */
export function nextOn(r: Repeat, after: string | null): string | null {
  let day = after && after >= r.start ? addDays(after, 1) : r.start;
  for (let n = 0; n < 4000; n++, day = addDays(day, 1)) if (occurs(r, day)) return day;
  return null;
}

export interface RepeatState {
  /** Shows on Today. */
  due: boolean;
  /** "about": most of the interval has passed. */
  soon: boolean;
  /** "about": how much of the interval has passed (1 = all of it), for the bar; null if never done. */
  ratio: number | null;
  /** "on": the day it's (next) due. */
  next: string | null;
  /** How it stands, in words: "18 days (usually 21)", "next Fri", "since Tue". */
  label: string;
}

/** Where a repeating item stands today. */
export function repeatState(i: Pick<Item, "repeat" | "log">, now = today()): RepeatState | null {
  const r = i.repeat;
  if (!r) return null;
  const last = lastDone(i);
  if (r.kind === "about") {
    if (!last) return { due: true, soon: true, ratio: null, next: null, label: "not done yet" };
    const days = Math.max(0, daysBetween(last, now));
    const ratio = days / intervalDays(r);
    const ago = days === 0 ? "done today" : `${days} day${days === 1 ? "" : "s"}`;
    return { due: ratio >= 1, soon: ratio >= 0.8, ratio, next: null, label: `${ago} (usually ${intervalDays(r)})` };
  }
  const next = nextOn(r, last);
  if (!next) return { due: false, soon: false, ratio: null, next: null, label: "no more days" };
  const due = next <= now;
  const label = next === now ? "due today" : due ? `since ${dayLabel(next, now)}` : `next ${dayLabel(next, now)}`;
  return { due, soon: due, ratio: null, next, label };
}

const ordinal = (n: number) => (n >= 31 ? "last day" : `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`);

/** The rule in words: "About every 3 weeks", "Every Friday", "Every 2 months on the 1st". */
export function repeatLabel(r: Repeat): string {
  const unit = r.every === 1 ? r.unit : `${r.every} ${r.unit}s`;
  if (r.kind === "about") return r.every === 1 ? `About every ${r.unit}` : `About every ${unit}`;
  if (r.unit === "day") return r.every === 1 ? "Every day" : `Every ${unit}`;
  if (r.unit === "week") {
    const days = (r.days.length ? r.days : [weekday(r.start)]).slice().sort();
    const names = days.length === 1 ? WEEKDAY_LONG[days[0]!]! : days.map((d) => WEEKDAY_SHORT[d]).join(", ");
    return r.every === 1 ? `Every ${names}` : `Every ${r.every} weeks on ${names}`;
  }
  const day = ordinal(r.days[0] ?? parts(r.start)[2]);
  return r.every === 1 ? `Every month on the ${day}` : `Every ${unit} on the ${day}`;
}

/** The item's log with `did` added for `day` (kept in order, the last 100). */
export function logged(i: Item, did: LogEntry["did"], day = today()): LogEntry[] {
  return [...i.log, { day, did }].sort((a, b) => a.day.localeCompare(b.day)).slice(-100);
}

/** A new repeat rule with sensible defaults for its kind and unit. */
export function newRepeat(kind: Repeat["kind"], every: number, unit: RepeatUnit, now = today()): Repeat {
  return { kind, every, unit, days: kind === "on" && unit === "week" ? [weekday(now)] : kind === "on" && unit === "month" ? [parts(now)[2]] : [], start: now };
}
