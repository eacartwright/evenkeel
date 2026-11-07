// Typed or pasted capture (DESIGN.md §5.1): each line is one thing for the inbox. Bullets,
// numbers and checkboxes are dropped; an indented line becomes a step of the line above it,
// so a list pasted from Todoist, Obsidian or Keep keeps its shape.

export interface CapturedLine {
  title: string;
  /** Text that didn't fit the title. */
  body: string;
  /** "- [x]" in the paste. */
  done: boolean;
  steps: CapturedLine[];
}

const MAX_TITLE = 200;

/** The text of a line without its list marker: "- [ ] Call the insurer" → "Call the insurer". */
export function cleanLine(line: string): { text: string; done: boolean } {
  let t = line.trim();
  let done = false;
  t = t.replace(/^(?:[-*+•]|\d{1,3}[.)])\s+/, "");
  const box = /^\[( |x|X)\]\s*/.exec(t);
  if (box) {
    done = box[1] !== " ";
    t = t.slice(box[0].length);
  }
  return { text: t.trim(), done };
}

/** A long line: a title cut at a word, the rest in the body. */
function split(text: string): { title: string; body: string } {
  if (text.length <= MAX_TITLE) return { title: text, body: "" };
  const cut = text.lastIndexOf(" ", MAX_TITLE - 1);
  const at = cut > MAX_TITLE / 2 ? cut : MAX_TITLE - 1;
  return { title: `${text.slice(0, at).trim()}…`, body: text };
}

const indentOf = (line: string) => {
  const m = /^[ \t]*/.exec(line)![0];
  return m.replace(/\t/g, "    ").length;
};

export function captureLines(text: string): CapturedLine[] {
  const roots: CapturedLine[] = [];
  // The open lines above, each with its indent: a deeper line becomes the last one's step.
  const stack: { indent: number; line: CapturedLine }[] = [];
  for (const raw of text.replace(/\r\n?/g, "\n").split("\n")) {
    const { text: t, done } = cleanLine(raw);
    if (!t) continue;
    const indent = indentOf(raw);
    const line: CapturedLine = { ...split(t), done, steps: [] };
    while (stack.length && stack.at(-1)!.indent >= indent) stack.pop();
    (stack.length ? stack.at(-1)!.line.steps : roots).push(line);
    stack.push({ indent, line });
  }
  return roots;
}

/** How many items a capture makes, steps included. */
export const countLines = (lines: CapturedLine[]): number => lines.reduce((n, l) => n + 1 + countLines(l.steps), 0);

/** Something shared from another app (DESIGN.md §5.1): one inbox item, the link kept in its body. */
export function fromShared(p: { title?: string | null; text?: string | null; url?: string | null }): { title: string; body: string } {
  const title = (p.title ?? "").trim();
  let text = (p.text ?? "").trim();
  let url = (p.url ?? "").trim();
  // Many apps put the link in the text ("Look at this https://…").
  if (!url) {
    const m = /https?:\/\/\S+/.exec(text);
    if (m) {
      url = m[0];
      text = text.replace(m[0], "").trim();
    }
  }
  const first = text.split("\n")[0]!.trim();
  const name = title || first || url || "Shared";
  const rest = [title ? text : text.split("\n").slice(1).join("\n").trim(), url].filter(Boolean).join("\n\n");
  const { title: t, body } = split(name);
  return { title: t, body: [body, rest].filter(Boolean).join("\n\n") };
}
