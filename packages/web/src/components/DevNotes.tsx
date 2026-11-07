import { useState } from "react";
import { addDevNote } from "../actions";
import { put, useData } from "../sync";
import { Dialog } from "./Dialog";

/**
 * Dev Notes (as in foodlab): notes about the app itself, written while using it, each with the
 * page it was on. The server mirrors them to data/dev-notes.md for the next build session.
 */
export function DevNotesDialog({ onClose }: { onClose: () => void }) {
  const { state } = useData();
  const [text, setText] = useState("");
  const notes = Object.values(state.devnotes)
    .filter((n) => !n.deleted)
    .sort((a, b) => Number(a.done) - Number(b.done) || b.createdAt - a.createdAt);
  const add = () => {
    addDevNote(text);
    setText("");
  };
  return (
    <Dialog title="Dev Notes" onClose={onClose} className="devnotes">
      <div className="stack">
        <textarea
          className="input"
          aria-label="New dev note"
          rows={3}
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) add();
          }}
        />
        <div className="row-actions">
          <span className="muted small">Saved with the page you're on.</span>
          <span className="spacer" />
          <button className="btn primary" disabled={!text.trim()} onClick={add}>
            Add note
          </button>
        </div>
        <div className="rows">
          {notes.map((n) => (
            <div key={n.id} className={`row devnote ${n.done ? "is-finished" : ""}`}>
              <input type="checkbox" aria-label={n.done ? "Not done" : "Done"} checked={n.done} onChange={() => put("devnotes", { ...n, done: !n.done })} />
              <span className="row-main">
                <span className="devnote-text">{n.text}</span>
                <span className="row-sub">
                  {new Date(n.createdAt).toLocaleDateString()} {n.path && `· ${n.path}`}
                </span>
              </span>
              <button className="btn icon subtle" aria-label="Delete note" onClick={() => put("devnotes", { ...n, deleted: true })}>
                🗑
              </button>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
