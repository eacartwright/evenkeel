import { describe, expect, it } from "vitest";
import { addDays, blank, captureLines, cleanLine, countLines, dayLabel, daysBetween, emptyState, fromShared, Invalid, minutesLabel, newRepeat, nextOn, NO_AREA, repeatLabel, repeatState, validators, View, type Item, type Repeat, type State } from "./index";

const NOW = 1_700_000_000_000;

function state(items: Partial<Item>[]): State {
  const s = emptyState();
  items.forEach((x, n) => {
    const i = { ...blank.item(x.id ?? `i${n}`, x.title ?? `Item ${n}`, NOW + n), ...x };
    s.items[i.id] = i;
  });
  return s;
}

describe("capture", () => {
  it("drops list markers and checkboxes", () => {
    expect(cleanLine("- [ ] Call the insurer")).toEqual({ text: "Call the insurer", done: false });
    expect(cleanLine("  * [x] Trash out")).toEqual({ text: "Trash out", done: true });
    expect(cleanLine("3. Pick up meds")).toEqual({ text: "Pick up meds", done: false });
    expect(cleanLine("2026 taxes")).toEqual({ text: "2026 taxes", done: false });
  });

  it("makes one item per line and nests indented lines as steps", () => {
    const lines = captureLines("Kitchen\n  - take cabinet doors off\n  - sand and paint\n  new hardware\nCall Mom\n\n");
    expect(lines.map((l) => l.title)).toEqual(["Kitchen", "Call Mom"]);
    expect(lines[0]!.steps.map((l) => l.title)).toEqual(["take cabinet doors off", "sand and paint", "new hardware"]);
    expect(countLines(lines)).toBe(5);
  });

  it("nests deeper and steps back out", () => {
    const lines = captureLines("A\n  B\n    C\n  D\nE");
    expect(lines.map((l) => l.title)).toEqual(["A", "E"]);
    expect(lines[0]!.steps.map((l) => l.title)).toEqual(["B", "D"]);
    expect(lines[0]!.steps[0]!.steps.map((l) => l.title)).toEqual(["C"]);
  });

  it("cuts a long line at a word and keeps all of it in the body", () => {
    const long = `${"word ".repeat(60)}end`;
    const [l] = captureLines(long);
    expect(l!.title.length).toBeLessThanOrEqual(201);
    expect(l!.title.endsWith("…")).toBe(true);
    expect(l!.body).toBe(long);
  });

  it("turns a share into one item with the link in its body", () => {
    expect(fromShared({ title: "Cabinet paint guide", url: "https://example.com/paint" })).toEqual({ title: "Cabinet paint guide", body: "https://example.com/paint" });
    expect(fromShared({ text: "Look at this https://example.com/x" })).toEqual({ title: "Look at this", body: "https://example.com/x" });
    expect(fromShared({ url: "https://example.com/y" }).title).toBe("https://example.com/y");
  });
});

describe("dates", () => {
  it("adds and counts days across months", () => {
    expect(addDays("2026-11-28", 5)).toBe("2026-12-03");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(daysBetween("2026-11-07", "2026-11-14")).toBe(7);
  });
  it("labels days the way people say them", () => {
    const now = "2026-11-07"; // a Saturday
    expect(dayLabel("2026-11-07", now)).toBe("Today");
    expect(dayLabel("2026-11-08", now)).toBe("Tomorrow");
    expect(dayLabel("2026-11-06", now)).toBe("Yesterday");
    expect(dayLabel("2026-11-11", now)).toBe("Wed");
    expect(dayLabel("2026-11-21", now)).toBe("Nov 21");
    expect(dayLabel("2027-01-03", now)).toBe("Jan 3 2027");
  });
  it("labels durations", () => {
    expect(minutesLabel(20)).toBe("20 min");
    expect(minutesLabel(60)).toBe("1 h");
    expect(minutesLabel(90)).toBe("1 h 30");
  });
});

