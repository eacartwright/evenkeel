import { TIER_LABEL } from "@evenkeel/shared";
import { setQuery, useRoute } from "../router";
import { useData } from "../sync";
import { ItemRow } from "./ItemRow";

/**
 * Everything filed (DESIGN.md §5.4): hard dates first (soonest first), then chipping away, back
 * burner, and notes. Search looks in steps too. Filters live in the address, so Back keeps them.
 */
export function AllPage() {
  const { view } = useData();
  const { query } = useRoute();
  const q = query.get("q") ?? "";
  const area = query.get("area") ?? "";
  const withDone = query.get("done") === "1";
  const groups = view.all({ q, area, withDone });
  const areas = view.areas();
  return (
    <div className="page">
      <div className="list-head">
        <h1 className="page-title">All</h1>
      </div>
      <div className="list-filters">
        <input className="input grow" type="search" aria-label="Search" placeholder="Search" value={q} onChange={(e) => setQuery({ q: e.target.value })} />
        <select className="select" aria-label="Area" value={area} onChange={(e) => setQuery({ area: e.target.value })}>
          <option value="">All areas</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" checked={withDone} onChange={(e) => setQuery({ done: e.target.checked ? "1" : null })} />
          Finished too
        </label>
      </div>
      {groups.length === 0 && <p className="empty">{q || area ? "Nothing matches." : "Nothing filed yet. File things from the inbox."}</p>}
      {groups.map((g) => (
        <section key={g.tier} className="section">
          <div className="section-head">
            <h3>
              {g.tier === "notes" ? "Notes" : TIER_LABEL[g.tier]} <span className="muted count">{g.items.length}</span>
            </h3>
          </div>
          <div className="rows">
            {g.items.map((i) => (
              <ItemRow key={i.id} item={i} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
