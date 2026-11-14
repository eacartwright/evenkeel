import { chatUrl, countProposed, dayLabel, parseWrapUp, researchPrompt, SOURCE_LABEL, today, type Item, type Proposed, type Research } from "@evenkeel/shared";
import { useState } from "react";
import { addResearch, keepProposed, removeResearch, updateResearch } from "../actions";
import { useData } from "../sync";
import { showToast } from "../toast";
import { DraftInput } from "./controls";

// Talk it through (DESIGN.md §5.8): open Claude or ChatGPT with this item filled in, talk there
// on the subscription, say "wrap up", and paste the answer back: the link, a summary, and
// proposed steps to keep or drop.

async function copy(text: string, quiet = false) {
  try {
    await navigator.clipboard.writeText(text);
    if (!quiet) showToast("Copied the prompt");
  } catch {
    if (!quiet) showToast("Couldn't copy here (the clipboard needs https)");
  }
}

export function TalkItThrough({ item }: { item: Item }) {
  const { view } = useData();
  const research = item.research ?? [];
  const prompt = researchPrompt(view, item);
  // Copied as well, in case the app it opens in doesn't fill it in.
  const onOpen = () => void copy(prompt, true);
  return (
    <section className="section talk">
      <div className="section-head">
        <h3>Talk it through</h3>
      </div>
      <p className="muted small talk-how">
        Opens a new chat about this{view.children(item.id).length ? "" : " that starts by breaking it into groups"}; the prompt is on the clipboard too. When you're done, say <b>wrap up</b> and paste the answer (and the chat's link) below.
      </p>
      <div className="inline talk-open">
        <a className="btn" href={chatUrl("claude", prompt)} target="_blank" rel="noopener" onClick={onOpen}>
          Claude ↗
        </a>
        <a className="btn" href={chatUrl("chatgpt", prompt)} target="_blank" rel="noopener" onClick={onOpen}>
          ChatGPT ↗
        </a>
        <button className="btn subtle" onClick={() => void copy(prompt)}>
          Copy the prompt
        </button>
      </div>
      {[...research].reverse().map((r, n) => (
        <Conversation key={r.id} item={item} r={r} open={n === 0} />
      ))}
      <PasteWrapUp item={item} />
    </section>
  );
}

function Conversation({ item, r, open }: { item: Item; r: Research; open: boolean }) {
  const day = today(new Date(r.at));
  const first = r.summary.split("\n").find((l) => l.trim() && !/^#+\s*$/.test(l.trim()))?.replace(/^#+\s*/, "") ?? "";
  return (
    <div className="talk-entry">
      <div className="talk-entry-head">
        <span className="talk-source">{SOURCE_LABEL[r.source]}</span>
        <span className="muted small">{dayLabel(day)}</span>
        <span className="spacer" />
        {r.url ? (
          <a href={r.url} target="_blank" rel="noopener" className="small">
            Open the chat ↗
          </a>
        ) : (
          <DraftInput
            className="input talk-link"
            aria-label="The chat's link"
            placeholder="Paste the chat's link"
            value=""
            onCommit={(url) => {
              const u = url.trim();
              if (!/^https?:\/\//i.test(u)) return u && showToast("That isn't a web link");
              const w = parseWrapUp(u);
              updateResearch(item.id, r.id, { url: u, ...(r.source === "other" ? { source: w.source } : {}) });
            }}
          />
        )}
        <button className="btn icon subtle" aria-label="Remove this conversation" onClick={() => removeResearch(item.id, r.id)}>
          ✕
        </button>
      </div>
      {r.summary && (
        <details className="talk-summary" open={open}>
          <summary>{open ? "Summary" : first || "Summary"}</summary>
          <SummaryText text={r.summary} />
        </details>
      )}
      {r.proposed.length > 0 && <ProposedSteps item={item} r={r} />}
    </div>
  );
}

/** A summary as the chat wrote it, its Markdown headings shown as headings and ** dropped. */
function SummaryText({ text }: { text: string }) {
  const blocks: { head?: string; body: string[] }[] = [{ body: [] }];
  for (const line of text.split("\n")) {
    const h = /^\s*#{1,6}\s+(.*)$/.exec(line);
    if (h) blocks.push({ head: h[1]!.replace(/\*\*/g, ""), body: [] });
    else blocks.at(-1)!.body.push(line.replace(/\*\*/g, ""));
  }
  return (
    <div className="talk-text">
      {blocks.map((b, n) => {
        const body = b.body.join("\n").trim();
        return (
          (b.head || body) && (
            <div key={n} className="talk-block">
              {b.head && <div className="talk-h">{b.head}</div>}
              {body && <div>{body}</div>}
            </div>
          )
        );
      })}
    </div>
  );
}

/** Proposed steps, all ticked to start: untick what you don't want, then add the rest. */
function ProposedSteps({ item, r }: { item: Item; r: Research }) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOff((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  // An unticked group takes its steps with it.
  const kept = (list: Proposed[], prefix: string): Proposed[] =>
    list.flatMap((p, n) => {
      const key = `${prefix}${n}`;
      return off.has(key) ? [] : [{ title: p.title, steps: kept(p.steps, `${key}.`) }];
    });
  const keep = kept(r.proposed, "");
  const count = countProposed(keep);
  const rows = (list: Proposed[], prefix: string, parentOff: boolean) =>
    list.map((p, n) => {
      const key = `${prefix}${n}`;
      const isOff = parentOff || off.has(key);
      return (
        <li key={key}>
          <label className={`proposed ${isOff ? "off" : ""}`}>
            <input type="checkbox" checked={!isOff} disabled={parentOff} onChange={() => toggle(key)} />
            <span>{p.title}</span>
          </label>
          {p.steps.length > 0 && <ul>{rows(p.steps, `${key}.`, isOff)}</ul>}
        </li>
      );
    });
  return (
    <div className="talk-proposed">
      <div className="field-label">Proposed steps</div>
      <ul className="proposed-list">{rows(r.proposed, "", false)}</ul>
      <div className="inline">
        <button className="btn primary" disabled={!count} onClick={() => keepProposed(item.id, r.id, keep)}>
          Add {count} {count === 1 ? "step" : "steps"}
        </button>
        <button className="btn subtle" onClick={() => keepProposed(item.id, r.id, [])}>
          Drop them
        </button>
      </div>
    </div>
  );
}

function PasteWrapUp({ item }: { item: Item }) {
  const [text, setText] = useState("");
  const add = () => {
    const w = parseWrapUp(text);
    if (!w.url && !w.summary && !w.proposed.length) return;
    addResearch(item.id, w);
    setText("");
    showToast(w.proposed.length ? "Kept the wrap-up: its steps are below it to keep or drop" : "Kept the wrap-up");
  };
  return (
    <div className="talk-paste">
      <textarea
        className="input talk-paste-box"
        aria-label="Paste a wrap-up"
        placeholder="Paste the wrap-up here, with the chat's link if you have it"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            add();
          }
        }}
      />
      {text.trim() && (
        <div className="inline">
          <span className="spacer" />
          <button className="btn primary" onClick={add}>
            Keep the wrap-up
          </button>
        </div>
      )}
    </div>
  );
}
