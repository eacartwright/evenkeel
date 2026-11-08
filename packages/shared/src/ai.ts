import { addDays, FILED_TIERS, settingsOf, today, type Id, type State, type Tier } from "./types";
import { View } from "./derive";

// AI (DESIGN.md §5.6): ramble → candidate items, and clarify (an item → questions and a plan).
// Models, prices, the monthly cap and alerts are foodlab's (`foodlab/packages/shared/src/ai.ts`);
// Claude (Anthropic) or GPT (OpenAI), whichever keys the server has. The keys never leave the
// server. AI only proposes: everything here is checked before it's shown, and nothing becomes
// an item without a tap.

export type AiProvider = "anthropic" | "openai";
export const AI_PROVIDERS: AiProvider[] = ["anthropic", "openai"];
export const PROVIDER_NAMES: Record<AiProvider, string> = { anthropic: "Anthropic", openai: "OpenAI" };
export const KEY_NAMES: Record<AiProvider, string> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

export interface AiModelInfo {
  id: string;
  provider: AiProvider;
  label: string;
  /** Dollars per million tokens, list prices (foodlab's and sideshow's, 2026-10-29). Cost is an estimate from these. */
  input: number;
  output: number;
  cacheRead: number;
}

export const AI_MODELS: AiModelInfo[] = [
  { id: "claude-haiku-5-5", provider: "anthropic", label: "Claude Haiku 5.5", input: 0.1, output: 0.5, cacheRead: 0.01 },
  { id: "claude-sonnet-5-5", provider: "anthropic", label: "Claude Sonnet 5.5", input: 2, output: 10, cacheRead: 0.1 },
  { id: "claude-opus-5-5", provider: "anthropic", label: "Claude Opus 5.5", input: 4, output: 20, cacheRead: 0.2 },
  { id: "gpt-6-luna", provider: "openai", label: "GPT-6 Luna", input: 0.1, output: 0.5, cacheRead: 0.01 },
  { id: "gpt-6.1-terra", provider: "openai", label: "GPT-6.1 Terra", input: 1, output: 5, cacheRead: 0.05 },
  { id: "gpt-6.1-sol", provider: "openai", label: "GPT-6.1 Sol", input: 2, output: 10, cacheRead: 0.1 },
];

/** Voice rambles are transcribed by OpenAI (sideshow's dictation model), billed by the minute. */
export const TRANSCRIBE_MODEL = "gpt-transcribe";
export const TRANSCRIBE_USD_PER_MIN = 0.0045;

export const modelInfo = (id: string) => AI_MODELS.find((m) => m.id === id);
export const modelLabel = (m: string) => (m === TRANSCRIBE_MODEL ? "Transcription" : (modelInfo(m)?.label ?? m));

export interface AiSettings {
  /** Clarify and breakdown: the stronger model. A model id, or "off" (AI off altogether). */
  model: string;
  /** Sorting a ramble into items: a fast, cheap one. */
  fastModel: string;
  /** Dollars a calendar month; past it the server makes no more calls. Null = no cap. */
  monthlyLimitUsd: number | null;
  /** Percentages of the cap that raise an alert when a call crosses them. */
  alertsAt: number[];
}

export const DEFAULT_AI: AiSettings = { model: "claude-opus-5-5", fastModel: "claude-haiku-5-5", monthlyLimitUsd: 5, alertsAt: [75, 90] };

export const aiOf = (state: State): AiSettings => ({ ...DEFAULT_AI, ...settingsOf(state).ai });

/** Tokens as both providers' bills count them: input excludes the cached part. */
export interface AiTokens {
  input: number;
  output: number;
  cacheRead: number;
}

export function costUsd(model: string, t: AiTokens): number {
  const p = modelInfo(model);
  if (!p) return 0;
  return (t.input * p.input + t.output * p.output + t.cacheRead * p.cacheRead) / 1_000_000;
}

/** The alert levels a call moving spend from `before` to `after` crossed. */
export function crossed(ai: AiSettings, before: number, after: number): number[] {
  const cap = ai.monthlyLimitUsd;
  if (!cap) return [];
  return [...ai.alertsAt, 100].filter((pct, i, all) => all.indexOf(pct) === i && before < (cap * pct) / 100 && after >= (cap * pct) / 100);
}

