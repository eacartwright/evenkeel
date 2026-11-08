import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { blank, type AiTokens } from "@evenkeel/shared";
import { AiStopped, clarify, monthSpend, sortRamble, usage, type Ask } from "./ai";
import { openDb, type DB } from "./db";
import { Store } from "./store";

// The AI calls with a stand-in provider: what's sent, what's kept, the cost log and the cap.

const dirs: string[] = [];
const dbs: DB[] = [];
function fresh() {
  const dir = mkdtempSync(join(tmpdir(), "evenkeel-ai-"));
  dirs.push(dir);
  const db = openDb(join(dir, "t.db"));
  dbs.push(db);
  return { db, store: new Store(db) };
}
afterEach(() => {
  for (const db of dbs.splice(0)) db.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** A provider that answers `out` and remembers what it was sent. */
function fake(out: unknown, tokens: AiTokens = { input: 1_000_000, output: 100_000, cacheRead: 0 }) {
  const sent: { job: string; model: string; text: string }[] = [];
  const ask: Ask = async (job, model, text) => {
    sent.push({ job: job.name, model, text });
    return { out: out as never, tokens, note: "" };
  };
  return { sent, providers: { anthropic: ask, openai: ask } };
}

describe("AI", () => {
  it("sorts a ramble with the fast model, checks what comes back and logs the cost", async () => {
    const { db, store } = fresh();
    store.put("items", "gutter", blank.item("gutter", "Fix the gutter"));
    const f = fake({
      items: [
        { title: "Call the dentist", kind: "task", area: "health", tier: "hard", deadline: null, est_minutes: null, duplicate_of: null, source_quote: "dentist", steps: [] },
        { title: "Gutter", kind: "task", area: "Garden", tier: "chip", deadline: null, est_minutes: 30, duplicate_of: "gutter", source_quote: "", steps: [] },
      ],
    });
    const r = await sortRamble(db, store.state, "um so the dentist, and the gutter thing", f.providers);
    expect(f.sent[0]).toMatchObject({ job: "ramble", model: "claude-haiku-5-5" });
    expect(f.sent[0]!.text).toContain("gutter: Fix the gutter");
    expect(f.sent[0]!.text).toContain("TRANSCRIPT:\num so the dentist");
    // No deadline, so not hard; an area that isn't listed is dropped.
    expect(r.out).toMatchObject([
      { title: "Call the dentist", area: "Health", tier: "chip" },
      { title: "Gutter", area: "", duplicateOf: "gutter", estMinutes: 30 },
    ]);
    // Haiku: $0.10 per M in, $0.50 per M out.
    expect(r.costUsd).toBeCloseTo(0.15);
    expect(usage(db)).toMatchObject({ calls: 1, recent: [{ purpose: "ramble", model: "claude-haiku-5-5", ok: true }] });
  });

  it("clarifies one item with the stronger model", async () => {
    const { db, store } = fresh();
    store.put("items", "p", blank.item("p", "Passport"));
    const f = fake({ questions: ["When does it expire?"], title: "Renew passport", next_action: "Find it", subtasks: [{ title: "Get a photo", est_minutes: 15 }], have_ready: [], unknowns: [], is_project: false });
    const r = await clarify(db, store.state, "p", [{ q: "Trips?", a: "March" }], f.providers);
    expect(f.sent[0]).toMatchObject({ job: "clarify", model: "claude-opus-5-5" });
    expect(f.sent[0]!.text).toContain("Q: Trips?\nA: March");
    expect(r.out).toMatchObject({ title: "Renew passport", nextAction: "Find it", steps: [{ title: "Get a photo", estMinutes: 15 }] });
    await expect(clarify(db, store.state, "nope", [], f.providers)).rejects.toThrow(AiStopped);
  });

  it("stops when AI is off or the month's cap is spent", async () => {
    const { db, store } = fresh();
    const s = store.state.settings.app!;
    const f = fake({ items: [] }, { input: 0, output: 2_000_000, cacheRead: 0 });
    store.put("settings", "app", { ...s, ai: { model: "off", fastModel: "claude-haiku-5-5", monthlyLimitUsd: 5, alertsAt: [] } });
    await expect(sortRamble(db, store.state, "x", f.providers)).rejects.toThrow(/off/);

    store.put("settings", "app", { ...s, ai: { model: "claude-opus-5-5", fastModel: "claude-opus-5-5", monthlyLimitUsd: 1, alertsAt: [75] } });
    // Opus: 2M out = $40, past the $1 cap: this call goes through (and says so), the next doesn't.
    const r = await sortRamble(db, store.state, "x", f.providers);
    expect(r.alerts).toEqual([75, 100]);
    expect(monthSpend(db)).toBeCloseTo(40);
    await expect(sortRamble(db, store.state, "x", f.providers)).rejects.toThrow(/cap/);
    expect(f.sent).toHaveLength(1);
  });

  it("records a provider's failure and passes it on", async () => {
    const { db, store } = fresh();
    const failing: Ask = async () => {
      throw new Error("boom");
    };
    await expect(sortRamble(db, store.state, "x", { anthropic: failing })).rejects.toThrow("boom");
    expect(usage(db).recent[0]).toMatchObject({ ok: false, costUsd: 0 });
  });

  it("says which key a model needs when its provider has none", async () => {
    const { db, store } = fresh();
    await expect(sortRamble(db, store.state, "x", { openai: fake({ items: [] }).providers.openai })).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});
