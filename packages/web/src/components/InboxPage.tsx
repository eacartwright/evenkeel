import { FILED_TIERS, TIER_LABEL, TIER_SHORT, type Item } from "@evenkeel/shared";
import { file, remove, update } from "../actions";
import { A } from "../router";
import { useData } from "../sync";
import { ItemRow } from "./ItemRow";

/**
 * The inbox (DESIGN.md §5.2): everything captured and not yet filed, in the order captured. Filing is one
 * tap: a tier, or Note for something to keep that isn't a task. An area can be picked on the way.
 */
export function InboxPage() {
  const { view } = useData();
  const items = view.inbox();
  return (
    <div className="page">
      <h1 className="page-title">Inbox</h1>
      {items.length === 0 ? (
        <div className="empty">
          <p>Nothing waiting. Everything's been put somewhere.</p>
          <A href="/" className="btn">
            Capture something
          </A>
        </div>
      ) : (
        <>
          <p className="lede muted">
            File each one: <strong>Hard</strong> has a real date, <strong>Chip</strong> is worked at over time, <strong>Back</strong> is someday. <strong>Note</strong> keeps it without making it a task.
          </p>
          <div className="rows inbox-rows">
            {items.map((i) => (
              <InboxRow key={i.id} item={i} areas={view.areas()} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function InboxRow({ item, areas }: { item: Item; areas: string[] }) {
  return (
    <div className="inbox-item">
      <ItemRow item={item} show={{ area: false }}>
        <button className="btn icon subtle" aria-label={`Delete “${item.title}”`} title="Delete" onClick={() => remove(item.id)}>
          🗑
        </button>
      </ItemRow>
      <div className="file-bar" role="group" aria-label={`File “${item.title}”`}>
        {FILED_TIERS.map((t) => (
          <button key={t} className="btn small-btn" title={TIER_LABEL[t]} onClick={() => file(item.id, t)}>
            {TIER_SHORT[t]}
          </button>
        ))}
        <button className="btn small-btn" title="Keep it as a note" onClick={() => file(item.id, "note")}>
          Note
        </button>
        <select
          className="select small area-select"
          aria-label="Area"
          value={item.area}
          onChange={(e) => update(item.id, { area: e.target.value })}
        >
          <option value="">Area…</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