/** What GET /api/ai answers: which providers have keys, and this month's use. */
export interface AiUsage {
  providers: AiProvider[];
  /** A voice ramble can be transcribed (there's an OpenAI key). */
  transcribe: boolean;
  month: string;
  costUsd: number;
  tokens: AiTokens;
  calls: number;
  byModel: { model: string; costUsd: number; calls: number; tokens: AiTokens }[];
  byDay: { day: number; costUsd: number }[];
  recent: { at: number; model: string; purpose: string; costUsd: number; tokens: AiTokens; ok: boolean; note: string }[];
}

/** The local month, "2026-11". */
export const monthOf = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

// ---- the context every call gets (DESIGN.md §5.6): today, the areas, open items ----

export interface AiContext {
  today: string;
  areas: string[];
  /** Open top-level items, for spotting duplicates. */
  open: { id: Id; title: string; area: string }[];
}

export function aiContext(state: State, day = today(), max = 300): AiContext {
  const view = new View(state);
  const open = Object.values(state.items)
    .filter((i) => !i.deleted && !i.parentId && i.status === "open")
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, max)
    .map((i) => ({ id: i.id, title: i.title, area: i.area }));
  return { today: day, areas: view.areas(), open };
}

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
export function contextText(ctx: AiContext): string {
  const [y, m, d] = ctx.today.split("-").map(Number) as [number, number, number];
  return [
    `TODAY: ${ctx.today} (${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`,
    `AREAS: ${ctx.areas.join(", ") || "(none)"}`,
    `EXISTING (open items, id: title [area]):`,
    ...(ctx.open.length ? ctx.open.map((o) => `${o.id}: ${o.title}${o.area ? ` [${o.area}]` : ""}`) : ["(none)"]),
  ].join("\n");
}

// ---- ramble → candidate items ----

export const FOUND_KINDS = ["task", "project", "chore", "note"] as const;
export type FoundKind = (typeof FOUND_KINDS)[number];
export const FOUND_KIND_LABEL: Record<FoundKind, string> = { task: "Task", project: "Project", chore: "Chore", note: "Note" };

/** One thing found in a ramble, as the inbox's review shows it (DESIGN.md §5.6). */
export interface Found {
  title: string;
  kind: FoundKind;
  area: string;
  /** The suggested tier, or inbox to sort it later. */
  tier: Tier;
  deadline: string | null;
  estMinutes: number | null;
  /** An open item this probably repeats. */
  duplicateOf: Id | null;
  /** The speaker's own words, so he recognizes it. */
  quote: string;
  /** Steps, for a project (or a task he spelled out). */
  steps: string[];
}

/** What the model answers for a ramble, before it's checked (snake_case, as the prompt asks). */
export interface RawFound {
  title: string;
  kind: string;
  area: string;
  tier: string;
  deadline: string | null;
  est_minutes: number | null;
  duplicate_of: string | null;
  source_quote: string;
  steps: string[];
}

const isDate = (s: unknown): s is string => {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};
const minutes = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.min(Math.round(n), 60 * 24 * 30) : null);
const line = (s: unknown, max = 200) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** An area as the list writes it; one the list doesn't have is dropped (the model mustn't invent areas). */
const knownArea = (a: unknown, areas: string[]) => areas.find((x) => x.toLowerCase() === line(a).toLowerCase()) ?? "";

/** The model's items, made safe: real dates only, known areas and items only, no empty titles. */
export function cleanFound(raw: RawFound[], ctx: AiContext): Found[] {
  const ids = new Set(ctx.open.map((o) => o.id));
  return raw
    .map((r): Found => {
      const kind = (FOUND_KINDS as readonly string[]).includes(r.kind) ? (r.kind as FoundKind) : "task";
      const tier = (FILED_TIERS as readonly string[]).includes(r.tier) ? (r.tier as Tier) : "inbox";
      // A deadline in the past is a misheard date, or one that's gone: either way, not a deadline.
      const deadline = isDate(r.deadline) && r.deadline >= ctx.today && r.deadline <= addDays(ctx.today, 3650) ? r.deadline : null;
      return {
        title: line(r.title),
        kind,
        area: knownArea(r.area, ctx.areas) || (kind === "chore" ? knownArea("Chores", ctx.areas) : ""),
        tier: kind === "note" ? "back" : tier === "hard" && !deadline ? "chip" : tier,
        deadline: kind === "note" ? null : deadline,
        estMinutes: kind === "note" ? null : minutes(r.est_minutes),
        duplicateOf: r.duplicate_of && ids.has(r.duplicate_of) ? r.duplicate_of : null,
        quote: line(r.source_quote, 1000),
        steps: kind === "note" ? [] : (r.steps ?? []).map((s) => line(s)).filter(Boolean).slice(0, 30),
      };
    })
    .filter((f) => f.title);
}

