import { settingsOf } from "@evenkeel/shared";
import { useState } from "react";
import { saveSettings } from "../actions";
import { FONTS, fontChoice, loaded, setFont, type FontSlot } from "../fonts";
import { ALL_SANS } from "../fonts-sans";
import { useData } from "../sync";
import { setThemePref, themePref, type ThemePref } from "../theme";
import { Dialog } from "./Dialog";
import { DraftTextarea, Field, Segmented } from "./controls";

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

function Areas() {
  const { state } = useData();
  const areas = settingsOf(state).areas;
  return (
    <div className="fields">
      <Field label="Areas">
        <div className="stack">
          <DraftTextarea
            className="input"
            rows={8}
            value={areas.join("\n")}
            onCommit={(text) =>
              saveSettings({
                areas: text
                  .split("\n")
                  .map((a) => a.trim())
                  .filter(Boolean),
              })
            }
          />
          <span className="muted small">One per line, in the order they're offered. Things already in an area keep it if it's taken off the list.</span>
        </div>
      </Field>
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
