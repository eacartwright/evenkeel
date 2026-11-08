import { addDays, dayLabel, minutesLabel, repeatLabel, repeatState, snoozed, today, type Item } from "@evenkeel/shared";
import { useState, type ReactNode } from "react";
import { snooze, toggleDone, whenLabel } from "../actions";
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

const LATER: { label: string; days: number }[] = [
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
];

/**
 * Later (DESIGN.md §6.1): opens into Tomorrow · In 3 days · Next week; picking one puts it off
 * till then. Small in a list row; `full` matches the buttons beside it on an item's page.
 */
export function LaterButton({ item, full = false }: { item: Item; full?: boolean }) {
  const [open, setOpen] = useState(false);
  const size = full ? "btn" : "btn small-btn";
  if (!open)
    return (
      <button className={full ? "btn" : "btn small-btn subtle"} title="Not today: back in a few days, without counting as done or skipped" aria-expanded={false} onClick={() => setOpen(true)}>
        Later
      </button>
    );
  return (
    <span className="later-picks" role="group" aria-label={`Later: ${item.title}`}>
      {LATER.map((l) => (
        <button
          key={l.days}
          className={size}
          onClick={() => {
            setOpen(false);
            snooze(item.id, addDays(today(), l.days));
          }}
        >
          {l.label}
        </button>
      ))}
      <button className={`btn icon subtle ${full ? "" : "small-btn"}`} aria-label="Never mind" onClick={() => setOpen(false)}>
        ✕
      </button>
    </span>
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
  const r = item.status === "open" ? repeatState(item, now) : null;
  if (r && item.repeat)
    parts.push(
      <span key="repeat" className="fact-repeat" title={repeatLabel(item.repeat)}>
        ↻ {r.label}
        {r.ratio !== null && (
          <span className="fresh-bar" aria-hidden="true">
            <span style={{ width: `${Math.min(1, r.ratio) * 100}%` }} className={r.due ? "is-due" : r.soon ? "is-soon" : ""} />
          </span>
        )}
      </span>,
    );
  if (item.status === "open" && snoozed(item, now)) parts.push(<span key="later">later: back {whenLabel(item.snoozedUntil!)}</span>);
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
