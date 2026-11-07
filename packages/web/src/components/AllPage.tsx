import { NO_AREA, TIER_LABEL, today, type Item, type View } from "@evenkeel/shared";
import { useState, type CSSProperties } from "react";
import { schedule } from "../actions";
import { A, setQuery, useRoute } from "../router";
import { useData } from "../sync";
import { Segmented } from "./controls";
import { Check, Facts, ItemRow, itemPath } from "./ItemRow";

// Trying out ways to look at everything (DESIGN.md §5.4): which view stays gets decided by use.
const VIEWS = ["three", "areas", "board", "list"] as const;
type ViewName = (typeof VIEWS)[number];
const VIEW_LABEL: Record<ViewName, string> = { three: "Three", areas: "Areas", board: "Board", list: "List" };
const VIEW_KEY = "evenkeel:allview";
const SKIP_KEY = "evenkeel:skipped";

function stored(storage: () => Storage, key: string): string | null {
  try {
    return storage().getItem(key);
  } catch {
    return null; // Storage blocked: fall back to the default.
  }
}
function store(storage: () => Storage, key: string, value: string) {
  try {
    storage().setItem(key, value);
  } catch {
    // Storage blocked: it just isn't remembered.
  }
}

const isView = (v: string | null): v is ViewName => VIEWS.includes(v as ViewName);
const local = () => localStorage;
const session = () => sessionStorage;

const areaStyle = (view: View, area: string) => {
  const n = view.areaColor(area);
  return (n === null ? {} : { "--area": `var(--area-${n})` }) as CSSProperties;
};

/** An area's color and name, so a category can be seen at a glance. */
function AreaTag({ area }: { area: string }) {
  const { view } = useData();
  return (
    <span className="area-tag" style={areaStyle(view, area)}>
      <span className="area-dot" />
      {area || "No area"}
    </span>
  );
}

/** Everything filed, in whichever view is being tried. Filters and view live in the address, so Back keeps them. */
export function AllPage() {
  const { query } = useRoute();
  const asked = query.get("v");
  const saved = stored(local, VIEW_KEY);
  const current: ViewName = isView(asked) ? asked : isView(saved) ? saved : "areas";
  const choose = (v: ViewName | null) => {
    if (!v) return;
    store(local, VIEW_KEY, v);
    setQuery({ v });
  };
  return (
    <div className={current === "three" ? "page" : "page full"}>
      <div className="all-head">
        <h1 className="page-title">All</h1>
        <Segmented label="View" value={current} options={VIEWS} labels={VIEW_LABEL} clearable={false} onChange={choose} />
      </div>
      {current === "three" ? <ThreeView /> : current === "areas" ? <AreasView /> : current === "board" ? <BoardView /> : <ListView />}
    </div>
  );
}

function AreaSelect() {
  const { view } = useData();
  const { query } = useRoute();
  const groups = view.byArea();
  return (
    <select className="select" aria-label="Area" value={query.get("area") ?? ""} onChange={(e) => setQuery({ area: e.target.value })}>
      <option value="">All areas</option>
      {groups.map((g) => (
        <option key={g.area} value={g.area || NO_AREA}>
          {g.area || "No area"}
        </option>
      ))}
    </select>
  );
}

function Filters({ areas = true }: { areas?: boolean }) {
  const { query } = useRoute();
  return (
    <div className="list-filters">
      <input className="input grow" type="search" aria-label="Search" placeholder="Search" value={query.get("q") ?? ""} onChange={(e) => setQuery({ q: e.target.value })} />
      {areas && <AreaSelect />}
      <label className="check">
        <input type="checkbox" checked={query.get("done") === "1"} onChange={(e) => setQuery({ done: e.target.checked ? "1" : null })} />
        Finished too
      </label>
    </div>
  );
}

const useFilter = () => {
  const { query } = useRoute();
  return { q: query.get("q") ?? "", area: query.get("area") ?? "", withDone: query.get("done") === "1" };
};

/** Tight rows; a back-burner one is quieter. */
function Tight({ item, withArea }: { item: Item; withArea?: boolean }) {
  return (
    <ItemRow item={item} tight show={{ area: false, path: false }}>
      {withArea && item.area ? <AreaTag area={item.area} /> : null}
    </ItemRow>
  );
}

const Empty = ({ filtered }: { filtered: boolean }) => <p className="empty">{filtered ? "Nothing matches." : "Nothing filed yet. File things from the inbox."}</p>;

