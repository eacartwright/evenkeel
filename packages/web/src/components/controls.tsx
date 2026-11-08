import { createContext, useContext, useEffect, useId, useRef, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from "react";

// Inputs that edit a record in place and save as you go.

/** The id of the label of the Field a control is in: its name, so no box needs a placeholder to have one. */
const FieldLabel = createContext<string | undefined>(undefined);

/** A control's name from its Field's label, unless it has its own (aria-label wins). */
function useFieldName(own: { "aria-label"?: string; "aria-labelledby"?: string }) {
  const labelId = useContext(FieldLabel);
  return own["aria-label"] || own["aria-labelledby"] || !labelId ? {} : { "aria-labelledby": labelId };
}

/**
 * A text box that saves on Enter or when it loses focus (Esc puts it back). Its draft resets
 * during render when the record's value changes, so typing never leaks into another record.
 */
export function DraftInput({
  value,
  onCommit,
  required,
  ...rest
}: { value: string; onCommit: (v: string) => void; required?: boolean } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  if (value !== base) {
    setBase(value);
    setDraft(value);
  }
  const commit = () => {
    const v = draft.trim();
    if (required && !v) return setDraft(value);
    if (v !== value) onCommit(v);
  };
  const name = useFieldName(rest);
  return (
    <input
      {...name}
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(value);
          e.stopPropagation();
        }
        rest.onKeyDown?.(e);
      }}
    />
  );
}

/** A page's title: a DraftInput that wraps onto more lines instead of cutting a long name
 * off. One line of text (Enter saves, pasted line breaks become spaces). */
export function TitleInput({
  value,
  onCommit,
  required,
  className = "",
  ...rest
}: { value: string; onCommit: (v: string) => void; required?: boolean } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  if (value !== base) {
    setBase(value);
    setDraft(value);
  }
  const commit = () => {
    const v = draft.trim();
    if (required && !v) return setDraft(value);
    if (v !== value) onCommit(v);
  };
  // As tall as its lines, again whenever the width changes.
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight + 3}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [draft]);
  const name = useFieldName(rest);
  return (
    <textarea
      ref={ref}
      {...name}
      {...rest}
      className={`title-input ${className}`}
      rows={1}
      value={draft}
      onChange={(e) => setDraft(e.target.value.replace(/\s*[\r\n]+\s*/g, " "))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(value);
          e.stopPropagation();
        }
        rest.onKeyDown?.(e);
      }}
    />
  );
}

/** A number box: blank = none. */
export function NumberInput({
  value,
  onCommit,
  ...rest
}: { value: number | null; onCommit: (v: number | null) => void } & Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange">) {
  return (
    <DraftInput
      inputMode="decimal"
      {...rest}
      value={value === null ? "" : String(value)}
      onCommit={(s) => {
        const n = s === "" ? null : Number(s.replace(",", "."));
        onCommit(n === null || (Number.isFinite(n) && n >= 0) ? n : value);
      }}
    />
  );
}

/**
 * A text area that saves when it loses focus, the app is hidden or the page closes. Grows with its text.
 * Not on a pause in typing: the server trims the text, and its reply reset the draft mid-typing
 * (lost the trailing space, cursor stepped back; 2026-10-26).
 */
