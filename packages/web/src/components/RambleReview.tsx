import { FOUND_KIND_LABEL, FOUND_KINDS, TIER_SHORT, TIERS, dayLabel, minutesLabel, type Found, type FoundKind, type Tier } from "@evenkeel/shared";
import { keepFound } from "../actions";
import { money } from "../ai";
import { A } from "../router";
import { useData } from "../sync";
import { itemPath } from "./ItemRow";

// The review of a sorted ramble (DESIGN.md §5.6): each candidate to keep, edit or discard. Nothing
// is an item until Keep. The review is kept on this device (localStorage) until it's done, so
// closing the app doesn't lose it.

export interface Candidate extends Found {
  keep: boolean;
}

export interface Ramble {
  transcript: string;
  found: Candidate[];
  model?: string;
  costUsd?: number;
}

const KEY = "evenkeel:ramble";
export function loadRamble(): Ramble | null {
  try {
    const v = localStorage.getItem(KEY);
    return v ? (JSON.parse(v) as Ramble) : null;
  } catch {
    return null;
  }
}
export function saveRamble(r: Ramble | null) {
  try {
    if (r) localStorage.setItem(KEY, JSON.stringify(r));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage blocked: the review lives until the page closes.
  }
}

export function RambleReview({ ramble, onChange, onBack }: { ramble: Ramble; onChange: (r: Ramble | null) => void; onBack: (text: string) => void }) {
  const { view } = useData();
  const areas = view.areas();
  const set = (n: number, change: Partial<Candidate>) => onChange({ ...ramble, found: ramble.found.map((f, i) => (i === n ? { ...f, ...change } : f)) });
  const kept = ramble.found.filter((f) => f.keep && f.title.trim());
  const keep = () => {
    keepFound(kept.map(({ keep: _, ...f }) => ({ ...f, title: f.title.trim(), steps: f.steps.map((s) => s.trim()).filter(Boolean) })));
    onChange(null);
  };

  return (
    <section className="section ramble-review" aria-label="Sorted from your ramble">
      <div className="section-head">
        <h3>
          ✨ Found {ramble.found.length} {ramble.found.length === 1 ? "thing" : "things"}
        </h3>
        {ramble.model && <span className="muted small">{ramble.costUsd !== undefined ? money(ramble.costUsd) : ""}</span>}
      </div>
      {ramble.found.length === 0 ? (
        <p className="muted">Nothing to keep in that. Edit it and try again, or add it line by line.</p>
      ) : (
        <p className="muted small">Untick what you don't want, fix anything that's off, then Keep. Steps stay with their item.</p>
      )}
      <div className="candidates">
        {ramble.found.map((f, n) => {
          const dup = f.duplicateOf ? view.item(f.duplicateOf) : undefined;
          return (
            <div key={n} className={`candidate ${f.keep ? "" : "is-off"}`}>
              <div className="candidate-head">
                <input type="checkbox" className="candidate-keep" checked={f.keep} aria-label={`Keep “${f.title}”`} onChange={(e) => set(n, { keep: e.target.checked })} />
                <input className="input grow" aria-label="Title" value={f.title} onChange={(e) => set(n, { title: e.target.value })} />
              </div>
              <div className="candidate-facts">
                <select className="select small" aria-label="Kind" value={f.kind} onChange={(e) => set(n, { kind: e.target.value as FoundKind })}>
                  {FOUND_KINDS.map((k) => (
                    <option key={k} value={k}>
                      {FOUND_KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                {f.kind !== "note" && (
                  <select className="select small" aria-label="Where" value={f.tier} onChange={(e) => set(n, { tier: e.target.value as Tier })}>
                    {TIERS.map((t) => (
                      <option key={t} value={t}>
                        {TIER_SHORT[t]}
                      </option>
                    ))}
                  </select>
                )}
                <select className="select small" aria-label="Area" value={f.area} onChange={(e) => set(n, { area: e.target.value })}>
                  <option value="">No area</option>
                  {areas.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </select>
                {f.deadline && (
                  <span className="chip">
                    due {dayLabel(f.deadline)}
                    <button className="chip-remove" aria-label="No deadline" onClick={() => set(n, { deadline: null, tier: f.tier === "hard" ? "chip" : f.tier })}>
                      ✕
                    </button>
                  </span>
                )}
                {f.estMinutes && <span className="chip">{minutesLabel(f.estMinutes)}</span>}
              </div>
              {dup && (
                <p className="small candidate-dup">
                  Looks like one you have: <A href={itemPath(dup.id)}>{dup.title}</A>
                </p>
              )}
              {f.quote && <p className="small muted candidate-quote">“{f.quote}”</p>}
              {f.steps.length > 0 && (
                <ul className="plan-list">
                  {f.steps.map((s, i) => (
                    <li key={i}>
                      <input
                        className="input grow"
                        aria-label={`Step ${i + 1}`}
                        value={s}
                        onChange={(e) => set(n, { steps: f.steps.map((x, j) => (j === i ? e.target.value : x)) })}
                      />
                      <button className="btn icon subtle small-btn" aria-label={`Remove step “${s}”`} onClick={() => set(n, { steps: f.steps.filter((_, j) => j !== i) })}>
                        ✕
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <div className="capture-bar">
        <button className="btn" onClick={() => onBack(ramble.transcript)} title="Back to the text, to change it and sort again">
          Edit the text
        </button>
        <button className="btn subtle" onClick={() => onChange(null)}>
          Discard all
        </button>
        <span className="spacer" />
        <button className="btn primary" disabled={!kept.length} onClick={keep}>
          Keep {kept.length || ""}
        </button>
      </div>
    </section>
  );
}

/** Fresh candidates: kept unless they look like something already there. */
export const candidates = (found: Found[]): Candidate[] => found.map((f) => ({ ...f, keep: !f.duplicateOf }));
