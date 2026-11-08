import {
  blank,
  bodyWithPlan,
  foundBody,
  dayLabel,
  logged,
  newId,
  repeatState,
  SETTINGS_ID,
  settingsOf,
  today,
  type Attachment,
  type CapturedLine,
  type Answer,
  type DevNote,
  type Found,
  type Plan,
  type Id,
  type Item,
  type Repeat,
  type Settings,
  type Status,
  type Tier,
} from "@evenkeel/shared";
import { data, put } from "./sync";
import { showToast } from "./toast";

// Changes, each built on the latest copy of the record (data()), never the one from the last
// render, or two quick saves undo each other (as in foodlab).

const latest = (id: Id): Item | undefined => data().state.items[id];

/** Change some fields of an item and save it whole. */
export function update(id: Id, change: Partial<Item>) {
  const i = latest(id);
  if (i) put("items", { ...i, ...change });
}

/** A new item, saved; returns it. Steps go last under their parent. */
export function createItem(title: string, fields: Partial<Item> = {}): Item {
  const now = Date.now();
  const parentId = fields.parentId ?? null;
  const item: Item = { ...blank.item(newId(), title, now), position: data().view.nextPosition(parentId, now), ...fields };
  // A step lives under its parent, not in the inbox.
  if (parentId && !fields.tier) item.tier = latest(parentId)?.tier ?? "chip";
  put("items", item);
  return item;
}

/** Captured lines into the inbox (DESIGN.md §5.1), steps under their line. Returns how many. */
export function capture(lines: CapturedLine[], parentId: Id | null = null): number {
  let n = 0;
  for (const l of lines) {
    const item = createItem(l.title, { body: l.body, parentId, status: l.done ? "done" : "open" });
    n += 1 + capture(l.steps, item.id);
  }
  return n;
}

/**
 * Kept items from a ramble (DESIGN.md §5.6), each with its steps and his words in its notes.
 * Undo takes them all back. Returns how many top-level items were made.
 */
export function keepFound(found: Found[]): number {
  const made: Item[] = [];
  for (const f of found) {
    const note = f.kind === "note";
    const item = createItem(f.title, {
      body: foundBody(f),
      status: note ? null : "open",
      tier: note ? "back" : f.tier,
      area: f.area,
      deadline: f.deadline,
      estMinutes: f.estMinutes,
    });
    made.push(item);
    for (const s of f.steps) made.push(createItem(s, { parentId: item.id }));
  }
  const n = found.length;
  if (n)
    showToast(`Kept ${n} ${n === 1 ? "item" : "items"}`, {
      label: "Undo",
      run: () => {
        for (const m of made) update(m.id, { deleted: true });
      },
    });
  return n;
}

/**
 * An accepted plan (DESIGN.md §5.6), as edited: a clearer title, the next step, steps with
 * estimates (find-outs last), and what to have ready and the answers in the notes. Undo puts the
 * item back and takes the new steps away.
 */
export function applyPlan(id: Id, plan: Plan, answers: Answer[]) {
  const before = latest(id);
  if (!before) return;
  update(id, {
    title: plan.title.trim() || before.title,
    nextAction: plan.nextAction.trim() || before.nextAction,
    // The real date: "Today" would be wrong tomorrow.
    body: bodyWithPlan(before.body, plan, answers, today()),
    // A task that was a note becomes one again only if it now has steps to do.
    ...(before.status === null && (plan.steps.length || plan.unknowns.length) ? { status: "open" as const } : {}),
  });
  const made: Item[] = [];
  for (const s of plan.steps) if (s.title.trim()) made.push(createItem(s.title.trim(), { parentId: id, estMinutes: s.estMinutes }));
  for (const u of plan.unknowns) if (u.trim()) made.push(createItem(u.trim(), { parentId: id }));
  showToast(`Plan added to “${plan.title || before.title}”${made.length ? ` (${made.length} step${made.length === 1 ? "" : "s"})` : ""}`, {
    label: "Undo",
    run: () => {
      update(id, { title: before.title, nextAction: before.nextAction, body: before.body, status: before.status });
      for (const m of made) update(m.id, { deleted: true });
    },
  });
}

