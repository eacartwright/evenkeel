import { describe, expect, it } from "vitest";
import { blank, emptyState } from "@evenkeel/shared";
import { devNotesMarkdown } from "./devNotesFile";

describe("devNotesMarkdown", () => {
  it("lists open then done, skips deleted, keeps the page only when there is one, and lists files", () => {
    const s = emptyState();
    const f = { id: "0f40bf1e-a2a9-426f-80b6-3d53dc4a8de1", name: "screenshot.png", type: "image/png" };
    s.devnotes.a = { ...blank.devnote("a", "Edit notes", "/items/x", Date.UTC(2026, 10, 7)), files: [f] };
    s.devnotes.b = { ...blank.devnote("b", "Two\nlines", "", Date.UTC(2026, 10, 8)), done: true };
    s.devnotes.c = { ...blank.devnote("c", "Gone", ""), deleted: true };
    const md = devNotesMarkdown(s);
    expect(md).toContain(`## Open (1)\n\n- Edit notes (2026-11-07, /items/x, id a)\n  - attached: files/${f.id} (screenshot.png, image/png)`);
    expect(md).toContain("## Done (1)\n\n- Two\n  lines (2026-11-08, id b)");
    expect(md).not.toContain("Gone");
  });
});
