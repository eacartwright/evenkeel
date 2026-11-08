import { dayLabel, ENERGIES, ENERGY_LABEL, lastDone, snoozed, newRepeat, REPEAT_UNITS, repeatLabel, repeatState, TIERS, TIER_LABEL, today, type Item, type Repeat, type RepeatUnit } from "@evenkeel/shared";
import { useRef, useState } from "react";
import { ClarifyDialog } from "./ClarifyDialog";
import { addArea, createItem, move, remove, schedule, setLastDone, setNote, setRepeat, setStatus, snooze, update } from "../actions";
import { A, go } from "../router";
import { useData } from "../sync";
import { DraftInput, DraftTextarea, Field, NumberInput, Picker, Segmented, TitleInput } from "./controls";
import { Check, ItemRow, itemPath, LaterButton } from "./ItemRow";

/**
 * One item (DESIGN.md §5.5): a task, a project (it has steps) or a note, and any of them can
 * turn into another without moving. Everything saves as you go.
 */
export function ItemPage({ id }: { id: string }) {
  const { state, view } = useData();
  const item = state.items[id];
  const [clarifying, setClarifying] = useState(false);
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
        <span className="spacer" />
        {!item.deleted && (
          <button className="btn small-btn clarify-btn" onClick={() => setClarifying(true)} title="AI asks a few questions, then proposes a clearer title, a next step and steps. Nothing changes until you accept.">
            ✨ Clarify
          </button>
        )}
      </div>
      {clarifying && <ClarifyDialog id={id} onClose={() => setClarifying(false)} />}
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

      {isTask && !item.repeat && !item.oneOff && !item.parentId && view.areaOf(item).toLowerCase() === "chores" && <HowOften id={id} />}

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
            <Field label="Repeats">
              <RepeatInput item={item} />
            </Field>
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
            <button className="btn" onClick={() => setStatus(id, "skipped")} title={item.repeat ? "Not this time: starts the clock again without counting as done" : "Didn't do it this time, and that's fine"}>
              {item.repeat ? "Skip this time" : "Skip"}
            </button>
            {item.repeat &&
              (snoozed(item) ? (
                <button className="btn" title={`Put off until ${dayLabel(item.snoozedUntil!)}`} onClick={() => snooze(id, null)}>
                  Back now
                </button>
              ) : (
                <LaterButton item={item} full />
              ))}
            <button className="btn" onClick={() => setStatus(id, "dropped")} title={item.repeat ? "Not doing it any more (it stops coming back)" : "Not going to do it"}>
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

const HOW_OFTEN: { label: string; every: number; unit: RepeatUnit }[] = [
  { label: "Weekly", every: 1, unit: "week" },
  { label: "Every 2 weeks", every: 2, unit: "week" },
  { label: "Monthly", every: 1, unit: "month" },
  { label: "Every 3 months", every: 3, unit: "month" },
];

/** In the Chores area, a quiet "How often?" (DESIGN.md §6.1): a suggestion, gone once answered. */
function HowOften({ id }: { id: string }) {
  return (
    <div className="how-often">
      <span className="how-often-q">How often does this come around?</span>
      <span className="how-often-picks">
        {HOW_OFTEN.map((p) => (
          <button key={p.label} className="btn small-btn" onClick={() => setRepeat(id, newRepeat("about", p.every, p.unit))}>
            {p.label}
          </button>
        ))}
        <button className="btn small-btn subtle" onClick={() => update(id, { oneOff: true })}>
          Doesn't repeat
        </button>
      </span>
    </div>
  );
}

const UNIT_LABEL: Record<RepeatUnit, [string, string]> = { day: ["day", "days"], week: ["week", "weeks"], month: ["month", "months"] };
const WEEKDAY_LETTER = ["S", "M", "T", "W", "T", "F", "S"];
const WEEKDAY_NAME = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** How it repeats (DESIGN.md §6.1): not at all, about every so often, or on a schedule. */
function RepeatInput({ item }: { item: Item }) {
  const r = item.repeat;
  const set = (change: Partial<Repeat>) => r && setRepeat(item.id, { ...r, ...change });
  const state = repeatState(item);
  return (
    <div className="stack repeat-input">
      <Segmented
        value={r ? r.kind : "no"}
        options={["no", "about", "on"] as const}
        labels={{ no: "No", about: "About every…", on: "On a schedule" }}
        clearable={false}
        onChange={(k) => {
          if (k === "no") setRepeat(item.id, null);
          else if (k && k !== r?.kind) setRepeat(item.id, newRepeat(k, r?.every ?? 1, r?.unit ?? "week"));
        }}
      />
      {r && (
        <>
          <span className="inline">
            Every
            <NumberInput
              className="input narrow every-input"
              aria-label="Every how many"
              inputMode="numeric"
              value={r.every}
              onCommit={(n) => n && n >= 1 && set({ every: Math.min(999, Math.round(n)) })}
            />
            <select
              className="select"
              aria-label="Days, weeks or months"
              value={r.unit}
              onChange={(e) => {
                const unit = e.target.value as RepeatUnit;
                setRepeat(item.id, { ...newRepeat(r.kind, r.every, unit), start: r.start });
              }}
            >
              {REPEAT_UNITS.map((u) => (
                <option key={u} value={u}>
                  {UNIT_LABEL[u][r.every === 1 ? 0 : 1]}
                </option>
              ))}
            </select>
          </span>
          {r.kind === "on" && r.unit === "week" && (
            <span className="weekdays" role="group" aria-label="On">
              {WEEKDAY_LETTER.map((l, d) => {
                const on = r.days.includes(d);
                return (
                  <button
                    key={d}
                    className={`weekday ${on ? "on" : ""}`}
                    aria-pressed={on}
                    aria-label={WEEKDAY_NAME[d]}
                    title={WEEKDAY_NAME[d]}
                    onClick={() => {
                      const days = on ? r.days.filter((x) => x !== d) : [...r.days, d];
                      if (days.length) set({ days });
                    }}
                  >
                    {l}
                  </button>
                );
              })}
            </span>
          )}
          {r.kind === "on" && r.unit === "month" && (
            <span className="inline">
              On day
              <NumberInput
                className="input narrow every-input"
                aria-label="Day of the month"
                inputMode="numeric"
                value={r.days[0] ?? null}
                onCommit={(n) => n && n >= 1 && set({ days: [Math.min(31, Math.round(n))] })}
              />
              <span className="muted small">31 = the last day</span>
            </span>
          )}
          {r.kind === "on" && (
            <span className="inline">
              Starting
              <DateInput label="Starting" clearable={false} value={r.start} onChange={(start) => start && set({ start })} />
            </span>
          )}
          <span className="inline">
            Last done
            <DateInput label="Last done" value={lastDone(item)} onChange={(day) => setLastDone(item.id, day)} />
            {lastDone(item) !== today() && (
              <button className="btn small-btn" onClick={() => setLastDone(item.id, today())}>
                Today
              </button>
            )}
          </span>
          <span className="muted small">
            {repeatLabel(r)}
            {state && ` · ${state.label}`}
            {r.kind === "about" && !lastDone(item) && " (so it's due now)"}
          </span>
        </>
      )}
    </div>
  );
}

function DateInput({ value, onChange, clearable = true, label }: { value: string | null; onChange: (v: string | null) => void; clearable?: boolean; label?: string }) {
  return (
    <span className="inline">
      <input className="input narrow date-input" type="date" aria-label={label} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)} />
      {value && clearable && (
        <button className="btn icon subtle" aria-label="Clear the date" onClick={() => onChange(null)}>
          ✕
        </button>
      )}
    </span>
  );
}

/** Pick an area (as foodlab picks a "Kind of"): typing filters; a new one only via "+ Add". */
function AreaInput({ item, areas }: { item: Item; areas: string[] }) {
  const value = areas.find((a) => a.toLowerCase() === item.area.toLowerCase()) ?? (item.area || null);
  const options = value && !areas.includes(value) ? [...areas, value] : areas;
  return (
    <Picker
      value={value}
      options={options.map((a) => ({ id: a, label: a }))}
      placeholder="No area"
      createLabel="Add the area"
      onCreate={addArea}
      onChange={(area) => update(item.id, { area: area ?? "" })}
    />
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
