import { describe, expect, it } from "vitest";
import { aiContext, aiOf, blank, bodyWithPlan, clarifyText, cleanFound, cleanPlan, contextText, crossed, DEFAULT_AI, emptyState, foundBody, Invalid, validators, type Item, type RawFound, type State } from "./index";

const NOW = 1_700_000_000_000;

function state(items: Partial<Item>[]): State {
  const s = emptyState();
  s.settings.app = blank.settings(0);
  items.forEach((x, n) => {
    const i = { ...blank.item(x.id ?? `i${n}`, x.title ?? `Item ${n}`, NOW + n), ...x };
    s.items[i.id] = i;
  });
  return s;
}

const raw = (x: Partial<RawFound>): RawFound => ({
  title: "Call the dentist",
  kind: "task",
  area: "",
  tier: "chip",
  deadline: null,
  est_minutes: null,
  duplicate_of: null,
  source_quote: "",
  steps: [],
  ...x,
});

describe("AI context", () => {
  it("lists the areas and open top-level items only", () => {
    const s = state([
      { id: "a", title: "Renew passport", area: "Admin" },
      { id: "b", title: "A step", parentId: "a" },
      { id: "c", title: "Finished", status: "done" },
      { id: "d", title: "Gone", deleted: true },
      { id: "e", title: "An idea", status: null },
    ]);
    const ctx = aiContext(s, "2026-11-08");
    expect(ctx.open.map((o) => o.id)).toEqual(["a"]);
    expect(ctx.areas).toContain("Chores");
    const text = contextText(ctx);
    expect(text).toContain("TODAY: 2026-11-08 (Sunday)");
    expect(text).toContain("a: Renew passport [Admin]");
  });
});

describe("cleanFound (ramble → items)", () => {
  const ctx = aiContext(state([{ id: "x1", title: "Fix the gutter" }]), "2026-11-08");

  it("keeps areas only from the list, written as the list writes them", () => {
    const [a, b] = cleanFound([raw({ area: "home" }), raw({ area: "Garden" })], ctx);
    expect(a!.area).toBe("Home");
    expect(b!.area).toBe("");
  });

  it("drops invented, past or impossible dates, and a hard tier without one", () => {
    const f = cleanFound(
      [raw({ deadline: "2026-11-20", tier: "hard" }), raw({ deadline: "2026-02-30", tier: "hard" }), raw({ deadline: "2026-11-01" }), raw({ deadline: "Friday" })],
      ctx,
    );
    expect(f.map((x) => x.deadline)).toEqual(["2026-11-20", null, null, null]);
    expect(f.map((x) => x.tier)).toEqual(["hard", "chip", "chip", "chip"]);
  });

  it("keeps a duplicate only when it points at an open item", () => {
    const [a, b] = cleanFound([raw({ duplicate_of: "x1" }), raw({ duplicate_of: "nope" })], ctx);
    expect(a!.duplicateOf).toBe("x1");
    expect(b!.duplicateOf).toBeNull();
  });

  it("notes have no steps, dates or estimates; chores go to Chores; empty titles go", () => {
    const f = cleanFound(
      [raw({ kind: "note", title: "Idea: a herb shelf", steps: ["a"], est_minutes: 20, deadline: "2026-12-01" }), raw({ kind: "chore", title: "Clean the fridge" }), raw({ title: "  " })],
      ctx,
    );
    expect(f).toHaveLength(2);
    expect(f[0]).toMatchObject({ kind: "note", tier: "back", steps: [], estMinutes: null, deadline: null });
    expect(f[1]).toMatchObject({ kind: "chore", area: "Chores" });
  });

  it("tidies titles, steps and estimates; an unknown kind is a task", () => {
    const [a] = cleanFound([raw({ kind: "errand", title: "  Buy   milk ", steps: [" Check the fridge ", ""], est_minutes: 12.6, tier: "soon" })], ctx);
    expect(a).toMatchObject({ kind: "task", title: "Buy milk", steps: ["Check the fridge"], estMinutes: 13, tier: "inbox" });
  });

  it("puts his words in the notes", () => {
    expect(foundBody({ ...cleanFound([raw({ source_quote: "oh and the dentist" })], ctx)[0]! })).toBe("> oh and the dentist\n\n(from a ramble)");
  });
});

