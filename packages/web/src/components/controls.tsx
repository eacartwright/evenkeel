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
