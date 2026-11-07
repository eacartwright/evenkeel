import { settingsOf } from "@evenkeel/shared";
import { useState } from "react";
import { saveSettings } from "../actions";
import { useData } from "../sync";
import { setThemePref, themePref, type ThemePref } from "../theme";
import { Dialog } from "./Dialog";
import { DraftTextarea, Field, Segmented } from "./controls";

/** Settings (DESIGN.md §5.7): colors are per device; areas are app-wide. */
export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { state } = useData();
  const [theme, setTheme] = useState<ThemePref>(themePref());
  const areas = settingsOf(state).areas;
  return (
    <Dialog title="Settings" onClose={onClose} className="settings">
      <div className="fields">
        <Field label="Colors">
          <Segmented
            value={theme}
            options={["system", "light", "dark"] as const}
            labels={{ system: "System", light: "Light", dark: "Dark" }}
            clearable={false}
            onChange={(v) => {
              const p = v ?? "system";
              setTheme(p);
              setThemePref(p);
            }}
          />
        </Field>
        <Field label="Areas">
          <div className="stack">
            <DraftTextarea
              className="input"
              rows={6}
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
      <p className="muted small settings-foot">Evenkeel · rev {state.rev}</p>
    </Dialog>
  );
}
