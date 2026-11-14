import { captureLines, type CapturedLine } from "./capture";
import type { View } from "./derive";
import type { Id, Item, State } from "./types";

// Talking it through (DESIGN.md §5.8): the conversation happens in Claude or ChatGPT, on the
// subscriptions, not the API. Evenkeel starts it (a link that fills in the prompt) and takes back
// its wrap-up: the link, a summary, and proposed steps to keep or drop. The prompt and the
// wrap-up carry the item's tag, so a wrap-up pasted anywhere finds its item.

/** Where a conversation happened. */
export const SOURCES = ["claude", "chatgpt", "other"] as const;
export type Source = (typeof SOURCES)[number];
export const SOURCE_LABEL: Record<Source, string> = { claude: "Claude", chatgpt: "ChatGPT", other: "Chat" };

/** A step proposed by a wrap-up, with its own steps (a group). Nothing is an item until kept. */
export interface Proposed {
  title: string;
  steps: Proposed[];
}

/** One conversation's wrap-up, kept on the item it was about. */
export interface Research {
  id: Id;
  at: number;
  source: Source;
  /** The conversation (or its share link); "" if it wasn't pasted. */
  url: string;
  /** Markdown, as the chat wrote it. */
  summary: string;
  /** Steps it proposed that haven't been kept or dropped yet. */
  proposed: Proposed[];
}

/** "EK-3f9a2c": the first six of the item's id, enough to find it among a few thousand. */
export const researchTag = (id: Id) => `EK-${id.replace(/-/g, "").slice(0, 6)}`;

const TAG = /\[?\bEK-([0-9a-f]{6})\b\]?/i;

/** The item a tag in `text` points to (not a deleted one). */
export function itemForTag(state: State, text: string): Item | undefined {
  const m = TAG.exec(text);
  if (!m) return undefined;
  const want = m[1]!.toLowerCase();
  return Object.values(state.items).find((i) => !i.deleted && i.id.replace(/-/g, "").startsWith(want));
}

export function sourceOf(url: string): Source {
  const host = /^https?:\/\/([^/]+)/i.exec(url)?.[1]?.toLowerCase() ?? "";
  if (host === "claude.ai" || host.endsWith(".claude.ai")) return "claude";
  if (host === "chatgpt.com" || host.endsWith(".chatgpt.com") || host === "chat.openai.com") return "chatgpt";
  return "other";
}

/** A link that opens a new conversation with the prompt filled in (sent with one Enter). */
export function chatUrl(source: "claude" | "chatgpt", prompt: string): string {
  const q = encodeURIComponent(prompt);
  return source === "claude" ? `https://claude.ai/new?q=${q}` : `https://chatgpt.com/?q=${q}`;
}

/** Long notes are cut so the link stays a size every browser and app takes. */
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max).trimEnd()}…` : s);

const outline = (view: View, id: Id, depth: number, out: string[]) => {
  for (const s of view.children(id)) {
    if (s.deleted) continue;
    const mark = s.status === "done" ? " (done)" : s.status === "dropped" ? " (dropped)" : "";
    out.push(`${"  ".repeat(depth)}- ${s.title}${mark}`);
    if (depth < 2) outline(view, s.id, depth + 1, out);
  }
};

/**
 * The opening message: what the item is, what's around it, and how to wrap up. With no steps yet
 * it asks for a breakdown into groups first; with steps, it researches and keeps to those groups.
 */
export function researchPrompt(view: View, item: Item): string {
  const tag = researchTag(item.id);
  const path = [...view.ancestors(item.id).map((a) => a.title), item.title].join(" › ");
  const steps: string[] = [];
  outline(view, item.id, 0, steps);
  const found = item.research.filter((r) => r.summary.trim()).slice(-2);
  const parts = [`[${tag}] I'm working on this in my task app.`, `Topic: ${path}`];
  if (item.body.trim()) parts.push(`My notes:\n${clip(item.body.trim(), 2000)}`);
  if (steps.length) parts.push(`Already broken into:\n${clip(steps.join("\n"), 1200)}`);
  if (found.length) parts.push(`What I found before:\n${found.map((r) => clip(r.summary.trim(), 600)).join("\n\n")}`);
  parts.push(
    steps.length
      ? "Help me dig into this. Ask what you need to know first; I may add pictures."
      : "First help me break this into a few groups I can look into one at a time, then we'll dig into whichever I pick. Ask what you need to know first; I may add pictures.",
  );
  parts.push(
    [
      `When I say "wrap up", reply with only this, in Markdown:`,
      `[${tag}]`,
      `## Summary`,
      `What we found and decided, short enough to read on a phone. Keep specifics: product names, amounts, how-tos.`,
      `## Open questions`,
      `## Steps`,
      `- One line per next step or group, under 70 characters`,
      `  - Indent two spaces for a step inside a group`,
      ...(steps.length ? [`Where a step belongs to one of my groups above, put it under that group's exact name.`] : []),
    ].join("\n"),
  );
  return parts.join("\n\n");
}

/** What a pasted wrap-up holds. */
export interface WrapUp {
  url: string;
  source: Source;
  summary: string;
  proposed: Proposed[];
}

const URL_RE = /https?:\/\/[^\s<>()\]]+/gi;
const STEPS_HEAD = /^(?:#{1,6}\s*|\*\*)?\s*(?:next\s+)?steps\s*:?\s*(?:\*\*)?\s*:?\s*$/i;
const HEAD = /^(?:#{1,6}\s+\S|\*\*[^*]+\*\*\s*:?\s*$)/;

const toProposed = (lines: CapturedLine[]): Proposed[] => lines.map((l) => ({ title: l.title, steps: toProposed(l.steps) }));

/**
 * A wrap-up pasted back: the conversation's link (a chat link first), the "Steps" section as
 * proposed steps, everything else (tag and link taken out) as the summary. Text that isn't in the
 * wrap-up's shape is all summary, with nothing proposed.
 */
export function parseWrapUp(text: string): WrapUp {
  const urls = text.match(URL_RE) ?? [];
  const url = urls.find((u) => sourceOf(u) !== "other") ?? (urls.length === 1 && text.trim() === urls[0] ? urls[0] : "");
  let rest = text.replace(/\r\n?/g, "\n");
  if (url) rest = rest.split(url).join("");
  rest = rest.replace(new RegExp(TAG.source, "gi"), "");
  const lines = rest.split("\n");
  const at = lines.findIndex((l) => STEPS_HEAD.test(l.trim()));
  let proposed: Proposed[] = [];
  if (at >= 0) {
    let end = lines.findIndex((l, n) => n > at && HEAD.test(l.trim()));
    if (end < 0) end = lines.length;
    proposed = toProposed(captureLines(lines.slice(at + 1, end).join("\n")));
    lines.splice(at, end - at);
  }
  const summary = lines
    .join("\n")
    .replace(/^\s*#{1,6}\s*summary\s*$/im, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { url, source: url ? sourceOf(url) : "other", summary, proposed };
}

/** Is this pasted text a wrap-up (a tag and a summary or steps), not something to capture? */
export const looksLikeWrapUp = (text: string) => TAG.test(text) && /^\s*(?:#{1,6}\s*)?(?:summary|(?:next\s+)?steps)\b/im.test(text);

export const countProposed = (p: Proposed[]): number => p.reduce((n, x) => n + 1 + countProposed(x.steps), 0);
