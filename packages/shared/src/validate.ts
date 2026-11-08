import { DEFAULT_AI, modelInfo, type AiSettings } from "./ai";
import { ENERGIES, REPEAT_KINDS, REPEAT_UNITS, SETTINGS_ID, STATUSES, TIERS, type Attachment, type DevNote, type Item, type Kind, type LogEntry, type Records, type Repeat, type Settings } from "./types";

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
    repeat: repeat(b.repeat),
    log: log(b.log),
    oneOff: bool(b.oneOff),
    snoozedUntil: date(b.snoozedUntil, "snoozedUntil"),
  };
}

function repeat(x: unknown): Repeat | null {
  if (x === undefined || x === null) return null;
  const b = obj(x);
  const kind = oneOf(b.kind, REPEAT_KINDS, "repeat.kind")!;
  const unit = oneOf(b.unit, REPEAT_UNITS, "repeat.unit")!;
  if (!kind || !unit) throw new Invalid("repeat: needs a kind and a unit");
  const every = num(b.every, "repeat.every", 1, 999);
  if (every === null || !Number.isInteger(every)) throw new Invalid("repeat.every: a whole number from 1");
  const start = date(b.start, "repeat.start");
  if (!start) throw new Invalid("repeat.start: required");
  if (b.days !== undefined && !Array.isArray(b.days)) throw new Invalid("repeat.days: expected a list");
  const max = unit === "week" ? 6 : unit === "month" ? 31 : -1;
  const days = [...new Set(((b.days as unknown[] | undefined) ?? []).map((d) => num(d, "repeat.days", unit === "month" ? 1 : 0, max)))]
    .filter((d): d is number => d !== null && Number.isInteger(d))
    .sort((p, q) => p - q);
  // Only a schedule by the week has several days; by the month, one; otherwise none.
  return { kind, every, unit, days: kind === "on" && unit === "week" ? days : kind === "on" && unit === "month" ? days.slice(0, 1) : [], start };
}

function log(x: unknown): LogEntry[] {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x)) throw new Invalid("log: expected a list");
  return x
    .map((e) => {
      const b = obj(e);
      return { day: date(b.day, "log.day")!, did: oneOf(b.did, ["done", "skipped"] as const, "log.did", "done")! };
    })
    .filter((e) => e.day)
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-100);
}

const FILE_ID = /^[0-9a-f-]{36}$/;
const fileId = (x: unknown, field: string): string => {
  if (typeof x !== "string" || !FILE_ID.test(x)) throw new Invalid(`${field}: expected a file id`);
  return x;
};
const attachments = (x: unknown): Attachment[] => {
  if (x === undefined || x === null) return [];
  if (!Array.isArray(x) || x.length > 50) throw new Invalid("files: expected a list (up to 50)");
  return x.map((f, i) => {
    const b = obj(f);
    return { id: fileId(b.id, `files[${i}].id`), name: str(b.name, `files[${i}].name`, 200) || "file", type: str(b.type, `files[${i}].type`, 200) };
  });
};

function devnote(body: unknown, recId: string, now: number): DevNote {
  const b = obj(body);
  return { ...base(b, recId, now), text: required(b.text, "text", 20_000), path: str(b.path, "path", 500), done: bool(b.done), files: attachments(b.files) };
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
  return { ...base(b, recId, now), deleted: false, areas, ai: aiSettings(b.ai) };
}

const model = (x: unknown, field: string, fallback: string): string => {
  if (x === undefined || x === null || x === "") return fallback;
  if (typeof x !== "string" || (x !== "off" && !modelInfo(x))) throw new Invalid(`${field}: not a model Evenkeel knows`);
  return x;
};

function aiSettings(x: unknown): AiSettings | null {
  if (x === undefined || x === null) return null;
  const b = obj(x);
  if (b.alertsAt !== undefined && !Array.isArray(b.alertsAt)) throw new Invalid("ai.alertsAt: expected a list");
  const alertsAt = [...new Set(((b.alertsAt as unknown[] | undefined) ?? DEFAULT_AI.alertsAt).map((p) => num(p, "ai.alertsAt", 1, 100)))]
    .filter((p): p is number => p !== null)
    .sort((p, q) => p - q);
  return {
    model: model(b.model, "ai.model", DEFAULT_AI.model),
    fastModel: model(b.fastModel, "ai.fastModel", DEFAULT_AI.fastModel),
    monthlyLimitUsd: b.monthlyLimitUsd === undefined ? DEFAULT_AI.monthlyLimitUsd : num(b.monthlyLimitUsd, "ai.monthlyLimitUsd", 0, 10_000),
    alertsAt,
  };
}

export const validators: { [K in Kind]: (body: unknown, id: string, now: number) => Records[K] } = {
  items: item,
  devnotes: devnote,
  settings,
};
