import { useState } from "react";
import { addArea, deleteArea, moveArea, renameArea } from "../actions";
import { FONTS, fontChoice, loaded, setFont, type FontSlot } from "../fonts";
import { ALL_SANS } from "../fonts-sans";
import { useData } from "../sync";
import { setThemePref, themePref, type ThemePref } from "../theme";
import { Dialog } from "./Dialog";
import { DraftInput, Field, Segmented } from "./controls";

// Settings (DESIGN.md §5.7): sections down the side, as in foodlab, so there's room for more.
// Areas are app-wide (the settings record); Colors and fonts are per device. Things being tried
// out go under Experimental.

const SECTIONS = [
  { id: "general", label: "General", icon: "⚙️" },
  { id: "areas", label: "Areas", icon: "🗂️" },
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
          {section === "general" ? <General /> : section === "areas" ? <Areas /> : <Experimental />}
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
