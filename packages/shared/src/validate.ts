import { ENERGIES, SETTINGS_ID, STATUSES, TIERS, type DevNote, type Item, type Kind, type Records, type Settings } from "./types";

// Turns a request body into a clean record, or says what's wrong. The server runs these on
// every save; links to other records are checked separately (server/store.ts), since that needs state.

export class Invalid extends Error {}

type In = Record<string, unknown>;

const obj = (x: unknown): In => {
  if (!x || typeof x !== "object" || Array.isArray(x)) throw new Invalid("Expected an object");
  return x as In;
};
const str = (x: unknown, field: string, max = 100_000): string => {
  if (x === undefined || x === null) return "";
  if (typeof x !== "string") throw new Invalid(`${field}: expected text`);
  if (x.length > max) throw new Invalid(`${field}: too long`);
  return x;
};
const required = (x: unknown, field: string, max = 500): string => {
  const s = str(x, field, max).trim();
  if (!s) throw new Invalid(`${field}: required`);
  return s;
};
const id = (x: unknown, field: string): string | null => {
  if (x === undefined || x === null || x === "") return null;
  if (typeof x !== "string" || x.length > 64) throw new Invalid(`${field}: expected an id`);
  return x;
};
const ids = (x: unknown, field: string): string[] => {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x)) throw new Invalid(`${field}: expected a list`);
  return [...new Set(x.map((v) => id(v, field)).filter((v): v is string => !!v))];
};
const oneOf = <T extends string>(x: unknown, options: readonly T[], field: string, fallback: T | null = null): T | null => {
  if (x === undefined || x === null || x === "") return fallback;
  if (typeof x !== "string" || !options.includes(x as T)) throw new Invalid(`${field}: expected one of ${options.join(", ")}`);
  return x as T;
};
const num = (x: unknown, field: string, min = 0, max = 1e15): number | null => {
  if (x === undefined || x === null || x === "") return null;
  if (typeof x !== "number" || !Number.isFinite(x) || x < min || x > max) throw new Invalid(`${field}: expected a number`);
  return x;
};
const bool = (x: unknown) => x === true;
/** YYYY-MM-DD, a real date, or null. */
const date = (x: unknown, field: string): string | null => {
  if (x === undefined || x === null || x === "") return null;
  if (typeof x !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(x)) throw new Invalid(`${field}: expected a date (YYYY-MM-DD)`);
  const [y, m, d] = x.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d) throw new Invalid(`${field}: not a real date`);
  return x;
};
const base = (b: In, recId: string, now: number) => ({
  id: recId,
  deleted: bool(b.deleted),
  createdAt: num(b.createdAt, "createdAt") ?? now,
  updatedAt: now,
  rev: 0,
});

function item(body: unknown, recId: string, now: number): Item {
  const b = obj(body);
  const parentId = id(b.parentId, "parentId");
  if (parentId === recId) throw new Invalid("An item can't be its own step");
  const status = oneOf(b.status, STATUSES, "status");
  const estMinutes = num(b.estMinutes, "estMinutes", 0, 60 * 24 * 30);
  return {
    ...base(b, recId, now),
    parentId,
    position: num(b.position, "position", -1e15) ?? now,
    title: required(b.title, "title"),
    body: str(b.body, "body"),
    status,
    tier: oneOf(b.tier, TIERS, "tier", "inbox")!,
    area: str(b.area, "area", 60).trim(),
    deadline: date(b.deadline, "deadline"),
    scheduled: date(b.scheduled, "scheduled"),
    estMinutes: estMinutes === null ? null : Math.round(estMinutes),
    energy: oneOf(b.energy, ENERGIES, "energy"),
    nextAction: str(b.nextAction, "nextAction", 500).trim(),
    blockedBy: ids(b.blockedBy, "blockedBy").filter((x) => x !== recId),
    // Only a finished task has a finish time.
    doneAt: status && status !== "open" ? (num(b.doneAt, "doneAt") ?? now) : null,
  };
}

function devnote(body: unknown, recId: string, now: number): DevNote {
  const b = obj(body);
  return { ...base(b, recId, now), text: required(b.text, "text", 20_000), path: str(b.path, "path", 500), done: bool(b.done) };
}

function settings(body: unknown, recId: string, now: number): Settings {
  if (recId !== SETTINGS_ID) throw new Invalid(`Settings has one record, "${SETTINGS_ID}"`);
  const b = obj(body);
  if (b.areas !== undefined && !Array.isArray(b.areas)) throw new Invalid("areas: expected a list");
  const areas: string[] = [];
  for (const a of (b.areas as unknown[] | undefined) ?? []) {
    const s = str(a, "areas", 60).trim();
    if (s && !areas.some((x) => x.toLowerCase() === s.toLowerCase())) areas.push(s);
  }
  return { ...base(b, recId, now), deleted: false, areas };
}

export const validators: { [K in Kind]: (body: unknown, id: string, now: number) => Records[K] } = {
  items: item,
  devnotes: devnote,
  settings,
};
