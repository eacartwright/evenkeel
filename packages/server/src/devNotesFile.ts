import { writeFileSync } from "node:fs";
import type { State } from "@evenkeel/shared";

// The dev notes as Markdown beside the database, rewritten on every change (as in foodlab).
// Claude reads this file over the mini PC's share (Z:\Apps\evenkeel\data) instead of opening the
// live SQLite file, which isn't safe across a network share.

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export function devNotesMarkdown(state: State): string {
  const notes = Object.values(state.devnotes)
    .filter((n) => !n.deleted)
    .sort((a, b) => a.createdAt - b.createdAt);
  const line = (n: (typeof notes)[number]) => `- ${n.text.replace(/\n/g, "\n  ")} (${day(n.createdAt)}${n.path ? `, ${n.path}` : ""}, id ${n.id})`;
  const open = notes.filter((n) => !n.done);
  const done = notes.filter((n) => n.done);
  return [
    "# evenkeel dev notes",
    "",
    `Written by the server at ${new Date().toISOString()} (rev ${state.rev}). Edit them in the app, not here.`,
    "",
    `## Open (${open.length})`,
    "",
    ...open.map(line),
    "",
    `## Done (${done.length})`,
    "",
    ...done.map(line),
    "",
  ].join("\n");
}

/** Never fails a save: the file is a convenience. */
export function writeDevNotes(file: string, state: State) {
  try {
    writeFileSync(file, devNotesMarkdown(state));
  } catch (err) {
    console.error(`Couldn't write ${file}:`, err);
  }
}
