import { fromShared, today } from "@evenkeel/shared";
import { useState, useSyncExternalStore } from "react";
import { createItem } from "../actions";
import { go } from "../router";
import { showToast } from "../toast";
import { Dialog } from "./Dialog";
import { itemPath } from "./ItemRow";

// Quick add (DESIGN.md §5.1): the + button, Alt+N, and anything shared from another app.
// One thing, straight to the inbox; Today also plans it for today.

export interface QuickInit {
  title?: string;
  body?: string;
}

let current: QuickInit | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());

export function openQuickAdd(init: QuickInit = {}) {
  current = init;
  emit();
}
export function closeQuickAdd() {
  current = null;
  emit();
}
/** The phone's Back closed it (App.tsx already handled the history entry). */
export const closeQuickAddFromBack = closeQuickAdd;

export function useQuickAdd() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => current,
  );
}

/** /share?title=…&text=…&url=… from Android's share sheet. */
export const fromShare = (q: URLSearchParams): QuickInit => fromShared({ title: q.get("title"), text: q.get("text"), url: q.get("url") });

export function QuickAdd({ init }: { init: QuickInit }) {
  const [title, setTitle] = useState(init.title ?? "");
  const [body, setBody] = useState(init.body ?? "");
  const add = (opts: { open?: boolean; plan?: boolean } = {}) => {
    const t = title.trim();
    if (!t) return;
    const item = createItem(t, { body: body.trim(), ...(opts.plan ? { scheduled: today() } : {}) });
    closeQuickAdd();
    if (opts.open) go(itemPath(item.id));
    else showToast(opts.plan ? `On today's plan: ${t}` : `In the inbox: ${t}`, { label: "Open", run: () => go(itemPath(item.id)) });
  };
  return (
    <Dialog title="Add" onClose={closeQuickAdd} className="quick-add">
      <div className="stack">
        <input
          className="input big"
          aria-label="What is it?"
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add({ plan: e.altKey });
          }}
        />
        {(init.body || body) && <textarea className="input" aria-label="Notes" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />}
        <div className="row-actions quick-actions">
          <button className="btn" disabled={!title.trim()} onClick={() => add({ open: true })}>
            Add &amp; open
          </button>
          <button className="btn" disabled={!title.trim()} onClick={() => add({ plan: true })} title="Into the inbox, and on today's plan">
            Today
          </button>
          <span className="spacer" />
          <button className="btn primary" disabled={!title.trim()} onClick={() => add()}>
            Add to inbox
          </button>
        </div>
      </div>
    </Dialog>
  );
}
