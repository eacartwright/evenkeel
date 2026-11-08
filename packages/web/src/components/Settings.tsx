import { AI_MODELS, AI_PROVIDERS, aiOf, KEY_NAMES, modelLabel, PROVIDER_NAMES, type AiSettings, type AiUsage } from "@evenkeel/shared";
import { useEffect, useState } from "react";
import { addArea, deleteArea, moveArea, renameArea, saveSettings } from "../actions";
import { money } from "../ai";
import { FONTS, fontChoice, loaded, setFont, type FontSlot } from "../fonts";
import { ALL_SANS } from "../fonts-sans";
import { data, useData } from "../sync";
import { setThemePref, themePref, type ThemePref } from "../theme";
import { Dialog } from "./Dialog";
import { DraftInput, Field, NumberInput, Segmented } from "./controls";

// Settings (DESIGN.md §5.7): sections down the side, as in foodlab, so there's room for more.
// Areas are app-wide (the settings record); Colors and fonts are per device. Things being tried
// out go under Experimental.

const SECTIONS = [
  { id: "general", label: "General", icon: "⚙️" },
  { id: "areas", label: "Areas", icon: "🗂️" },
  { id: "ai", label: "AI", icon: "✨" },
  { id: "experimental", label: "Experimental", icon: "🔬" },
] as const;
type Section = (typeof SECTIONS)[number]["id"];
const LAST = "evenkeel:settings-section";

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { state } = useData();
  const [section, setSection] = useState<Section>(() => {
    try {
      const s = localStorage.getItem(LAST) as Section | null;
      if (s && SECTIONS.some((x) => x.id === s)) return s;
    } catch {
      // Storage blocked: start at General.
    }
    return "general";
  });
  const pick = (s: Section) => {
    setSection(s);
    try {
      localStorage.setItem(LAST, s);
    } catch {
      // Not remembered; fine.
    }
  };
  return (
    <Dialog title="Settings" onClose={onClose} className="settings">
      <div className="settings-layout">
        <nav className="settings-nav" role="tablist" aria-orientation="vertical" aria-label="Settings sections">
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              role="tab"
              id={`settings-tab-${s.id}`}
              aria-selected={section === s.id}
              aria-controls="settings-panel"
              className={section === s.id ? "on" : ""}
              onClick={() => pick(s.id)}
            >
              <span className="settings-icon">{s.icon}</span>
              {s.label}
            </button>
          ))}
        </nav>
        <div id="settings-panel" role="tabpanel" aria-labelledby={`settings-tab-${section}`} className="settings-panel">
          {section === "general" ? <General /> : section === "areas" ? <Areas /> : section === "ai" ? <AiSection /> : <Experimental />}
        </div>
      </div>
      <p className="muted small settings-foot">Evenkeel · rev {state.rev}</p>
    </Dialog>
  );
}

function General() {
  const [theme, setTheme] = useState<ThemePref>(themePref());
  return (
    <div className="fields">
      <Field label="Colors">
        <Segmented
          value={theme}
          options={["system", "light", "dark"] as const}
          labels={{ system: "System", light: "Light", dark: "Dark" }}
          clearable={false}
          onChange={(v) => {
            if (!v) return;
            setTheme(v);
            setThemePref(v);
          }}
        />
        <p className="muted small">This device only.</p>
      </Field>
    </div>
  );
}

/**
 * The areas (DESIGN.md §5.7): rename one (its items follow; onto another name merges them),
 * reorder, delete (its items stay, with no area; Undo), or add one. Every area in use is here,
 * listed or not (one typed by mistake can be merged or deleted); reordering saves them all.
 */