describe("validate", () => {
  it("cleans an item", () => {
    const i = validators.items({ title: "  Call insurer ", tier: "hard", deadline: "2026-11-20", estMinutes: 14.6, area: " Health " }, "a", NOW);
    expect(i).toMatchObject({ title: "Call insurer", tier: "hard", deadline: "2026-11-20", estMinutes: 15, area: "Health", status: null, doneAt: null });
  });
  it("refuses bad fields", () => {
    expect(() => validators.items({ title: "" }, "a", NOW)).toThrow(Invalid);
    expect(() => validators.items({ title: "x", tier: "urgent" }, "a", NOW)).toThrow(/tier/);
    expect(() => validators.items({ title: "x", deadline: "2026-02-30" }, "a", NOW)).toThrow(/real date/);
    expect(() => validators.items({ title: "x", parentId: "a" }, "a", NOW)).toThrow(/own step/);
  });
  it("sets a finish time only on a finished task", () => {
    expect(validators.items({ title: "x", status: "done" }, "a", NOW).doneAt).toBe(NOW);
    expect(validators.items({ title: "x", status: "open", doneAt: 5 }, "a", NOW).doneAt).toBeNull();
  });
  it("keeps settings' areas unique", () => {
    expect(validators.settings({ areas: ["Home", " home", "", "Health"] }, "app", NOW).areas).toEqual(["Home", "Health"]);
    expect(() => validators.settings({}, "other", NOW)).toThrow(Invalid);
  });
  it("keeps a dev note's files, and only real file ids", () => {
    const f = { id: "0f40bf1e-a2a9-426f-80b6-3d53dc4a8de1", name: "shot.png", type: "image/png" };
    expect(validators.devnotes({ text: "x" }, "a", NOW).files).toEqual([]);
    expect(validators.devnotes({ text: "x", files: [f] }, "a", NOW).files).toEqual([f]);
    expect(validators.devnotes({ text: "x", files: [{ ...f, name: "" }] }, "a", NOW).files[0]!.name).toBe("file");
    expect(() => validators.devnotes({ text: "x", files: [{ ...f, id: "../db" }] }, "a", NOW)).toThrow(/file id/);
  });
});

