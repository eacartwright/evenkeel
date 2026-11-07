import { blank, newId, SETTINGS_ID, settingsOf, today, type CapturedLine, type Id, type Item, type Settings, type Status, type Tier } from "@evenkeel/shared";
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

/** Done, skipped or dropped, with Undo; or open again. */
export function setStatus(id: Id, status: Status) {
  const before = latest(id);
  if (!before) return;
  put("items", { ...before, status, doneAt: status === "open" ? null : Date.now() });
  if (status !== "open") {
    const word = status === "done" ? "Done" : status === "skipped" ? "Skipped" : "Dropped";
    showToast(`${word}: ${before.title}`, { label: "Undo", run: () => update(id, { status: before.status, doneAt: before.doneAt }) });
  }
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

export function addDevNote(text: string) {
  const t = text.trim();
  if (!t) return;
  put("devnotes", blank.devnote(newId(), t, location.pathname + location.search));
}