describe("clarify", () => {
  it("sends the item, its steps and the answers so far", () => {
    const s = state([
      { id: "p", title: "Renew passport", body: "Trip in March", area: "Admin" },
      { id: "s1", title: "Find the old one", parentId: "p", status: "done" },
    ]);
    const text = clarifyText(s, "p", [{ q: "When does it expire?", a: "" }], aiContext(s, "2026-11-08"));
    expect(text).toContain("ITEM: Renew passport");
    expect(text).toContain("NOTES SO FAR: Trip in March");
    expect(text).toContain("- [x] Find the old one");
    expect(text).toContain("A: (doesn't know)");
    // Duplicates don't matter here: no list of open items.
    expect(text).not.toContain("EXISTING (open items, id: title [area]):\np:");
  });

  it("cleans a plan: no empty steps, whole minutes, the title kept if none comes back", () => {
    const plan = cleanPlan(
      {
        questions: ["When?", " "],
        title: "",
        next_action: "Find the passport",
        subtasks: [
          { title: "Get a photo", est_minutes: 20.4 },
          { title: "", est_minutes: 5 },
          { title: "Fill in the form", est_minutes: -3 },
        ],
        have_ready: ["Old passport"],
        unknowns: ["Find out the fee"],
        is_project: false,
      },
      "Renew passport",
    );
    expect(plan.title).toBe("Renew passport");
    expect(plan.questions).toEqual(["When?"]);
    expect(plan.steps).toEqual([
      { title: "Get a photo", estMinutes: 20 },
      { title: "Fill in the form", estMinutes: null },
    ]);
  });

  it("adds what to have ready and the answers to the notes", () => {
    const body = bodyWithPlan(
      "Trip in March\n",
      { haveReady: ["Old passport", "A photo"] },
      [
        { q: "When does it expire?", a: "April" },
        { q: "Name changed?", a: "" },
      ],
      "Nov 8",
    );
    expect(body).toBe("Trip in March\n\n**Have ready**\n- [ ] Old passport\n- [ ] A photo\n\n**Clarified** (Nov 8)\n- When does it expire? April");
    expect(bodyWithPlan("", { haveReady: [] }, [], "Nov 8")).toBe("");
  });
});

describe("AI settings", () => {
  it("defaults until set, and fills fields an older record lacks", () => {
    expect(aiOf(emptyState())).toEqual(DEFAULT_AI);
    const s = state([]);
    s.settings.app = { ...s.settings.app!, ai: { model: "gpt-6.1-sol" } as never };
    expect(aiOf(s)).toMatchObject({ model: "gpt-6.1-sol", fastModel: DEFAULT_AI.fastModel });
  });

  it("are validated with the settings", () => {
    const ok = validators.settings({ areas: ["Home"], ai: { model: "off", monthlyLimitUsd: null, alertsAt: [90, 50, 90] } }, "app", NOW);
    expect(ok.ai).toEqual({ model: "off", fastModel: DEFAULT_AI.fastModel, monthlyLimitUsd: null, alertsAt: [50, 90] });
    expect(validators.settings({ areas: [] }, "app", NOW).ai).toBeNull();
    expect(() => validators.settings({ ai: { model: "gpt-2" } }, "app", NOW)).toThrow(Invalid);
  });

  it("alerts once per level crossed", () => {
    const ai = { ...DEFAULT_AI, monthlyLimitUsd: 10, alertsAt: [75, 90] };
    expect(crossed(ai, 7, 7.6)).toEqual([75]);
    expect(crossed(ai, 7.6, 10.2)).toEqual([90, 100]);
    expect(crossed({ ...ai, monthlyLimitUsd: null }, 0, 100)).toEqual([]);
  });
});
