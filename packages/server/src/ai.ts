import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import OpenAI, { toFile } from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import {
  AI_MODELS,
  aiContext,
  aiOf,
  clarifyText,
  cleanFound,
  cleanPlan,
  contextText,
  costUsd,
  crossed,
  KEY_NAMES,
  modelInfo,
  monthOf,
  TRANSCRIBE_MODEL,
  TRANSCRIBE_USD_PER_MIN,
  type AiProvider,
  type AiSettings,
  type AiTokens,
  type AiUsage,
  type Answer,
  type Found,
  type Id,
  type Plan,
  type State,
} from "@evenkeel/shared";
import type { DB } from "./db";

// AI (DESIGN.md §5.6), foodlab's module with evenkeel's two jobs: a ramble sorted into candidate
// items (the fast model) and clarify, one item → questions and a plan (the stronger model).
// Voice rambles are transcribed first (sideshow's dictation). The keys come from
// ANTHROPIC_API_KEY and OPENAI_API_KEY in .env (either or both) and never leave the server. Every
// call is recorded in ai_usage with its estimated cost; past the monthly cap no more calls are made.

/** Which providers have a key: their models can be picked. */
export const providers = (env: NodeJS.ProcessEnv = process.env): AiProvider[] => [
  ...(env.ANTHROPIC_API_KEY || env.ANTHROPIC_AUTH_TOKEN ? (["anthropic"] as const) : []),
  ...(env.OPENAI_API_KEY ? (["openai"] as const) : []),
];

export const canTranscribe = () => !!process.env.OPENAI_API_KEY;

let anthropic: Anthropic | undefined;
let openai: OpenAI | undefined;

export class AiStopped extends Error {}

/** One kind of call: what the model is told, the shape it answers in, how hard it thinks. */
export interface Job<T> {
  name: string;
  system: string;
  schema: z.ZodType<T>;
  effort: "low" | "medium";
}

const Ramble = z.object({
  items: z.array(
    z.object({
      title: z.string(),
      kind: z.enum(["task", "project", "chore", "note"]),
      area: z.string(),
      tier: z.enum(["hard", "chip", "back"]),
      deadline: z.string().nullable(),
      est_minutes: z.number().nullable(),
      duplicate_of: z.string().nullable(),
      source_quote: z.string(),
      steps: z.array(z.string()),
    }),
  ),
});

const RAMBLE_SYSTEM = `You turn a rambling transcript (spoken or typed) into discrete candidate items for one person's task system. He reviews every item before it's kept, so be useful rather than exhaustive.

Rules:
- One item per distinct thing to do, remember, or think about. Don't merge unrelated things; don't split one thing into several items (use steps for that).
- Titles are short imperatives ("Call the dentist to move the cleaning"), under 70 characters, in his terms. Notes get a short descriptive title instead.
- kind: task (one sitting) | project (needs several steps) | chore (comes around again: cleaning, bills, refills) | note (an idea or information, nothing to do).
- area: one of AREAS exactly, or "" if none fits. Never invent an area.
- tier: hard only if a real deadline is mentioned; chip if it's ongoing or he wants to get to it soon; back if it's vague or someday.
- deadline: YYYY-MM-DD, worked out from TODAY when he says "Friday" or "next week"; null unless he gives a real date or deadline. Never invent one.
- est_minutes: only if he says how long, else null.
- steps: for a project, or a task he spells out in parts, the steps he mentions, in order, as short imperatives. Don't add steps he didn't say; [] otherwise.
- duplicate_of: the id from EXISTING when the item is very likely the same thing as an open item there; else null.
- source_quote: his own words for this item, copied from the transcript (trimmed), so he recognizes it.
- Skip filler, false starts and things he says are already done. If there's nothing to keep, return no items.`;

const Clarify = z.object({
  questions: z.array(z.string()),
  title: z.string(),
  next_action: z.string(),
  subtasks: z.array(z.object({ title: z.string(), est_minutes: z.number().nullable() })),
  have_ready: z.array(z.string()),
  unknowns: z.array(z.string()),
  is_project: z.boolean(),
});