function Areas() {
  const { state, view } = useData();
  const all = view.areas();
  const [name, setName] = useState("");
  const count = (a: string) => Object.values(state.items).filter((i) => !i.deleted && !i.parentId && i.area.toLowerCase() === a.toLowerCase()).length;
  const add = () => {
    if (!name.trim()) return;
    addArea(name);
    setName("");
  };
  return (
    <div className="stack">
      <p className="muted small">In the order they're offered. Renaming one renames it on everything in it.</p>
      <ul className="area-list">
        {all.map((a, at) => {
          const n = count(a);
          return (
            <li key={a}>
              <DraftInput className="input grow" aria-label={`Area name: ${a}`} value={a} required onCommit={(to) => renameArea(a, to)} />
              <span className="muted small area-count">
                {n} item{n === 1 ? "" : "s"}
              </span>
              <button className="btn icon subtle small-btn" aria-label={`Move “${a}” up`} disabled={at === 0} onClick={() => moveArea(a, -1)}>
                ↑
              </button>
              <button className="btn icon subtle small-btn" aria-label={`Move “${a}” down`} disabled={at === all.length - 1} onClick={() => moveArea(a, 1)}>
                ↓
              </button>
              <button className="btn icon subtle small-btn" aria-label={`Delete the area “${a}”`} title="Delete (its items stay, with no area)" onClick={() => deleteArea(a)}>
                ✕
              </button>
            </li>
          );
        })}
      </ul>
      <div className="inline">
        <input
          className="input grow"
          aria-label="New area"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") add();
          }}
        />
        <button className="btn" disabled={!name.trim()} onClick={add}>
          Add
        </button>
      </div>
    </div>
  );
}

// ---- AI (DESIGN.md §5.6), foodlab's section: models, this month's cost, the cap, alerts ----

const ALERT_CHOICES = [50, 75, 90];
const tokensK = (n: number) => (n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n));

