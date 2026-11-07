import { dayLabel, minutesLabel, today, type Item } from "@evenkeel/shared";
import type { ReactNode } from "react";
import { toggleDone } from "../actions";
import { A } from "../router";
import { useData } from "../sync";

export const itemPath = (id: string) => `/items/${encodeURIComponent(id)}`;

/** A task's box, or 📝 for a note. */
export function Check({ item }: { item: Item }) {
  if (item.status === null)
    return (
      <span className="item-check note" title="Note" aria-label="Note">
        📝
      </span>
    );
  const done = item.status !== "open";
  return (
    <button
      className={`item-check ${done ? "done" : ""}`}
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `Open again: ${item.title}` : `Done: ${item.title}`}
      title={item.status === "skipped" ? "Skipped" : item.status === "dropped" ? "Dropped" : undefined}
      onClick={() => toggleDone(item)}
    >
      {item.status === "done" ? "✓" : item.status === "skipped" ? "↷" : item.status === "dropped" ? "✕" : ""}
    </button>
  );
}

/** The facts under a row's title: where it's from, dates, size, progress, the next step. */
export function Facts({ item, show = {} }: { item: Item; show?: { path?: boolean; area?: boolean; scheduled?: boolean } }) {
  const { view } = useData();
  const now = today();
  const parts: ReactNode[] = [];
  if (show.path !== false) {
    const up = view.ancestors(item.id);
    if (up.length) parts.push(<span key="path">{up.map((a) => a.title).join(" › ")}</span>);
  }
  if (show.area !== false && item.area) parts.push(<span key="area">{item.area}</span>);
  if (item.deadline) {
    const left = item.deadline < now;
    parts.push(
      <span key="deadline" className={left ? "fact-past" : item.deadline <= now ? "fact-due" : ""}>
        {left ? `was due ${dayLabel(item.deadline, now)}` : `due ${dayLabel(item.deadline, now)}`}
      </span>,
    );
  }
  if (show.scheduled !== false && item.scheduled) parts.push(<span key="sched">📅 {dayLabel(item.scheduled, now)}</span>);
  if (item.estMinutes) parts.push(<span key="est">{minutesLabel(item.estMinutes)}</span>);
  const p = view.progress(item.id);
  if (p.total) parts.push(<span key="prog">{`${p.done}/${p.total} steps`}</span>);
  if (view.blocked(item)) parts.push(<span key="blocked">⏸ waiting</span>);
  if (!parts.length && !item.nextAction) return null;
  return (
    <span className="row-sub">
      {item.nextAction && <span className="next-action">→ {item.nextAction}</span>}
      {parts.map((x, n) => (
        <span key={n} className="fact">
          {x}
        </span>
      ))}
    </span>
  );
}

/** One item in a list: its box, its title (a link to it) and facts, and any buttons for that list. */
export function ItemRow({ item, children, show, tight }: { item: Item; children?: ReactNode; show?: Parameters<typeof Facts>[0]["show"]; tight?: boolean }) {
  const finished = item.status !== null && item.status !== "open";
  const quiet = tight && (item.tier === "back" || item.status === null);
  return (
    <div className={`row item-row ${finished ? "is-finished" : ""} ${tight ? "tight" : ""} ${quiet ? "is-quiet" : ""}`}>
      <Check item={item} />
      <A href={itemPath(item.id)} className="row-main">
        <span className="row-name">{item.title}</span>
        <Facts item={item} show={show} />
      </A>
      {children && <span className="row-actions">{children}</span>}
    </div>
  );
}