const CLARIFY_SYSTEM = `You help a person who finds it hard to start vague tasks. Your job is to make this item concrete enough that the first step takes no thinking. He'll review your plan and accept, edit or reject it.

Step 1 - Questions. If key facts are missing, ask 3 to 6 short questions he can answer from memory in a few words: what outcome he wants, who to contact, dates, account numbers or documents the task needs. If PREVIOUS ANSWERS already cover it, or the item is clear enough, ask none. "(doesn't know)" is a fine answer: don't ask it again; it becomes an unknown.
Step 2 - Draft a breakdown now, from what you know (even before the questions are answered):
- title: the item's title, made clearer only if it's vague (keep his wording when it's fine).
- next_action: one physical, visible step under 15 minutes ("Find the old passport and check its expiry date").
- subtasks: ordered, each completable in one sitting, short imperatives, with est_minutes (a realistic guess). Leave out steps already in STEPS SO FAR. Don't repeat next_action as the first subtask unless it's a real step of the plan.
- have_ready: things to gather before a call, form or appointment ([] if none).
- unknowns: what he doesn't know yet, each phrased as a small "Find out ..." step.
- is_project: true if this needs more than 4 subtasks or spans weeks.
Don't pad. Fewer, clearer steps beat many. Don't invent facts (names, numbers, dates) he hasn't given.`;

type RawRamble = z.infer<typeof Ramble>;
type RawClarify = z.infer<typeof Clarify>;
export const RAMBLE_JOB: Job<RawRamble> = { name: "ramble", system: RAMBLE_SYSTEM, schema: Ramble, effort: "low" };
export const CLARIFY_JOB: Job<RawClarify> = { name: "clarify", system: CLARIFY_SYSTEM, schema: Clarify, effort: "medium" };

/** One provider's call: what it answered (null when it declined), its tokens, and anything odd. */
export type Ask = <T>(job: Job<T>, model: string, text: string) => Promise<{ out: T | null; tokens: AiTokens; note: string }>;

const askAnthropic: Ask = async (job, model, text) => {
  const res = await (anthropic ??= new Anthropic()).messages.parse({
    model,
    max_tokens: 16000,
    system: job.system,
    messages: [{ role: "user", content: text }],
    output_config: { effort: job.effort, format: zodOutputFormat(job.schema) },
  });
  const tokens = { input: res.usage.input_tokens, output: res.usage.output_tokens, cacheRead: res.usage.cache_read_input_tokens ?? 0 };
  const out = res.stop_reason === "refusal" ? null : res.parsed_output;
  return { out, tokens, note: res.stop_reason === "refusal" ? "declined" : out ? "" : `no ${job.name} (${res.stop_reason})` };
};

const askOpenAi: Ask = async (job, model, text) => {
  const res = await (openai ??= new OpenAI()).responses.parse({
    model,
    instructions: job.system,
    input: text,
    reasoning: { effort: job.effort },
    max_output_tokens: 16000,
    text: { format: zodTextFormat(job.schema, job.name) },
  });
  // OpenAI counts cached input inside input_tokens; the bill (and costUsd) counts them apart.
  const cached = res.usage?.input_tokens_details?.cached_tokens ?? 0;
  const tokens = { input: (res.usage?.input_tokens ?? 0) - cached, output: res.usage?.output_tokens ?? 0, cacheRead: cached };
  const out = res.output_parsed;
  return { out, tokens, note: out ? "" : `no ${job.name} (${res.status})` };
};

const ASK: Record<AiProvider, Ask> = { anthropic: askAnthropic, openai: askOpenAi };

/** A provider's error, short enough to show and log. */
export function errorNote(err: unknown): string {
  if (err instanceof Anthropic.APIError || err instanceof OpenAI.APIError) return `${err.status ?? ""} ${err.message}`.trim().slice(0, 200);
  return "Couldn't reach the AI service";
}

