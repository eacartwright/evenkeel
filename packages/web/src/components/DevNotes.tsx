import { fileUrl, type Attachment, type DevNote } from "@evenkeel/shared";
import { useRef, useState, type ClipboardEvent } from "react";
import { addDevNote, editDevNote, removeDevNote } from "../actions";
import { A } from "../router";
import { data, put, useData } from "../sync";
import { showToast } from "../toast";
import { uploadFile } from "../uploads";
import { DraftTextarea } from "./controls";
import { Dialog } from "./Dialog";

// Dev Notes (DESIGN.md §5.7, as in foodlab and sideshow): ideas and bugs noticed while using the
// app. Each can remember the page it was written on and carry files (a pasted screenshot); Copy
// puts the open ones on the clipboard, and the server keeps them in data/dev-notes.md for Claude.

const WITH_PAGE = "evenkeel:devnote-page";
const readWithPage = () => {
  try {
    return localStorage.getItem(WITH_PAGE) !== "0";
  } catch {
    return true;
  }
};

const PAGES: Record<string, string> = { "/": "Capture", "/inbox": "Inbox", "/today": "Today", "/all": "All" };

/** "Item: Call the dentist" for /items/<id>, "Today" for /today, else the path. */
function pageLabel(path: string): string {
  const m = /^\/items\/([^/?]+)/.exec(path);
  const item = m ? data().state.items[decodeURIComponent(m[1]!)] : undefined;
  if (item) return `Item: ${item.title}`;
  return PAGES[path.split("?")[0]!] ?? path;
}

/** Uploads files one by one, handing each over; `busy` counts the ones still going. */
function useAttach(onAttach: (f: Attachment) => void) {
  const [busy, setBusy] = useState(0);
  const attach = async (files: File[]) => {
    setBusy((n) => n + files.length);
    for (const f of files) {
      try {
        onAttach(await uploadFile(f));
      } catch (err) {
        showToast((err as Error).message);
      }
      setBusy((n) => n - 1);
    }
  };
  /** A pasted picture (a screenshot) is attached; pasted text goes in as usual. */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = [...e.clipboardData.files];
    if (!files.length) return;
    e.preventDefault();
    void attach(files);
  };
  return { busy, attach, onPaste };
}

/** 📎: pick files (on the phone, photos or the camera too); each is uploaded, then handed over. */
function AttachButton({ busy, attach }: { busy: number; attach: (files: File[]) => Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <button className="btn icon subtle" aria-label="Attach a photo or file" title="Attach a photo or file" disabled={busy > 0} onClick={() => input.current?.click()}>
        {busy ? "…" : "📎"}
      </button>
      <input
        ref={input}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void attach([...(e.target.files ?? [])]);
          e.target.value = "";
        }}
      />
    </>
  );
}

/** A note's files: pictures as small previews, the rest by name; each opens in a new tab. */
function Attached({ files, onRemove }: { files: Attachment[]; onRemove?: (f: Attachment) => void }) {
  if (!files.length) return null;
  return (
    <span className="attached">
      {files.map((f) => (
        <span key={f.id} className="attached-file">
          <a href={fileUrl(f.id, f.name)} target="_blank" rel="noreferrer noopener" title={f.name}>
            {f.type.startsWith("image/") ? <img src={fileUrl(f.id)} alt={f.name} loading="lazy" /> : `📄 ${f.name}`}
          </a>
          {onRemove && (
            <button className="btn icon subtle" aria-label={`Remove ${f.name}`} onClick={() => onRemove(f)}>
              ✕
            </button>
          )}
        </span>
      ))}
    </span>
  );
}

const fmt = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });

