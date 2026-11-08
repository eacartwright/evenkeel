import { captureLines, countLines } from "@evenkeel/shared";
import { useEffect, useRef, useState } from "react";
import { capture } from "../actions";
import { sortRamble } from "../ai";
import { canRecord, useDictation } from "../dictation";
import { A } from "../router";
import { useData } from "../sync";
import { showToast } from "../toast";
import { ItemRow } from "./ItemRow";
import { candidates, loadRamble, RambleReview, saveRamble, type Ramble } from "./RambleReview";

const DRAFT_KEY = "evenkeel:capture";

/**
 * The landing page (DESIGN.md §5.1): one box, one line per thing, straight into the inbox.
 * Nothing to choose; filing comes later. The draft survives closing the app.
 */
export function CapturePage() {
  const { view } = useData();
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(DRAFT_KEY) ?? "";
    } catch {
      return "";
    }
  });
  useEffect(() => {
    try {
      if (text) localStorage.setItem(DRAFT_KEY, text);
      else localStorage.removeItem(DRAFT_KEY);
    } catch {
      // Storage blocked: the draft lives until the page closes.
    }
  }, [text]);
  const box = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    // On a desktop, ready to type. Not on the phone: the keyboard would cover the page.
    if (matchMedia("(min-width: 861px)").matches) box.current?.focus();
  }, []);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.max(el.scrollHeight + 2, 120)}px`;
  }, [text]);

  // A ramble (DESIGN.md §5.6): spoken (🎙) or typed freely, then ✨ sorted into items to review.
  const [ramble, setRambleState] = useState<Ramble | null>(loadRamble);
  const setRamble = (r: Ramble | null) => {
    setRambleState(r);
    saveRamble(r);
  };
  const [sorting, setSorting] = useState(false);
  const [aiError, setAiError] = useState("");
  const sort = async (what = text) => {
    if (!what.trim() || sorting) return;
    setSorting(true);
    setAiError("");
    const r = await sortRamble(what);
    setSorting(false);
    if (r.error !== undefined) return setAiError(r.error);
    setRamble({ transcript: what, found: candidates(r.items), model: r.model, costUsd: r.costUsd });
    setText("");
  };
  const dictation = useDictation((said) => setText((t) => (t.trim() ? `${t.trimEnd()}\n${said}` : said)));
  const [, tick] = useState(0);
  useEffect(() => {
    if (dictation.state !== "recording") return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [dictation.state]);
  const secs = dictation.state === "recording" ? Math.floor((Date.now() - dictation.startedAt) / 1000) : 0;

  const lines = captureLines(text);
  const count = countLines(lines);
  const steps = count - lines.length;
  const add = () => {
    if (!count) return;
    const n = capture(lines);
    setText("");
    showToast(`${n} ${n === 1 ? "thing" : "things"} in the inbox`);
    box.current?.focus();
  };

  const inbox = view.inbox();
  return (
    <div className="page capture-page">
      <h1 className="page-title">What's on your mind?</h1>
      <p className="lede muted">
        One thing per line. Indent a line to make it a step of the one above. Everything goes to the inbox; sort it later. Or just ramble (type or 🎙 talk) and let ✨ sort it into items.
      </p>
      {ramble && (
        <RambleReview
          ramble={ramble}
          onChange={setRamble}
          onBack={(t) => {
            setText((cur) => (cur.trim() ? `${cur.trimEnd()}\n${t}` : t));
            setRamble(null);
          }}
        />
      )}
      <textarea
        ref={box}
        className="input capture-box"
        aria-label="Capture"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            add();
          } else if (e.key === "Tab" && !e.shiftKey && !e.altKey && !e.ctrlKey) {
            // Tab indents (a step), rather than leaving the box.
            e.preventDefault();
            const el = e.currentTarget;
            const { selectionStart: s, selectionEnd: end } = el;
            const lineStart = text.lastIndexOf("\n", s - 1) + 1;
            setText(text.slice(0, lineStart) + "  " + text.slice(lineStart));
            requestAnimationFrame(() => el.setSelectionRange(s + 2, end + 2));
          }
        }}
      />
      <div className="capture-bar">
        <span className="muted small">
          {count ? `${lines.length} ${lines.length === 1 ? "thing" : "things"}${steps ? `, ${steps} ${steps === 1 ? "step" : "steps"}` : ""}` : ""}
        </span>
        <span className="spacer" />
        {canRecord() &&
          (dictation.state === "recording" ? (
            <button className="btn recording" onClick={dictation.stop} aria-label="Stop recording">
              ● {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")} Stop
            </button>
          ) : (
            <button className="btn" disabled={dictation.state !== "idle"} onClick={() => void dictation.start()} title="Talk it through; the words land in the box">
              {dictation.state === "sending" ? "Transcribing…" : dictation.state === "starting" ? "…" : "🎙 Talk"}
            </button>
          ))}
        <button className="btn" disabled={!text.trim() || sorting || dictation.state !== "idle"} onClick={() => void sort()} title="AI pulls out the separate things to do, with steps; you review them before anything is kept">
          {sorting ? "Sorting…" : "✨ Sort"}
        </button>
        <span className="muted small hide-sm">Ctrl+Enter</span>
        <button className="btn primary" disabled={!count} onClick={add}>
          Add to inbox
        </button>
      </div>
      {aiError && <p className="notice">{aiError}</p>}

      {inbox.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h3>In the inbox</h3>
            <A href="/inbox" className="btn subtle">
              Sort {inbox.length} →
            </A>
          </div>
          <div className="rows">
            {inbox.slice(0, 5).map((i) => (
              <ItemRow key={i.id} item={i} />
            ))}
          </div>
          {inbox.length > 5 && <p className="muted small">and {inbox.length - 5} more</p>}
        </section>
      )}
    </div>
  );
}