describe("View", () => {
  it("orders steps and counts progress, notes and dropped steps aside", () => {
    const v = new View(
      state([
        { id: "p", title: "Kitchen", tier: "chip" },
        { id: "b", parentId: "p", position: 2, status: "done" },
        { id: "a", parentId: "p", position: 1 },
        { id: "n", parentId: "p", position: 3, status: null },
        { id: "d", parentId: "p", position: 4, status: "dropped" },
      ]),
    );
    expect(v.children("p").map((i) => i.id)).toEqual(["a", "b", "n", "d"]);
    expect(v.progress("p")).toEqual({ done: 1, total: 2 });
  });

  it("finds loops and ancestors", () => {
    const v = new View(state([{ id: "a" }, { id: "b", parentId: "a" }, { id: "c", parentId: "b" }]));
    expect(v.wouldLoop("a", "c")).toBe(true);
    expect(v.wouldLoop("c", "a")).toBe(false);
    expect(v.ancestors("c").map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("puts unfiled top-level things in the inbox, in the order captured", () => {
    const v = new View(
      state([
        { id: "old" },
        { id: "new", createdAt: NOW + 100 },
        { id: "note", status: null },
        { id: "filed", tier: "chip" },
        { id: "step", parentId: "old" },
        { id: "done", status: "done" },
      ]),
    );
    expect(v.inbox().map((i) => i.id)).toEqual(["old", "note", "new"]);
  });

  it("builds Today without nagging about missed days", () => {
    const day = "2026-11-07";
    const v = new View(
      state([
        { id: "planned", tier: "chip", scheduled: day },
        { id: "missed", tier: "chip", scheduled: "2026-11-02" },
        { id: "soon", tier: "hard", deadline: "2026-11-12" },
        { id: "far", tier: "hard", deadline: "2026-12-01" },
        { id: "passed", tier: "hard", deadline: "2026-11-01" },
        { id: "quick", tier: "chip", estMinutes: 15, updatedAt: 1 },
        { id: "next", tier: "back", nextAction: "Find the case number" },
        { id: "nextChip", tier: "chip", nextAction: "Find the case number", updatedAt: 2 },
        { id: "long", tier: "chip", estMinutes: 90 },
        { id: "done", tier: "chip", scheduled: day, status: "done" },
      ]),
    );
    const t = v.today(day);
    expect(t.planned.map((i) => i.id)).toEqual(["planned"]);
    expect(t.onDeck.map((i) => i.id)).toEqual(["missed"]);
    expect(t.deadlines.map((i) => i.id)).toEqual(["passed", "soon"]);
    expect(t.quickWins.map((i) => i.id)).toEqual(["quick", "nextChip"]);
    expect(v.todayCount(day)).toBe(3);
  });

  it("leaves blocked work and parents with open steps out of quick wins", () => {
    const v = new View(
      state([
        { id: "first", tier: "chip", estMinutes: 60 },
        { id: "blocked", tier: "chip", estMinutes: 10, blockedBy: ["first"] },
        { id: "parent", tier: "chip", estMinutes: 10 },
        { id: "step", parentId: "parent" },
      ]),
    );
    expect(v.today("2026-11-07").quickWins).toEqual([]);
  });

  it("groups All by tier, notes apart, and searches into steps", () => {
    const v = new View(
      state([
        { id: "h2", tier: "hard", deadline: "2026-12-01", area: "Money" },
        { id: "h1", tier: "hard", deadline: "2026-11-20", area: "Health", title: "Insurance" },
        { id: "c", tier: "chip", title: "Kitchen", area: "Home" },
        { id: "s", parentId: "c", title: "Sand the cabinet doors" },
        { id: "n", tier: "back", status: null, title: "Paint colors" },
        { id: "x", tier: "chip", status: "done" },
        { id: "i", tier: "inbox" },
      ]),
    );
    expect(v.all().map((g) => [g.tier, g.items.map((i) => i.id)])).toEqual([
      ["hard", ["h1", "h2"]],
      ["chip", ["c"]],
      ["notes", ["n"]],
    ]);
    expect(v.all({ withDone: true }).find((g) => g.tier === "chip")!.items.map((i) => i.id)).toEqual(["c", "x"]);
    expect(v.all({ q: "cabinet" }).flatMap((g) => g.items.map((i) => i.id))).toEqual(["c"]);
    expect(v.all({ area: "health" }).flatMap((g) => g.items.map((i) => i.id))).toEqual(["h1"]);
  });

  it("offers Settings' areas, then others in use", () => {
    const s = state([{ area: "Car" }, { area: "home" }]);
    s.settings.app = { ...blank.settings(0), areas: ["Home", "Health"] };
    expect(new View(s).areas()).toEqual(["Home", "Health", "Car"]);
  });

  it("groups by area, A-Z with no area last, and filters to no area", () => {
    const v = new View(state([{ id: "a", tier: "chip", area: "Work" }, { id: "b", tier: "back", area: "home" }, { id: "c", tier: "chip", area: "Home" }, { id: "d", tier: "chip" }]));
    expect(v.byArea().map((g) => [g.area.toLowerCase(), g.items.map((i) => i.id).sort()])).toEqual([["home", ["b", "c"]], ["work", ["a"]], ["", ["d"]]]);
    expect(v.all({ area: NO_AREA }).flatMap((g) => g.items.map((i) => i.id))).toEqual(["d"]);
  });

  it("gives each area in use a stable color, whatever its case", () => {
    const v = new View(state([{ id: "w", area: "Work" }, { id: "h", area: "Home" }, { id: "s", area: "home" }]));
    expect(v.areaColor("Home")).toBe(0);
    expect(v.areaColor("HOME")).toBe(0);
    expect(v.areaColor("Work")).toBe(1);
    expect(v.areaColor("")).toBeNull();
  });

  it("offers a project's first open step, never the back burner, notes or anything waiting", () => {
    const v = new View(
      state([
        { id: "p", tier: "chip", area: "Home" },
        { id: "s1", parentId: "p", tier: "chip", status: "done", position: 1 },
        { id: "s2", parentId: "p", tier: "chip", position: 2 },
        { id: "t", tier: "chip", area: "Work" },
        { id: "b", tier: "back" },
        { id: "n", tier: "chip", status: null },
        { id: "i" },
        { id: "w", tier: "chip", blockedBy: ["t"] },
      ]),
    );
    expect(v.doable().map((i) => i.id).sort()).toEqual(["s2", "t"]);
    expect(v.doable("Home").map((i) => i.id)).toEqual(["s2"]);
    expect(v.areaOf(v.item("s2")!)).toBe("Home");
  });

  it("picks the same few for a day, and skipped ones only when nothing else is left", () => {
    const v = new View(state(["a", "b", "c", "d", "e"].map((id) => ({ id, tier: "chip" as const }))));
    const first = v.pick("2026-11-07", 3).map((i) => i.id);
    expect(first).toHaveLength(3);
    expect(v.pick("2026-11-07", 3).map((i) => i.id)).toEqual(first);
    expect(v.pick("2026-11-07", 3, "", [first[0]!]).map((i) => i.id)).not.toContain(first[0]);
    expect(v.pick("2026-11-07", 5, "", [first[0]!]).at(-1)!.id).toBe(first[0]);
  });
});

describe("repeat", () => {
  // 2026-11-08 is a Sunday; 2026-11-06 a Friday.
  const now = "2026-11-08";
  const on = (r: Partial<Repeat>): Repeat => ({ kind: "on", every: 1, unit: "week", days: [], start: "2026-11-01", ...r });

  it("about every so often: fresh, then soon, then due, from the last time", () => {
    const r = newRepeat("about", 3, "week", now);
    expect(repeatState({ repeat: r, log: [] }, now)).toMatchObject({ due: true, label: "not done yet" });
    expect(repeatState({ repeat: r, log: [{ day: "2026-11-01", did: "done" }] }, now)).toMatchObject({ due: false, soon: false, label: "7 days (usually 21)" });
    expect(repeatState({ repeat: r, log: [{ day: "2026-10-20", did: "done" }] }, now)).toMatchObject({ due: false, soon: true });
    // A skip starts the clock again too.
    expect(repeatState({ repeat: r, log: [{ day: "2026-10-01", did: "done" }, { day: "2026-10-18", did: "skipped" }] }, now)).toMatchObject({ due: true, ratio: 1 });
  });

  it("on a schedule: by the week, the fortnight, the day and the month", () => {
    const fri = on({ days: [5] });
    expect(nextOn(fri, null)).toBe("2026-11-06");
    expect(repeatState({ repeat: fri, log: [] }, now)).toMatchObject({ due: true, label: "since Nov 6" });
    // Done today (a Sunday, late): next Friday, the missed one doesn't come back.
    expect(repeatState({ repeat: fri, log: [{ day: now, did: "done" }] }, now)).toMatchObject({ due: false, next: "2026-11-13", label: "next Fri" });
    // Missed three Fridays: one due, not three.
    expect(nextOn(fri, "2026-10-12")).toBe("2026-11-06");
    const fortnight = on({ every: 2, days: [5], start: "2026-11-06" });
    expect([nextOn(fortnight, "2026-11-06"), nextOn(fortnight, "2026-11-20")]).toEqual(["2026-11-20", "2026-12-04"]);
    expect(nextOn(on({ unit: "day", every: 3, start: "2026-11-02" }), "2026-11-02")).toBe("2026-11-05");
    expect(nextOn(on({ unit: "month", days: [31] }), null)).toBe("2026-11-30");
    expect(nextOn(on({ unit: "month", days: [1], start: now }), null)).toBe("2026-12-01");
    expect(nextOn(on({ unit: "month", every: 3, days: [15], start: "2026-11-15" }), "2026-11-15")).toBe("2027-02-15");
  });

  it("says the rule plainly", () => {
    expect(repeatLabel(newRepeat("about", 1, "week", now))).toBe("About every week");
    expect(repeatLabel(newRepeat("about", 3, "month", now))).toBe("About every 3 months");
    expect(repeatLabel(on({ days: [5] }))).toBe("Every Friday");
    expect(repeatLabel(on({ every: 2, days: [1, 3] }))).toBe("Every 2 weeks on Mon, Wed");
    expect(repeatLabel(on({ unit: "month", days: [1] }))).toBe("Every month on the 1st");
    expect(repeatLabel(on({ unit: "month", days: [31] }))).toBe("Every month on the last day");
    expect(repeatLabel(on({ unit: "day", every: 1 }))).toBe("Every day");
  });

  it("validates the rule and the log", () => {
    const i = validators.items({ title: "Laundry", repeat: { kind: "on", every: 1, unit: "week", days: [5, 5, 1], start: now }, log: [{ day: "2026-11-06" }] }, "a", NOW);
    expect(i.repeat!.days).toEqual([1, 5]);
    expect(i.log).toEqual([{ day: "2026-11-06", did: "done" }]);
    expect(validators.items({ title: "x", repeat: { kind: "about", every: 2, unit: "week", days: [3], start: now } }, "a", NOW).repeat!.days).toEqual([]);
    expect(() => validators.items({ title: "x", repeat: { kind: "about", every: 0, unit: "week", start: now } }, "a", NOW)).toThrow(/every/);
    expect(() => validators.items({ title: "x", repeat: { kind: "on", every: 1, unit: "week", days: [7], start: now } }, "a", NOW)).toThrow(/days/);
  });

  it("puts due chores in their own group on Today, and keeps fresh ones out of the way", () => {
    const v = new View(
      state([
        { id: "due", tier: "chip", estMinutes: 10, repeat: newRepeat("about", 1, "week", now), log: [{ day: "2026-10-30", did: "done" }] },
        { id: "fresh", tier: "chip", estMinutes: 10, repeat: newRepeat("about", 1, "week", now), log: [{ day: "2026-11-07", did: "done" }] },
        { id: "quick", tier: "chip", estMinutes: 10 },
      ]),
    );
    const t = v.today(now);
    expect(t.chores.map((i) => i.id)).toEqual(["due"]);
    expect(t.quickWins.map((i) => i.id)).toEqual(["quick"]);
    expect(v.doable().map((i) => i.id).sort()).toEqual(["due", "quick"]);
  });

  it("keeps a chore put off with Later out of Today until its day", () => {
    const due = { id: "due", tier: "chip" as const, repeat: newRepeat("about", 1, "week", now), log: [] };
    const later = new View(state([{ ...due, snoozedUntil: "2026-11-11" }]));
    expect(later.today(now).chores).toEqual([]);
    expect(later.doable(), "not offered in All either").toEqual([]);
    expect(later.today("2026-11-11").chores.map((i) => i.id)).toEqual(["due"]);
    expect(validators.items({ title: "x", snoozedUntil: "2026-11-11" }, "a", NOW).snoozedUntil).toBe("2026-11-11");
  });
});