export function DraftTextarea({
  value,
  onCommit,
  ...rest
}: { value: string; onCommit: (v: string) => void } & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value" | "onChange">) {
  const [draft, setDraft] = useState(value);
  const [base, setBase] = useState(value);
  if (value !== base) {
    setBase(value);
    setDraft(value);
  }
  const latest = useRef({ draft, value, onCommit });
  latest.current = { draft, value, onCommit };
  const commit = () => {
    const l = latest.current;
    if (l.draft !== l.value) l.onCommit(l.draft);
  };
  useEffect(() => {
    // Switching apps on the phone doesn't blur the field.
    const hide = () => document.visibilityState === "hidden" && commit();
    document.addEventListener("visibilitychange", hide);
    return () => {
      document.removeEventListener("visibilitychange", hide);
      commit();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight + 2}px`;
  }, [draft]);
  const name = useFieldName(rest);
  return (
    <textarea
      ref={ref}
      {...name}
      {...rest}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
    />
  );
}

export function Segmented<T extends string>({
  value,
  options,
  labels,
  onChange,
  clearable = true,
  label,
}: {
  value: T | null;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (v: T | null) => void;
  clearable?: boolean;
  label?: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o}
          className={value === o ? "on" : ""}
          aria-pressed={value === o}
          onClick={() => onChange(value === o ? (clearable ? null : o) : o)}
        >
          {labels[o]}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, children, htmlFor }: { label: string; children: ReactNode; htmlFor?: string }) {
  const labelId = useId();
  return (
    <div className="field">
      <label className="field-label" id={labelId} htmlFor={htmlFor}>
        {label}
      </label>
      <div className="field-control">
        <FieldLabel.Provider value={labelId}>{children}</FieldLabel.Provider>
      </div>
    </div>
  );
}

/** Names that are the same thing: case, punctuation and extra spaces aside. */
export const nameKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

export interface Option {
  id: string;
  label: string;
  hint?: string;
}

/** Best matches first: names starting with the text, then words starting with it, then containing it. */
function filterOptions(options: Option[], text: string, limit = 40): Option[] {
  const t = text.trim().toLowerCase();
  if (!t) return options.slice(0, limit);
  const k = nameKey(t);
  const scored: [number, Option][] = [];
  for (const o of options) {
    const l = o.label.toLowerCase();
    const s = l.startsWith(t) || nameKey(o.label) === k ? 0 : l.includes(` ${t}`) ? 1 : l.includes(t) ? 2 : -1;
    if (s >= 0) scored.push([s, o]);
  }
  return scored
    .sort((a, b) => a[0] - b[0] || a[1].label.localeCompare(b[1].label))
    .slice(0, limit)
    .map(([, o]) => o);
}

/**
 * Pick one by typing part of its name (foodlab's Picker). Shows the chosen one's name when idle;
 * typing filters; Enter or a tap picks the highlighted one. Something new is made only by picking
 * "+ Add “…”" (when `onCreate` is given): typing alone never makes one.
 */
export function Picker({
  value,
  options,
  onChange,
  onCreate,
  placeholder = "None",
  createLabel = "Add",
  clearable = true,
  id,
  "aria-label": ariaLabel,
}: {
  value: string | null;
  options: Option[];
  onChange: (id: string | null) => void;
  onCreate?: (text: string) => string;
  placeholder?: string;
  createLabel?: string;
  clearable?: boolean;
  id?: string;
  /** Its name when it isn't in a Field (in one, the Field's label is). */
  "aria-label"?: string;
}) {
  const name = useFieldName({ "aria-label": ariaLabel });
  const selected = options.find((o) => o.id === value);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const listId = useId();
  const shown = open ? filterOptions(options, text) : [];
  const exact = shown.some((o) => nameKey(o.label) === nameKey(text));
  const canCreate = !!onCreate && !!text.trim() && !exact;
  const total = shown.length + (canCreate ? 1 : 0);

  const pick = (o: Option | "create") => {
    onChange(o === "create" ? onCreate!(text.trim()) : o.id);
    setText("");
    setActive(0);
    setOpen(false);
    input.current?.blur();
  };

  return (
    <div className={`picker ${open ? "open" : ""}`}>
      <input
        id={id}
        aria-label={ariaLabel}
        {...name}
        ref={input}
        className={`input ${!selected && !open ? "unset" : ""}`}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        placeholder={open ? "Type to find…" : placeholder}
        value={open ? text : (selected?.label ?? "")}
        onFocus={() => {
          setOpen(true);
          setText("");
          setActive(0);
        }}
        onBlur={() => setOpen(false)}
        onChange={(e) => {
          setText(e.target.value);
          setActive(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, total - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (active < shown.length) pick(shown[active]!);
            else if (canCreate) pick("create");
          } else if (e.key === "Escape") {
            e.stopPropagation();
            input.current?.blur();
          }
        }}
      />
      {clearable && selected && !open && (
        <button className="picker-clear" aria-label="Clear" onClick={() => onChange(null)}>
          ✕
        </button>
      )}
      {open && total > 0 && (
        // Keeps the input focused, so the list stays open for the click. Picks on click, not on
        // touching down: a finger has to be able to drag the list to scroll it.
        <ul className="picker-list" id={listId} role="listbox" onMouseDown={(e) => e.preventDefault()}>
          {shown.map((o, n) => (
            <li key={o.id} role="option" aria-selected={n === active} className={n === active ? "active" : ""} onClick={() => pick(o)}>
              <span>{o.label}</span>
              {o.hint && <span className="muted small">{o.hint}</span>}
            </li>
          ))}
          {canCreate && (
            <li role="option" aria-selected={active === shown.length} className={`create ${active === shown.length ? "active" : ""}`} onClick={() => pick("create")}>
              + {createLabel} “{text.trim()}”
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