/** Done, skipped or dropped, with Undo; or open again. */
export function setStatus(id: Id, status: Status) {
  const before = latest(id);
  if (!before) return;
  if (before.repeat && before.status === "open" && (status === "done" || status === "skipped")) return didRepeat(before, status);
  put("items", { ...before, status, doneAt: status === "open" ? null : Date.now() });
  if (status !== "open") {
    const word = status === "done" ? "Done" : status === "skipped" ? "Skipped" : "Dropped";
    showToast(`${word}: ${before.title}`, { label: "Undo", run: () => update(id, { status: before.status, doneAt: before.doneAt }) });
  }
}

/**
 * Done or skipped, on a repeating item (DESIGN.md §6.1): logged, and it stays open for next time.
 * Its finished steps open again, so a routine's checklist starts fresh. Undo puts it all back.
 */
function didRepeat(before: Item, did: "done" | "skipped") {
  const steps = data().view.descendants(before.id).filter((s) => s.status === "done" || s.status === "skipped");
  const after: Item = { ...before, log: logged(before, did), doneAt: Date.now(), snoozedUntil: null };
  put("items", after);
  for (const s of steps) put("items", { ...s, status: "open", doneAt: null });
  const r = repeatState(after);
  const rule = after.repeat!;
  const unit = rule.every === 1 ? `a ${rule.unit}` : `${rule.every} ${rule.unit}s`;
  const next = r?.next ? `next ${dayLabel(r.next)}` : `back in about ${unit}`;
  showToast(`${did === "done" ? "Done" : "Skipped"}: ${before.title}${next ? ` · ${next}` : ""}`, {
    label: "Undo",
    run: () => {
      update(before.id, { log: before.log, doneAt: before.doneAt, snoozedUntil: before.snoozedUntil });
      for (const s of steps) update(s.id, { status: s.status, doneAt: s.doneAt });
    },
  });
}

/** Later (DESIGN.md §6.1): off Today until `day`, without counting as done or skipped. Null: back now. */
export function snooze(id: Id, day: string | null) {
  const before = latest(id);
  if (!before) return;
  update(id, { snoozedUntil: day });
  if (day) showToast(`Later: ${before.title} · back ${whenLabel(day)}`, { label: "Undo", run: () => update(id, { snoozedUntil: before.snoozedUntil }) });
}

/** A day to go after "back" or "until": "tomorrow", "Wed", "on Nov 15". */
export function whenLabel(day: string): string {
  const l = dayLabel(day);
  return l === "Tomorrow" || l === "Today" ? l.toLowerCase() : /\d/.test(l) ? `on ${l}` : l;
}

/** Set, change or stop how an item repeats. */
export const setRepeat = (id: Id, repeat: Repeat | null) => update(id, { repeat, ...(repeat ? { oneOff: false } : {}) });

/** "Last done" set by hand: replaces the latest entry's day, or adds one (null: clears the log). */
export function setLastDone(id: Id, day: string | null) {
  const i = latest(id);
  if (!i) return;
  if (!day) return update(id, { log: [] });
  const log = i.log.length ? [...i.log.slice(0, -1), { ...i.log.at(-1)!, day }] : [{ day, did: "done" as const }];
  update(id, { log: log.sort((a, b) => a.day.localeCompare(b.day)) });
}

/** Ticked from a checkbox: done, or open again. */
export const toggleDone = (i: Item) => setStatus(i.id, i.status === "done" ? "open" : "done");

/** Out of the inbox into a tier (DESIGN.md §5.2), or kept as a note. */
export function file(id: Id, to: Tier | "note") {
  const i = latest(id);
  if (!i) return;
  if (to === "note") put("items", { ...i, status: null, tier: "back", doneAt: null });
  else put("items", { ...i, tier: to, status: i.status ?? "open" });
}

/** Note ↔ task. */
export function setNote(id: Id, note: boolean) {
  const i = latest(id);
  if (i) put("items", { ...i, status: note ? null : "open", doneAt: null });
}

/** Plan it for today (or another day), or take it off the plan. */
export const schedule = (id: Id, day: string | null = today()) => update(id, { scheduled: day });

/** Delete (a tombstone, with Undo). Its steps go with it and come back with it. */
export function remove(id: Id) {
  const i = latest(id);
  if (!i) return;
  const steps = data().view.descendants(id);
  for (const s of steps) put("items", { ...s, deleted: true });
  put("items", { ...i, deleted: true });
  showToast(`Deleted: ${i.title}`, {
    label: "Undo",
    run: () => {
      update(id, { deleted: false });
      for (const s of steps) update(s.id, { deleted: false });
    },
  });
}