// ---- clarify: one item → questions and a plan ----

export interface PlanStep {
  title: string;
  estMinutes: number | null;
}

/** A proposed breakdown of one item (DESIGN.md §5.6). Nothing changes until it's accepted. */
export interface Plan {
  /** What would make the plan better, if answered. Empty once there's enough. */
  questions: string[];
  /** A clearer title; the same one when it's already clear. */
  title: string;
  /** One physical, visible step under 15 minutes. */
  nextAction: string;
  steps: PlanStep[];
  /** Things to gather first. */
  haveReady: string[];
  /** What he didn't know, each a small "find out" step. */
  unknowns: string[];
  isProject: boolean;
}

export interface RawPlan {
  questions: string[];
  title: string;
  next_action: string;
  subtasks: { title: string; est_minutes: number | null }[];
  have_ready: string[];
  unknowns: string[];
  is_project: boolean;
}

/** An answer to one of the questions; "" = don't know (which becomes a find-out step). */
export interface Answer {
  q: string;
  a: string;
}

export function cleanPlan(raw: RawPlan, currentTitle: string): Plan {
  const list = (xs: unknown, max: number) => (Array.isArray(xs) ? xs.map((x) => line(x, 300)).filter(Boolean).slice(0, max) : []);
  return {
    questions: list(raw.questions, 6),
    title: line(raw.title) || currentTitle,
    nextAction: line(raw.next_action, 300),
    steps: (Array.isArray(raw.subtasks) ? raw.subtasks : [])
      .map((s) => ({ title: line(s?.title), estMinutes: minutes(s?.est_minutes) }))
      .filter((s) => s.title)
      .slice(0, 25),
    haveReady: list(raw.have_ready, 15),
    unknowns: list(raw.unknowns, 10),
    isProject: raw.is_project === true,
  };
}

/** What the clarify call is sent about an item: it, its steps so far, and earlier answers. */
export function clarifyText(state: State, id: Id, answers: Answer[], ctx: AiContext): string {
  const view = new View(state);
  const i = state.items[id];
  if (!i) return "";
  const up = view.ancestors(id).map((a) => a.title);
  const steps = view.children(id).filter((s) => !s.deleted);
  return [
    contextText({ ...ctx, open: [] }),
    "",
    `ITEM: ${i.title}`,
    up.length ? `PART OF: ${up.join(" › ")}` : "",
    i.area ? `AREA: ${i.area}` : "",
    i.deadline ? `DEADLINE: ${i.deadline}` : "",
    i.nextAction ? `NEXT STEP SO FAR: ${i.nextAction}` : "",
    `NOTES SO FAR: ${i.body.trim() || "(none)"}`,
    steps.length ? `STEPS SO FAR:\n${steps.map((s) => `- [${s.status === "done" ? "x" : " "}] ${s.title}`).join("\n")}` : "STEPS SO FAR: (none)",
    answers.length ? `PREVIOUS ANSWERS:\n${answers.map((x) => `Q: ${x.q}\nA: ${x.a.trim() || "(doesn't know)"}`).join("\n")}` : "PREVIOUS ANSWERS: (none yet)",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

// ---- what an accepted proposal writes (the web's actions save it) ----

/** A kept ramble item's notes: his own words, so he recognizes where it came from. */
export const foundBody = (f: Found) => (f.quote ? `> ${f.quote}\n\n(from a ramble)` : "");

/**
 * An item's notes after a plan is accepted: what to have ready as a checklist, and the questions
 * he answered (they're facts about the item worth keeping), added below what's there.
 */
export function bodyWithPlan(body: string, plan: Pick<Plan, "haveReady">, answers: Answer[], day: string): string {
  const parts = [body.trimEnd()];
  if (plan.haveReady.length) parts.push(`**Have ready**\n${plan.haveReady.map((h) => `- [ ] ${h}`).join("\n")}`);
  const said = answers.filter((a) => a.a.trim());
  if (said.length) parts.push(`**Clarified** (${day})\n${said.map((a) => `- ${a.q} ${a.a.trim()}`).join("\n")}`);
  return parts.filter(Boolean).join("\n\n");
}
