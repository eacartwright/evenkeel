import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { blank, Invalid } from "@evenkeel/shared";
import { loadState, openDb, type DB } from "./db";
import { Store } from "./store";

const dirs: string[] = [];
const dbs: DB[] = [];
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "evenkeel-"));
  dirs.push(dir);
  const db = openDb(join(dir, "t.db"));
  dbs.push(db);
  return { db, store: new Store(db) };
}
afterEach(() => {
  // Close first: Windows won't delete a database that's still open.
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("Store", () => {
  it("starts with the default areas", () => {
    const { store } = fresh();
    expect(store.state.settings.app!.areas).toEqual(["Home", "Health", "Money", "Admin", "Chores", "Projects"]);
  });

  it("saves items with steps and reads them back from disk", () => {
    const { db, store } = fresh();
    store.put("items", "p", { ...blank.item("p", "Kitchen"), tier: "chip", area: "Home" });
    const r = store.put("items", "s", { ...blank.item("s", "Sand doors"), parentId: "p", blockedBy: ["p"], estMinutes: 45 });
    expect(r.rev).toBe(3);
    const back = loadState(db);
    expect(back.items.s).toMatchObject({ parentId: "p", blockedBy: ["p"], estMinutes: 45, rev: 3 });
    expect(back.items.p).toMatchObject({ tier: "chip", area: "Home" });
    expect(back.rev).toBe(3);
  });

  it("keeps a repeating item's rule, log and one-off answer", () => {
    const { db, store } = fresh();
    const repeat = { kind: "on", every: 1, unit: "week", days: [5], start: "2026-11-08" } as const;
    store.put("items", "l", { ...blank.item("l", "Laundry"), repeat, log: [{ day: "2026-11-06", did: "done" }], snoozedUntil: "2026-11-10" });
    store.put("items", "g", { ...blank.item("g", "Donate gifts"), oneOff: true });
    const back = loadState(db);
    expect(back.items.l).toMatchObject({ repeat, log: [{ day: "2026-11-06", did: "done" }], oneOff: false, snoozedUntil: "2026-11-10" });
    expect(back.items.g).toMatchObject({ repeat: null, log: [], oneOff: true });
  });

  it("keeps the first creation time", () => {
    const { store } = fresh();
    store.put("items", "a", { ...blank.item("a", "A"), createdAt: 100 }, 100);
    const r = store.put("items", "a", { ...blank.item("a", "A2"), createdAt: 999 }, 200);
    expect(r.record.createdAt).toBe(100);
    expect(r.record.updatedAt).toBe(200);
  });

  it("refuses unknown parents, loops and unknown waits", () => {
    const { store } = fresh();
    store.put("items", "a", blank.item("a", "A"));
    store.put("items", "b", { ...blank.item("b", "B"), parentId: "a" });
    expect(() => store.put("items", "c", { ...blank.item("c", "C"), parentId: "nope" })).toThrow(Invalid);
    expect(() => store.put("items", "a", { ...blank.item("a", "A"), parentId: "b" })).toThrow(/step of itself/);
    expect(() => store.put("items", "c", { ...blank.item("c", "C"), blockedBy: ["nope"] })).toThrow(/waits on/);
    expect(() => store.put("items", "bad id!", blank.item("x", "X"))).toThrow(/Bad id/);
  });

  it("keeps deletions as tombstones", () => {
    const { db, store } = fresh();
    store.put("items", "a", blank.item("a", "A"));
    store.put("items", "a", { ...blank.item("a", "A"), deleted: true });
    expect(loadState(db).items.a!.deleted).toBe(true);
  });
});