/** Move a step up or down among its siblings. */
export function move(id: Id, by: -1 | 1) {
  const i = latest(id);
  if (!i) return;
  const sibs = i.parentId ? data().view.children(i.parentId) : [];
  const at = sibs.findIndex((s) => s.id === id);
  const other = sibs[at + by];
  if (at < 0 || !other) return;
  put("items", { ...i, position: other.position });
  update(other.id, { position: i.position });
}

export function saveSettings(change: Partial<Settings>) {
  const s = data().state.settings[SETTINGS_ID] ?? settingsOf(data().state);
  put("settings", { ...s, ...change });
}

// ---- areas (DESIGN.md §5.7): Settings' list, and the items that use them ----

const sameArea = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
const listedAreas = () => settingsOf(data().state).areas;
/** Items (deleted ones too, so Restore brings them back as they were) in an area. */
const itemsIn = (area: string) => Object.values(data().state.items).filter((i) => i.area && sameArea(i.area, area));

/** A new area at the end of the list; one already there (or in use) is returned as it's written. */
export function addArea(name: string): string {
  const n = name.trim();
  const known = data().view.areas().find((a) => sameArea(a, n));
  if (known && listedAreas().some((a) => sameArea(a, known))) return known;
  saveSettings({ areas: [...listedAreas(), known ?? n] });
  return known ?? n;
}

/** A new name for an area, in the list and on every item in it. Renaming onto another merges them. */
export function renameArea(from: string, to: string) {
  const name = to.trim();
  if (!name || name === from) return;
  const into = data().view.areas().find((a) => sameArea(a, name) && !sameArea(a, from)) ?? name;
  const listed = listedAreas();
  const at = listed.findIndex((a) => sameArea(a, from));
  if (at < 0) {
    // Only on items so far ("Ch"): onto a listed area, or added to the list.
    if (!listed.some((a) => sameArea(a, into))) saveSettings({ areas: [...listed, into] });
  } else {
    // In the list: renamed in place; if that merges it into another listed one, that one goes.
    const without = listed.filter((a) => !sameArea(a, into) || sameArea(a, from));
    saveSettings({ areas: without.map((a) => (sameArea(a, from) ? into : a)) });
  }
  for (const i of itemsIn(from)) update(i.id, { area: into });
}

/** Take an area off the list and off its items (they stay, with no area). Undo puts both back. */
export function deleteArea(name: string) {
  const listed = listedAreas();
  const items = itemsIn(name);
  saveSettings({ areas: listed.filter((a) => !sameArea(a, name)) });
  for (const i of items) update(i.id, { area: "" });
  const n = items.filter((i) => !i.deleted).length;
  showToast(`Deleted the area “${name}”${n ? ` (${n} item${n === 1 ? "" : "s"} now without one)` : ""}`, {
    label: "Undo",
    run: () => {
      saveSettings({ areas: listed });
      for (const i of items) update(i.id, { area: i.area });
    },
  });
}

/** Move an area up or down (the order they're offered in). Saves the whole order, so areas only on items join the list. */
export function moveArea(name: string, by: -1 | 1) {
  const list = [...data().view.areas()];
  const at = list.findIndex((a) => sameArea(a, name));
  if (at < 0 || !list[at + by]) return;
  [list[at], list[at + by]] = [list[at + by]!, list[at]!];
  saveSettings({ areas: list });
}

/** A new dev note, linked to the page it was written on if `withPage`. */
export function addDevNote(text: string, withPage: boolean, files: Attachment[] = []) {
  const t = text.trim();
  if (!t) return;
  put("devnotes", { ...blank.devnote(newId(), t, withPage ? location.pathname + location.search : ""), files });
}

/** New text for a note; emptying it leaves the note as it was (✕ deletes). */
export function editDevNote(n: DevNote, text: string) {
  if (text.trim()) put("devnotes", { ...(data().state.devnotes[n.id] ?? n), text: text.trim() });
}

export function removeDevNote(n: DevNote) {
  put("devnotes", { ...(data().state.devnotes[n.id] ?? n), deleted: true });
  showToast("Deleted the note", { label: "Undo", run: () => put("devnotes", { ...(data().state.devnotes[n.id] ?? n), deleted: false }) });
}
