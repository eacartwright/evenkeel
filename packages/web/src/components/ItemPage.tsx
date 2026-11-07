import { ENERGIES, ENERGY_LABEL, TIERS, TIER_LABEL, today, type Item } from "@evenkeel/shared";
import { useRef, useState } from "react";
import { createItem, move, remove, schedule, setNote, setStatus, update } from "../actions";
import { A, go } from "../router";
import { useData } from "../sync";
import { DraftInput, DraftTextarea, Field, NumberInput, Segmented, TitleInput } from "./controls";
import { Check, ItemRow, itemPath } from "./ItemRow";

/**
 * One item (DESIGN.md §5.5): a task, a project (it has steps) or a note, and any of them can
 * turn into another without moving. Everything saves as you go.
 */
export function ItemPage({ id }: { id: string }) {
  const { state, view } = useData();
  const item = state.items[id];
  if (!item)
    return (
      <div className="page">
        <p className="empty">Not found. It may still be on its way from another device.</p>
      </div>
    );
  const set = (change: Partial<Item>) => update(id, change);
  const up = view.ancestors(id);
  const steps = view.children(id);
  const isTask = item.status !== null;

  return (
    <div className="page item-page">
      {item.deleted && (
        <div className="deleted-bar">
          Deleted
          <span className="spacer" />
          <button className="btn" onClick={() => set({ deleted: false })}>
            Restore
          </button>
        </div>
      )}
      <div className="page-kind">
        {up.length ? (
          <span className="crumbs">
            {up.map((a) => (
              <span key={a.id} className="crumb">
                <A href={itemPath(a.id)} className="kind-link">
                  {a.title}
                </A>
                <span className="crumb-sep">›</span>
              </span>
            ))}
          </span>
        ) : (
          <A href={item.tier === "inbox" ? "/inbox" : "/all"} className="kind-link">
            {isTask ? TIER_LABEL[item.tier] : "Note"}
          </A>
        )}
      </div>
      <div className="title-row item-title">
        <Check item={item} />
        <TitleInput value={item.title} onCommit={(title) => set({ title })} required aria-label="Title" />
      </div>

      {isTask && (
        <div className="next-box">
          <label className="field-label" htmlFor="next-action">
            Next step
          </label>
          <DraftInput id="next-action" className="input" value={item.nextAction} onCommit={(nextAction) => set({ nextAction })} />
        </div>
      )}

      <div className="fields">
        <Field label="Kind">
          <Segmented value={isTask ? "task" : "note"} options={["task", "note"] as const} labels={{ task: "Task", note: "Note" }} clearable={false} onChange={(v) => setNote(id, v === "note")} />
        </Field>
        {isTask && (
          <Field label="Where">
            <Segmented value={item.tier} options={TIERS} labels={TIER_LABEL} clearable={false} onChange={(tier) => tier && set({ tier })} />
          </Field>
        )}
        <Field label="Area">
          <AreaInput item={item} areas={view.areas()} />
        </Field>
        {isTask && (
          <>
            <Field label="Deadline">
              <DateInput value={item.deadline} onChange={(deadline) => set({ deadline })} />
            </Field>
            <Field label="Planned for">
              <div className="inline">
                <DateInput value={item.scheduled} onChange={(scheduled) => set({ scheduled })} />
                {item.scheduled !== today() && (
                  <button className="btn" onClick={() => schedule(id)}>
                    Today
                  </button>
                )}
              </div>
            </Field>
            <Field label="Takes (min)">
              <NumberInput className="input narrow" value={item.estMinutes} onCommit={(estMinutes) => set({ estMinutes: estMinutes === null ? null : Math.round(estMinutes) })} />
            </Field>
            <Field label="Energy">
              <Segmented value={item.energy} options={ENERGIES} labels={ENERGY_LABEL} onChange={(energy) => set({ energy })} />
            </Field>
            <Field label="Waits on">
              <WaitsOn item={item} />
            </Field>
          </>
        )}
      </div>

      <section className="section">
        <div className="section-head">
          <h3>Notes</h3>
        </div>
        <DraftTextarea className="input body-input" aria-label="Notes" value={item.body} onCommit={(body) => set({ body })} />
      </section>

      <section className="section">
        <div className="section-head">
          <h3>
            Steps {steps.length > 0 && <span className="muted count">{`${view.progress(id).done}/${view.progress(id).total}`}</span>}
          </h3>
        </div>
        <div className="rows">
          {steps.map((s, n) => (
            <ItemRow key={s.id} item={s} show={{ path: false }}>
              <button className="btn icon subtle small-btn" aria-label={`Move “${s.title}” up`} disabled={n === 0} onClick={() => move(s.id, -1)}>
                ↑
              </button>
              <button className="btn icon subtle small-btn" aria-label={`Move “${s.title}” down`} disabled={n === steps.length - 1} onClick={() => move(s.id, 1)}>
                ↓
              </button>
            </ItemRow>
          ))}
        </div>
        <AddStep parentId={id} />
      </section>

      <div className="page-foot">
        {item.status === "open" && (
          <>
            <button className="btn" onClick={() => setStatus(id, "skipped")} title="Didn't do it this time, and that's fine">
              Skip
            </button>
            <button className="btn" onClick={() => setStatus(id, "dropped")} title="Not going to do it">
              Drop
            </button>
          </>
        )}
        {item.status !== null && item.status !== "open" && (
          <button className="btn" onClick={() => setStatus(id, "open")}>
            Open again
          </button>
        )}
        <span className="spacer" />
        {!item.deleted && (
          <button
            className="btn danger"
            onClick={() => {
              remove(id);
              go(up.length ? itemPath(up.at(-1)!.id) : item.tier === "inbox" ? "/inbox" : "/all");
            }}
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

function DateInput({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) {
  return (
    <span className="inline">
      <input className="input narrow date-input" type="date" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
      {value && (
        <button className="btn icon subtle" aria-label="Clear the date" onClick={() => onChange(null)}>
          ✕
        </button>
      )}
    </span>
  );
}

function AreaInput({ item, areas }: { item: Item; areas: string[] }) {
  return (
    <>
      <DraftInput className="input" list="area-list" value={item.area} onCommit={(area) => update(item.id, { area })} />
      <datalist id="area-list">
        {areas.map((a) => (
          <option key={a} value={a} />
        ))}
      </datalist>
    </>
  );
}

/** Steps are added one after another: Enter adds and the box stays ready for the next. */
function AddStep({ parentId }: { parentId: string }) {
  const [text, setText] = useState("");
  const ref = useRef<HTMLInputElement>(null);
  const add = () => {
    const t = text.trim();
    if (!t) return;
    createItem(t, { parentId });
    setText("");
    ref.current?.focus();
  };
  return (
    <div className="inline-add add-step">
      <input
        ref={ref}
        className="input grow"
        aria-label="New step"
        placeholder="Add a step"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && add()}
      />
      <button className="btn" disabled={!text.trim()} onClick={add}>
        Add
      </button>
    </div>
  );
}

/** What this waits on: open tasks, picked by name. A waiting task stays out of quick wins. */
function WaitsOn({ item }: { item: Item }) {
  const { view, state } = useData();
  const below = new Set(view.descendants(item.id).map((i) => i.id));
  const options = Object.values(state.items)
    .filter((i) => !i.deleted && i.status === "open" && i.id !== item.id && !below.has(i.id) && !item.blockedBy.includes(i.id))
    .sort((a, b) => a.title.localeCompare(b.title));
  return (
    <div className="stack waits-on">
      {item.blockedBy.map((b) => {
        const x = view.item(b);
        return (
          <span key={b} className="inline">
            {x ? (
              <A href={itemPath(b)} className={x.status === "open" ? "" : "muted"}>
                {x.status === "open" ? "⏸ " : "✓ "}
                {x.title}
              </A>
            ) : (
              <span className="muted">(deleted)</span>
            )}
            <button className="btn icon subtle" aria-label="Stop waiting on this" onClick={() => update(item.id, { blockedBy: item.blockedBy.filter((y) => y !== b) })}>
              ✕
            </button>
          </span>
        );
      })}
      <select className="select" aria-label="Add something this waits on" value="" onChange={(e) => e.target.value && update(item.id, { blockedBy: [...item.blockedBy, e.target.value] })}>
        <option value="">{item.blockedBy.length ? "Also waits on…" : "Nothing. Waits on…"}</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.title}
          </option>
        ))}
      </select>
    </div>
  );
}