function AiSection() {
  const { state } = useData();
  const ai = aiOf(state);
  const [use, setUse] = useState<AiUsage | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/ai")
      .then((r) => r.json() as Promise<AiUsage>)
      .then(setUse)
      .catch(() => setError("Couldn't reach Evenkeel (offline?)"));
  }, []);
  const saveAi = (patch: Partial<AiSettings>) => saveSettings({ ai: { ...aiOf(data().state), ...patch } });
  const models = (id: string, value: string, key: "model" | "fastModel", withOff: boolean) => (
    <select id={id} className="select" value={value} onChange={(e) => saveAi({ [key]: e.target.value })}>
      {withOff && <option value="off">Off</option>}
      {AI_PROVIDERS.map((p) => {
        const on = !use || use.providers.includes(p);
        return (
          <optgroup key={p} label={`${PROVIDER_NAMES[p]}${on ? "" : " (no key)"}`}>
            {AI_MODELS.filter((m) => m.provider === p).map((m) => (
              <option key={m.id} value={m.id} disabled={!on && m.id !== value}>
                {m.label} · ${m.input} in / ${m.output} out per M tokens
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );

  return (
    <div className="fields ai-settings">
      {use && !use.providers.length && (
        <p className="notice">
          No API key on the server yet: add <code>ANTHROPIC_API_KEY=…</code> and/or <code>OPENAI_API_KEY=…</code> to <code>.env</code> beside the app and restart it.
          Until then ✨ Sort and ✨ Clarify say so instead of working.
        </p>
      )}
      {error && <p className="notice">{error}</p>}
      <Field label="Clarify" htmlFor="ai-model">
        {models("ai-model", ai.model, "model", true)}
        <p className="muted small">Questions and a plan for one item. Worth a stronger model. Off turns all AI off.</p>
      </Field>
      {ai.model !== "off" && (
        <Field label="Sort a ramble" htmlFor="ai-fast">
          {models("ai-fast", ai.fastModel, "fastModel", false)}
          <p className="muted small">Pulling items out of a ramble. A fast, cheap one does it well.</p>
        </Field>
      )}
      {use && (
        <p className="small ai-keys">
          {AI_PROVIDERS.map((p) => (
            <span key={p} className={use.providers.includes(p) ? "" : "muted"}>
              {use.providers.includes(p) ? "●" : "○"} {PROVIDER_NAMES[p]}
              {use.providers.includes(p) ? "" : ` (no ${KEY_NAMES[p]})`}
            </span>
          ))}
          <span className={use.transcribe ? "" : "muted"}>
            {use.transcribe ? "●" : "○"} 🎙 Voice{use.transcribe ? "" : " (needs OPENAI_API_KEY)"}
          </span>
        </p>
      )}
      <Field label="This month">{use ? <Spend use={use} ai={ai} /> : !error && <p className="muted small">Loading…</p>}</Field>
      <Field label="Monthly cap">
        <div className="inline">
          <span>$</span>
          <NumberInput className="input narrow" value={ai.monthlyLimitUsd} aria-label="Monthly cap in dollars" onCommit={(monthlyLimitUsd) => saveAi({ monthlyLimitUsd })} />
        </div>
        <p className="muted small">Past it, no more AI calls until next month. Empty = no cap.</p>
      </Field>
      <Field label="Alerts at">
        <div className="chips">
          {ALERT_CHOICES.map((p) => {
            const on = ai.alertsAt.includes(p);
            return (
              <button
                key={p}
                className={`chip ${on ? "chip-on" : ""}`}
                aria-pressed={on}
                onClick={() => saveAi({ alertsAt: on ? ai.alertsAt.filter((x) => x !== p) : [...ai.alertsAt, p].sort((a, b) => a - b) })}
              >
                {p}%
              </button>
            );
          })}
        </div>
      </Field>
    </div>
  );
}

function Spend({ use, ai }: { use: AiUsage; ai: AiSettings }) {
  const cap = ai.monthlyLimitUsd;
  const pct = cap ? use.costUsd / cap : 0;
  const level = !cap ? "" : pct >= 1 ? "over" : ai.alertsAt.some((a) => pct * 100 >= a) ? "warn" : "";
  return (
    <div className="stack-sm">
      <div className="spend-head">
        <strong className="spend-total">{money(use.costUsd)}</strong>
        <span className="muted small">est.</span>
        <span className="muted">
          {cap ? ` of $${cap.toFixed(2)} · ${Math.round(pct * 100)}%` : " (no cap)"}
          {level === "over" && " · cap reached, AI paused"}
        </span>
      </div>
      {cap !== null && cap > 0 && (
        <div className={`meter ${level}`} role="meter" aria-valuemin={0} aria-valuemax={cap} aria-valuenow={use.costUsd} aria-label="Spent this month">
          <div className="meter-fill" style={{ width: `${Math.min(pct, 1) * 100}%` }} />
        </div>
      )}
      <p className="small muted">
        {use.calls} call{use.calls === 1 ? "" : "s"} · {tokensK(use.tokens.input)} tokens in · {tokensK(use.tokens.output)} out
      </p>
      {use.recent.length > 0 && (
        <details>
          <summary className="small">Recent calls</summary>
          <ul className="recent-calls small">
            {use.recent.map((r) => (
              <li key={r.at}>
                <span className="muted">{new Date(r.at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> {modelLabel(r.model)} · {r.purpose} ·{" "}
                {money(r.costUsd)}
                {!r.ok && <span className="muted"> · {r.note || "failed"}</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/** Being tried out: may change or go away. */
function Experimental() {
  return (
    <div className="fields">
      <p className="muted small">Things being tried out. They may change or go away.</p>
      <FontSetting slot="header" label="Header font" />
      <FontSetting slot="app" label="App font" />
    </div>
  );
}

/** TEMPORARY: try Google Fonts (fonts.ts, as in foodlab and sideshow). Arrow keys in the dropdown apply each one live. */
function FontSetting({ slot, label }: { slot: FontSlot; label: string }) {
  const [family, setFamily] = useState(() => fontChoice(slot));
  const [missing, setMissing] = useState(false);
  return (
    <Field label={label} htmlFor={`font-${slot}`}>
      <select
        id={`font-${slot}`}
        className="select"
        value={family}
        onChange={async (e) => {
          const f = e.target.value;
          setFamily(f);
          setMissing(false);
          const ok = await setFont(slot, f);
          if (fontChoice(slot) === f) setMissing(!ok);
        }}
      >
        <option value="">{slot === "app" ? "Bricolage Grotesque (default)" : "Unbounded (default)"}</option>
        <option value="system-ui">System font</option>
        <optgroup label="Picks (from sideshow)">
          {FONTS.map((f) => (
            <option key={f} value={f}>
              {f}
              {loaded.get(f) === false ? " (not on Google Fonts)" : ""}
            </option>
          ))}
        </optgroup>
        <optgroup label={`All ${ALL_SANS.length} sans-serif, most popular first`}>
          {ALL_SANS.filter((f) => !FONTS.includes(f)).map((f) => (
            <option key={f} value={f}>
              {f}
              {loaded.get(f) === false ? " (couldn't load)" : ""}
            </option>
          ))}
        </optgroup>
      </select>
      {missing && <p className="warn small">Google Fonts doesn't have “{family}”; showing the system font.</p>}
      {slot === "app" && <p className="muted small">This device only. Focus the list and use the arrow keys to flip through them.</p>}
    </Field>
  );
}