/** Three things, and only three: nothing about how many others there are. */
function ThreeView() {
  const { view } = useData();
  const { query } = useRoute();
  const area = query.get("area") ?? "";
  const [skipped, setSkipped] = useState<string[]>(() => {
    try {
      return JSON.parse(stored(session, SKIP_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const picks = view.pick(today(), 3, area, skipped);
  const pool = view.doable(area).length;
  const swap = (id: string) => {
    // Once everything has been passed over, start the round again.
    const next = skipped.length + 1 >= pool ? [id] : [...skipped, id];
    setSkipped(next);
    store(session, SKIP_KEY, JSON.stringify(next));
  };
  return (
    <>
      <div className="list-filters">
        <AreaSelect />
      </div>
      {picks.length === 0 && <p className="empty">Nothing to pick from here.</p>}
      <div className="three">
        {picks.map((i) => {
          const up = view.ancestors(i.id);
          return (
            <div key={i.id} className="three-card" style={areaStyle(view, view.areaOf(i))}>
              <Check item={i} />
              <div className="three-main">
                <A href={itemPath(i.id)} className="three-title">
                  {i.title}
                </A>
                <div className="three-facts">
                  <AreaTag area={view.areaOf(i)} />
                  {up.length > 0 && <span className="muted small">{up.map((a) => a.title).join(" › ")}</span>}
                  <Facts item={i} show={{ area: false, path: false }} />
                </div>
                <div className="three-actions">
                  {pool > 3 && (
                    <button className="btn small-btn subtle" onClick={() => swap(i.id)}>
                      Something else
                    </button>
                  )}
                  <button className="btn small-btn subtle" disabled={i.scheduled === today()} onClick={() => schedule(i.id)}>
                    {i.scheduled === today() ? "On Today" : "Plan for Today"}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** A tile per category; one open at a time, so only that one's list is on screen. */
function AreasView() {
  const { view } = useData();
  const f = useFilter();
  const groups = view.byArea({ q: f.q, withDone: f.withDone });
  const open = f.area ? groups.filter((g) => (f.area === NO_AREA ? !g.area : g.area.toLowerCase() === f.area.toLowerCase())) : f.q ? groups : [];
  return (
    <>
      <Filters areas={false} />
      {groups.length === 0 && <Empty filtered={!!f.q} />}
      <div className="area-tiles">
        {groups.map((g) => {
          const value = g.area || NO_AREA;
          const on = f.area.toLowerCase() === value.toLowerCase();
          return (
            <button key={value} className={`area-tile ${on ? "on" : ""}`} aria-pressed={on} style={areaStyle(view, g.area)} onClick={() => setQuery({ area: on ? null : value })}>
              <span className="area-tile-name">{g.area || "No area"}</span>
              <span className="area-tile-count">{g.items.length}</span>
            </button>
          );
        })}
      </div>
      {open.map((g) => (
        <section key={g.area} className="section tight-section">
          <AreaHead area={g.area} count={g.items.length} />
          <div className="rows tight-grid">
            {g.items.map((i) => (
              <Tight key={i.id} item={i} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}

function AreaHead({ area, count }: { area: string; count: number }) {
  const { view } = useData();
  return (
    <h3 className="area-head" style={areaStyle(view, area)}>
      {area || "No area"} <span className="muted count">{count}</span>
    </h3>
  );
}

/** Every category at once, in columns across the whole width. */
function BoardView() {
  const f = useFilter();
  const { view } = useData();
  const groups = view.byArea(f);
  return (
    <>
      <Filters />
      {groups.length === 0 && <Empty filtered={!!(f.q || f.area)} />}
      <div className="board">
        {groups.map((g) => (
          <section key={g.area} className="board-col">
            <AreaHead area={g.area} count={g.items.length} />
            <div className="rows">
              {g.items.map((i) => (
                <Tight key={i.id} item={i} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

/** By tier, as before: hard dates, chipping away, back burner, notes. */
function ListView() {
  const f = useFilter();
  const { view } = useData();
  const groups = view.all(f);
  return (
    <>
      <Filters />
      {groups.length === 0 && <Empty filtered={!!(f.q || f.area)} />}
      {groups.map((g) => (
        <section key={g.tier} className="section tight-section">
          <div className="section-head">
            <h3>
              {g.tier === "notes" ? "Notes" : TIER_LABEL[g.tier]} <span className="muted count">{g.items.length}</span>
            </h3>
          </div>
          <div className="rows tight-grid">
            {g.items.map((i) => (
              <Tight key={i.id} item={i} withArea />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
