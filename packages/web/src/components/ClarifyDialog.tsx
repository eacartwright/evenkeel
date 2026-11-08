import { minutesLabel, type Answer, type Plan } from "@evenkeel/shared";
import { useEffect, useRef, useState } from "react";
import { applyPlan } from "../actions";
import { clarifyItem, money } from "../ai";
import { useData } from "../sync";
import { Dialog } from "./Dialog";

// Clarify (DESIGN.md §5.6): AI asks a few questions about an item and drafts a plan: a clearer
// title, a next step that takes no thinking, steps with estimates, what to have ready, and
// "find out" steps for what isn't known. Answering is optional ("Don't know" is an answer and
// becomes a find-out step); Redraft uses the answers. Everything is editable; nothing changes
// until Accept.

interface Reply {
  model?: string;
  costUsd?: number;
}

export function ClarifyDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const { state } = useData();
  const item = state.items[id];
  const [plan, setPlan] = useState<Plan | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState<Reply>({});
  /** Every question asked so far → the answer ("" = not answered yet), and "don't know". */
  const [answers, setAnswers] = useState<{ q: string; a: string; dunno: boolean }[]>([]);
  const spentTotal = useRef(0);

  const answered = (): Answer[] => answers.filter((x) => x.dunno || x.a.trim()).map((x) => ({ q: x.q, a: x.dunno ? "" : x.a.trim() }));

  const ask = async () => {
    setBusy(true);
    setError("");
    const r = await clarifyItem(id, answered());
    setBusy(false);
    if (r.error !== undefined) return setError(r.error);
    spentTotal.current += r.costUsd ?? 0;
    setReply({ model: r.model, costUsd: spentTotal.current });
    setPlan(r.plan);
    // New questions join the list; answered ones stay (with their answers).
    setAnswers((prev) => [...prev.filter((x) => x.dunno || x.a.trim()), ...r.plan.questions.filter((q) => !prev.some((x) => x.q === q)).map((q) => ({ q, a: "", dunno: false }))]);
  };
  useEffect(() => {
    void ask();
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!item) return null;
  const edit = (change: Partial<Plan>) => plan && setPlan({ ...plan, ...change });
  const open = answers.filter((x) => !x.dunno && !x.a.trim()).length;
  const newAnswers = answers.some((x) => x.dunno || x.a.trim());
  const total = plan?.steps.reduce((n, s) => n + (s.estMinutes ?? 0), 0) ?? 0;

  return (
    <Dialog title={`✨ Clarify: ${item.title}`} onClose={onClose} className="clarify">
      {!plan && busy && <p className="muted thinking">Thinking it through…</p>}
      {error && (
        <div className="notice">
          <p>{error}</p>
          <button className="btn" onClick={() => void ask()} disabled={busy}>
            Try again
          </button>
        </div>
      )}
      {answers.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h3>A few questions</h3>
          </div>
          <p className="muted small">Answer what you can, in a few words. Skip any; “Don't know” becomes a find-out step.</p>
          <ol className="questions">
            {answers.map((x, n) => (
              <li key={x.q}>
                <label className="question" htmlFor={`q-${n}`}>
                  {x.q}
                </label>
                <span className="inline">
                  <input
                    id={`q-${n}`}
                    className="input grow"
                    value={x.dunno ? "" : x.a}
                    disabled={x.dunno}
                    onChange={(e) => setAnswers(answers.map((y, i) => (i === n ? { ...y, a: e.target.value } : y)))}
                    onKeyDown={(e) => e.key === "Enter" && !busy && void ask()}
                  />
                  <button
                    className={`btn small-btn ${x.dunno ? "chip-on" : "subtle"}`}
                    aria-pressed={x.dunno}
                    onClick={() => setAnswers(answers.map((y, i) => (i === n ? { ...y, dunno: !y.dunno } : y)))}
                  >
                    Don't know
                  </button>
                </span>
              </li>
            ))}
          </ol>
          <div className="inline">
            <button className="btn" disabled={busy || !newAnswers} onClick={() => void ask()}>
              {busy ? "Redrafting…" : "Redraft with my answers"}
            </button>
            {open > 0 && newAnswers && <span className="muted small">{open} still open; that's fine</span>}
          </div>
        </section>
      )}

      {plan && (
        <section className="section plan">
          <div className="section-head">
            <h3>The plan</h3>
            {reply.model && <span className="muted small">{reply.costUsd !== undefined ? money(reply.costUsd) : ""}</span>}
          </div>
          <label className="field-label" htmlFor="plan-title">
            Title
          </label>
          <input id="plan-title" className="input" value={plan.title} onChange={(e) => edit({ title: e.target.value })} />
          <label className="field-label" htmlFor="plan-next">
            Next step
          </label>
          <input id="plan-next" className="input" value={plan.nextAction} onChange={(e) => edit({ nextAction: e.target.value })} />

          <h4 className="plan-head">
            Steps {total > 0 && <span className="muted small">about {minutesLabel(total)}</span>}
          </h4>
          {plan.steps.length === 0 && <p className="muted small">No steps needed.</p>}
          <ul className="plan-list">
            {plan.steps.map((s, n) => (
              <li key={n}>
                <input
                  className="input grow"
                  aria-label={`Step ${n + 1}`}
                  value={s.title}
                  onChange={(e) => edit({ steps: plan.steps.map((x, i) => (i === n ? { ...x, title: e.target.value } : x)) })}
                />
                <input
                  className="input narrow est-input"
                  aria-label={`Minutes for step ${n + 1}`}
                  inputMode="numeric"
                  value={s.estMinutes ?? ""}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    edit({ steps: plan.steps.map((x, i) => (i === n ? { ...x, estMinutes: e.target.value && v > 0 ? Math.round(v) : null } : x)) });
                  }}
                />
                <span className="muted small">min</span>
                <button className="btn icon subtle small-btn" aria-label={`Remove step “${s.title}”`} onClick={() => edit({ steps: plan.steps.filter((_, i) => i !== n) })}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
          <EditList label="Find out" hint="Added as steps." items={plan.unknowns} onChange={(unknowns) => edit({ unknowns })} />
          <EditList label="Have ready" hint="Added to the notes as a checklist." items={plan.haveReady} onChange={(haveReady) => edit({ haveReady })} />
        </section>
      )}

      <div className="page-foot">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <span className="spacer" />
        <button
          className="btn primary"
          disabled={!plan || busy}
          onClick={() => {
            if (!plan) return;
            applyPlan(id, plan, answered());
            onClose();
          }}
        >
          Accept
        </button>
      </div>
    </Dialog>
  );
}

function EditList({ label, hint, items, onChange }: { label: string; hint: string; items: string[]; onChange: (xs: string[]) => void }) {
  if (!items.length) return null;
  return (
    <>
      <h4 className="plan-head">
        {label} <span className="muted small">{hint}</span>
      </h4>
      <ul className="plan-list">
        {items.map((x, n) => (
          <li key={n}>
            <input className="input grow" aria-label={`${label} ${n + 1}`} value={x} onChange={(e) => onChange(items.map((y, i) => (i === n ? e.target.value : y)))} />
            <button className="btn icon subtle small-btn" aria-label={`Remove “${x}”`} onClick={() => onChange(items.filter((_, i) => i !== n))}>
              ✕
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
