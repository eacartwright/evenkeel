import type { Answer, Found, Plan } from "@evenkeel/shared";
import { showToast } from "./toast";

// AI through the server (DESIGN.md §5.6): a ramble sorted into candidate items, and clarify.
// Replies are proposals; actions.ts saves what's accepted.

interface Spent {
  model?: string;
  costUsd?: number;
  alerts?: number[];
  limitUsd?: number | null;
}
export type AiReply<T> = (T & Spent & { error?: undefined }) | (Spent & { error: string });

/** "0.31¢", "$1.20". */
export const money = (usd: number) => (usd < 0.01 ? `${(usd * 100).toFixed(2)}¢` : `$${usd.toFixed(2)}`);

/** A call that crossed an alert level says so. */
function aiAlert(r: Spent) {
  if (!r.alerts?.length || !r.limitUsd) return;
  const top = Math.max(...r.alerts);
  showToast(top >= 100 ? `AI: this month's $${r.limitUsd} cap is used up. No more AI until next month (Settings → AI).` : `AI: ${top}% of this month's $${r.limitUsd} is used.`);
}

async function post<T>(path: string, body: unknown): Promise<AiReply<T>> {
  let res: Response;
  try {
    res = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch {
    return { error: "Couldn't reach Evenkeel (offline?). Nothing was lost; try again when you're back online." };
  }
  const r = (await res.json().catch(() => ({ error: `Evenkeel answered ${res.status}` }))) as AiReply<T>;
  aiAlert(r);
  if (!res.ok && !r.error) return { ...r, error: `Evenkeel answered ${res.status}` };
  return r;
}

export const sortRamble = (text: string) => post<{ items: Found[] }>("/api/ai/ramble", { text });
export const clarifyItem = (id: string, answers: Answer[]) => post<{ plan: Plan }>("/api/ai/clarify", { id, answers });

/** Audio → text. Throws with a message to show. */
export async function transcribe(blob: Blob, seconds: number): Promise<string> {
  let res: Response;
  try {
    res = await fetch("/api/ai/transcribe", {
      method: "POST",
      // Without its ";codecs=…": the server names the file from this.
      headers: { "content-type": blob.type.split(";")[0] || "audio/webm", "x-seconds": String(Math.ceil(seconds)) },
      body: blob,
    });
  } catch {
    throw new Error("Couldn't reach Evenkeel (offline?)");
  }
  const r = (await res.json().catch(() => ({}))) as { text?: string; error?: string };
  if (!res.ok) throw new Error(r.error ?? `Evenkeel answered ${res.status}`);
  return r.text ?? "";
}