export function DevNotesDialog({ onClose }: { onClose: () => void }) {
  const { state } = useData();
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [withPage, setWithPage] = useState(readWithPage);
  const [files, setFiles] = useState<Attachment[]>([]);
  const uploads = useAttach((f) => setFiles((fs) => [...fs, f]));
  const notes = Object.values(state.devnotes)
    .filter((n) => !n.deleted)
    .sort((a, b) => b.createdAt - a.createdAt);
  const open = notes.filter((n) => !n.done);
  const done = notes.filter((n) => n.done);
  const add = () => {
    if (!text.trim() || uploads.busy) return;
    addDevNote(text, withPage, files);
    setText("");
    setFiles([]);
  };
  const copy = async () => {
    const md = open.map((n) => `- ${n.text.replace(/\n/g, "\n  ")} (${n.path ? `${pageLabel(n.path)}, ` : ""}${fmt(n.createdAt)})`).join("\n");
    try {
      await navigator.clipboard.writeText(md);
      showToast(`Copied ${open.length} note${open.length === 1 ? "" : "s"}`);
    } catch {
      showToast("Couldn't copy here (the clipboard needs https)");
    }
  };

  return (
    <Dialog
      title="Dev Notes"
      onClose={onClose}
      className="dev-notes"
      actions={
        open.length > 0 && (
          <button className="btn subtle" onClick={() => void copy()} title="The open notes as a Markdown list">
            Copy
          </button>
        )
      }
    >
      <div className="stack">
        <div className="inline">
          <textarea
            className="input grow"
            rows={2}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                add();
              }
            }}
            onPaste={uploads.onPaste}
            aria-label="New note"
          />
          <AttachButton {...uploads} />
          <button className="btn primary" disabled={!text.trim() || uploads.busy > 0} onClick={add}>
            Add
          </button>
        </div>
        <Attached files={files} onRemove={(f) => setFiles((fs) => fs.filter((x) => x.id !== f.id))} />
        <label className="inline small muted">
          <input
            type="checkbox"
            checked={withPage}
            onChange={(e) => {
              setWithPage(e.target.checked);
              try {
                localStorage.setItem(WITH_PAGE, e.target.checked ? "1" : "0");
              } catch {
                // Not remembered.
              }
            }}
          />
          Link it to this page ({pageLabel(location.pathname + location.search)})
        </label>
        <ul className="notes">
          {open.map((n) => (
            <NoteRow key={n.id} n={n} onNavigate={onClose} />
          ))}
        </ul>
        {done.length > 0 && (
          <>
            <button className="btn subtle" onClick={() => setShowDone(!showDone)} aria-expanded={showDone}>
              {showDone ? "Hide" : "Show"} done ({done.length})
            </button>
            {showDone && (
              <ul className="notes">
                {done.map((n) => (
                  <NoteRow key={n.id} n={n} onNavigate={onClose} />
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </Dialog>
  );
}

/** Changes to the latest copy of a note (an upload can finish after other edits). */
const saveNote = (n: DevNote, patch: (now: DevNote) => Partial<DevNote>) => {
  const now = data().state.devnotes[n.id] ?? n;
  put("devnotes", { ...now, ...patch(now) });
};

function NoteRow({ n, onNavigate }: { n: DevNote; onNavigate: () => void }) {
  const [editing, setEditing] = useState(false);
  const uploads = useAttach((f) => saveNote(n, (now) => ({ files: [...now.files, f] })));
  return (
    <li className={n.done ? "done" : ""}>
      <input type="checkbox" checked={n.done} aria-label={n.done ? "Not done" : "Done"} onChange={(e) => saveNote(n, () => ({ done: e.target.checked }))} />
      <span className="note-main">
        {editing ? (
          <DraftTextarea className="input" autoFocus value={n.text} onCommit={(t) => editDevNote(n, t)} onPaste={uploads.onPaste} aria-label="Note" />
        ) : (
          <span className="note-text">{n.text}</span>
        )}
        <span className="muted small">
          {fmt(n.createdAt)}
          {n.path && (
            <>
              {" · "}
              <A href={n.path} onClick={onNavigate}>
                {pageLabel(n.path)}
              </A>
            </>
          )}
        </span>
        <Attached files={n.files} onRemove={editing ? (f) => saveNote(n, (now) => ({ files: now.files.filter((x) => x.id !== f.id) })) : undefined} />
      </span>
      <AttachButton {...uploads} />
      <button className="btn icon subtle" aria-label={editing ? "Done editing" : "Edit note"} onClick={() => setEditing(!editing)}>
        {editing ? "✓" : "✎"}
      </button>
      <button className="btn icon subtle" aria-label="Delete note" onClick={() => removeDevNote(n)}>
        ✕
      </button>
    </li>
  );
}