export function monthSpend(db: DB, month = monthOf(Date.now())): number {
  return (db.prepare("SELECT COALESCE(SUM(cost_usd), 0) AS c FROM ai_usage WHERE month = ?").get(month) as { c: number }).c;
}

export interface AiCall<T> {
  out: T | null;
  model: string;
  costUsd: number;
  ms: number;
  /** Alert levels (% of the cap) this call crossed. */
  alerts: number[];
}

/** May a call be made now? Throws AiStopped with the reason if not. */
function checkCap(db: DB, ai: AiSettings) {
  if (ai.model === "off") throw new AiStopped("AI is off (Settings → AI)");
  if (ai.monthlyLimitUsd !== null && monthSpend(db) >= ai.monthlyLimitUsd) throw new AiStopped(`This month's $${ai.monthlyLimitUsd} cap is spent (Settings → AI)`);
}

function record(db: DB, at: number, model: string, purpose: string, tokens: AiTokens, cost: number, ok: boolean, note: string) {
  db.prepare(
    "INSERT INTO ai_usage (at, month, model, purpose, input_tokens, output_tokens, cache_read_tokens, cost_usd, ok, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(at, monthOf(at), model, purpose, tokens.input, tokens.output, tokens.cacheRead, cost, ok ? 1 : 0, note);
}

/** Ask `model` to do `job` on `text`, recorded in ai_usage. `ask` is the providers' (tests pass their own). */
export async function aiCall<T>(db: DB, ai: AiSettings, job: Job<T>, text: string, model: string, ask: Partial<Record<AiProvider, Ask>> = ASK): Promise<AiCall<T>> {
  checkCap(db, ai);
  const info = modelInfo(model);
  if (!info) throw new AiStopped(`Not a model Evenkeel knows: ${model}`);
  const call = ask[info.provider];
  if (!call || (ask === ASK && !providers().includes(info.provider)))
    throw new AiStopped(`${info.label} needs ${KEY_NAMES[info.provider]} on the server; add it to .env, or pick another model in Settings → AI`);
  const before = monthSpend(db);
  const started = Date.now();
  let res;
  try {
    res = await call(job, model, text);
  } catch (err) {
    record(db, started, model, job.name, { input: 0, output: 0, cacheRead: 0 }, 0, false, errorNote(err));
    throw err;
  }
  const cost = costUsd(model, res.tokens);
  record(db, started, model, job.name, res.tokens, cost, !!res.out, res.note);
  return { out: res.out, model, costUsd: cost, ms: Date.now() - started, alerts: crossed(ai, before, before + cost) };
}

/** A ramble (spoken and transcribed, or typed) → candidate items, checked. */
export async function sortRamble(db: DB, state: State, transcript: string, ask?: Partial<Record<AiProvider, Ask>>): Promise<AiCall<Found[]>> {
  const ai = aiOf(state);
  const ctx = aiContext(state);
  const text = `${contextText(ctx)}\n\nTRANSCRIPT:\n${transcript.trim()}`;
  const r = await aiCall(db, ai, RAMBLE_JOB, text, ai.fastModel, ask);
  return { ...r, out: r.out ? cleanFound(r.out.items, ctx) : null };
}

/** One item → questions and a proposed plan, checked. */
export async function clarify(db: DB, state: State, id: Id, answers: Answer[], ask?: Partial<Record<AiProvider, Ask>>): Promise<AiCall<Plan>> {
  const item = state.items[id];
  if (!item || item.deleted) throw new AiStopped("No such item (it may not have reached the server yet)");
  const ai = aiOf(state);
  const r = await aiCall(db, ai, CLARIFY_JOB, clarifyText(state, id, answers, aiContext(state)), ai.model, ask);
  return { ...r, out: r.out ? cleanPlan(r.out, item.title) : null };
}

const AUDIO_EXT: Record<string, string> = { "audio/webm": "webm", "audio/mp4": "mp4", "audio/ogg": "ogg", "audio/mpeg": "mp3", "audio/wav": "wav", "audio/x-m4a": "m4a" };

/** A voice ramble → text (OpenAI's transcription model, as sideshow's dictation). Same switch, cap and log. */
export async function transcribe(db: DB, state: State, audio: { data: Uint8Array; type: string }, seconds: number): Promise<string> {
  if (!canTranscribe()) throw new AiStopped("Voice needs OPENAI_API_KEY on the server (.env); you can still type or paste a ramble");
  checkCap(db, aiOf(state));
  const started = Date.now();
  const type = audio.type.split(";")[0]!;
  const areas = aiContext(state).areas;
  try {
    const file = await toFile(audio.data, `ramble.${AUDIO_EXT[type] ?? "webm"}`, { type });
    const res = await (openai ??= new OpenAI()).audio.transcriptions.create({
      file,
      model: TRANSCRIBE_MODEL,
      prompt: `A person thinking out loud about things to do, errands and chores, for a personal task list. Areas: ${areas.join(", ")}.`,
    });
    const cost = (Math.max(seconds, 0) / 60) * TRANSCRIBE_USD_PER_MIN;
    record(db, started, TRANSCRIBE_MODEL, "transcribe", { input: 0, output: 0, cacheRead: 0 }, cost, true, `${Math.round(seconds)} s`);
    return res.text;
  } catch (err) {
    record(db, started, TRANSCRIBE_MODEL, "transcribe", { input: 0, output: 0, cacheRead: 0 }, 0, false, errorNote(err));
    throw err;
  }
}

/** This month's use, for Settings → AI. */
export function usage(db: DB): AiUsage {
  const month = monthOf(Date.now());
  type Row = { model: string; purpose: string; at: number; input_tokens: number; output_tokens: number; cache_read_tokens: number; cost_usd: number; ok: number; note: string };
  const rows = db.prepare("SELECT * FROM ai_usage WHERE month = ? ORDER BY at").all(month) as Row[];
  const tok = (r: Row): AiTokens => ({ input: r.input_tokens, output: r.output_tokens, cacheRead: r.cache_read_tokens });
  const add = (a: AiTokens, b: AiTokens): AiTokens => ({ input: a.input + b.input, output: a.output + b.output, cacheRead: a.cacheRead + b.cacheRead });
  const zero = (): AiTokens => ({ input: 0, output: 0, cacheRead: 0 });
  const byModel = new Map<string, AiUsage["byModel"][number]>();
  const byDay = new Map<number, number>();
  let tokens = zero();
  let cost = 0;
  for (const r of rows) {
    tokens = add(tokens, tok(r));
    cost += r.cost_usd;
    const m = byModel.get(r.model) ?? { model: r.model, costUsd: 0, calls: 0, tokens: zero() };
    byModel.set(r.model, { ...m, costUsd: m.costUsd + r.cost_usd, calls: m.calls + 1, tokens: add(m.tokens, tok(r)) });
    const day = new Date(r.at).getDate();
    byDay.set(day, (byDay.get(day) ?? 0) + r.cost_usd);
  }
  return {
    providers: providers(),
    transcribe: canTranscribe(),
    month,
    costUsd: cost,
    tokens,
    calls: rows.length,
    byModel: [...byModel.values()].sort((a, b) => b.costUsd - a.costUsd),
    byDay: [...byDay].map(([day, c]) => ({ day, costUsd: c })),
    recent: rows
      .slice(-8)
      .reverse()
      .map((r) => ({ at: r.at, model: r.model, purpose: r.purpose, costUsd: r.cost_usd, tokens: tok(r), ok: !!r.ok, note: r.note })),
  };
}

/** The models that can be used now (their provider has a key). */
export const availableModels = () => AI_MODELS.filter((m) => providers().includes(m.provider));
