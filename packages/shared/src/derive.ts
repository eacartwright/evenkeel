import { addDays, settingsOf, today, type Id, type Item, type State, type Tier } from "./types";

// Views derived from the state (DESIGN.md §5): pure, used by the app's pages and by the server's checks.

const byPosition = (a: Item, b: Item) => a.position - b.position || a.createdAt - b.createdAt;

/** An item that still asks for something: an open task. Notes and finished tasks don't. */
export const isOpen = (i: Item) => !i.deleted && i.status === "open";
export const isNote = (i: Item) => i.status === null;

/** What Today shows (DESIGN.md §5.3). */
export interface TodayView {
  /** Planned for today. */
  planned: Item[];
  /** Planned for an earlier day and not done: still on deck, never red. */
  onDeck: Item[];
  /** Real deadlines from today to a week out (and any that passed), soonest first. */
  deadlines: Item[];
  /** A few small things that fit a gap: a next action or 20 minutes or less, untouched longest first. */
  quickWins: Item[];
}

export interface Progress {
  done: number;
  total: number;
}

export class View {
  private kids = new Map<Id | null, Item[]>();

  constructor(readonly state: State) {
    for (const i of Object.values(state.items)) {
      if (i.deleted) continue;
      const list = this.kids.get(i.parentId) ?? [];
      list.push(i);
      this.kids.set(i.parentId, list);
    }
    for (const list of this.kids.values()) list.sort(byPosition);
  }

  item(id: Id | null | undefined): Item | undefined {
    const i = id ? this.state.items[id] : undefined;
    return i && !i.deleted ? i : undefined;
  }

  /** An item's steps, in order. */
  children(id: Id): Item[] {
    return this.kids.get(id) ?? [];
  }

  /** Every step under an item, depth first. */
  descendants(id: Id): Item[] {
    return this.children(id).flatMap((c) => [c, ...this.descendants(c.id)]);
  }

  /** The items above this one, top first. */
  ancestors(id: Id): Item[] {
    const out: Item[] = [];
    const seen = new Set<Id>([id]);
    let p = this.item(this.state.items[id]?.parentId);
    while (p && !seen.has(p.id)) {
      out.unshift(p);
      seen.add(p.id);
      p = this.item(p.parentId);
    }
    return out;
  }

  /** Would putting `id` under `parentId` make it its own ancestor? */
  wouldLoop(id: Id, parentId: Id): boolean {
    if (id === parentId) return true;
    const seen = new Set<Id>();
    let p: Item | undefined = this.state.items[parentId];
    while (p && !seen.has(p.id)) {
      if (p.id === id) return true;
      seen.add(p.id);
      p = p.parentId ? this.state.items[p.parentId] : undefined;
    }
    return false;
  }

  /** Done steps of all its tasks (notes among the steps don't count). */
  progress(id: Id): Progress {
    const tasks = this.children(id).filter((c) => c.status !== null && c.status !== "dropped");
    return { done: tasks.filter((c) => c.status === "done" || c.status === "skipped").length, total: tasks.length };
  }

  /** The position for a new last step (or top-level item). */
  nextPosition(parentId: Id | null, now = Date.now()): number {
    const list = this.kids.get(parentId) ?? [];
    return Math.max(now, (list.at(-1)?.position ?? 0) + 1);
  }

  /** What's waiting to be filed: top-level, still in the inbox, not finished. In the order captured, so a ramble reads as it was said. */
  inbox(): Item[] {
    return this.children_(null)
      .filter((i) => i.tier === "inbox" && (i.status === "open" || i.status === null))
      .sort((a, b) => a.createdAt - b.createdAt || byPosition(a, b));
  }

  private children_(parentId: Id | null) {
    return this.kids.get(parentId) ?? [];
  }

  /** Is anything this waits on still open? */
  blocked(i: Item): boolean {
    return i.blockedBy.some((b) => {
      const x = this.item(b);
      return !!x && x.status === "open";
    });
  }

  today(day = today()): TodayView {
    const open = Object.values(this.state.items).filter(isOpen);
    const planned = open.filter((i) => i.scheduled === day).sort(byPosition);
    const onDeck = open.filter((i) => i.scheduled !== null && i.scheduled < day).sort((a, b) => a.scheduled!.localeCompare(b.scheduled!) || byPosition(a, b));
    const shown = new Set([...planned, ...onDeck].map((i) => i.id));
    const weekOut = addDays(day, 7);
    const deadlines = open
      .filter((i) => i.deadline !== null && i.deadline <= weekOut && !shown.has(i.id))
      .sort((a, b) => a.deadline!.localeCompare(b.deadline!));
    for (const i of deadlines) shown.add(i.id);
    const quickWins = open
      .filter(
        (i) =>
          !shown.has(i.id) &&
          (i.tier === "chip" || i.tier === "hard") &&
          this.children(i.id).every((c) => c.status !== "open") &&
          !this.blocked(i) &&
          (i.nextAction !== "" || (i.estMinutes !== null && i.estMinutes <= 20)),
      )
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, 3);
    return { planned, onDeck, deadlines, quickWins };
  }

  /** How many things Today has (for its badge). */
  todayCount(day = today()): number {
    const t = this.today(day);
    return t.planned.length + t.onDeck.length + t.deadlines.filter((i) => i.deadline! <= day).length;
  }

  /** The areas to offer: Settings' list, then any others in use, A–Z. */
  areas(): string[] {
    const listed = settingsOf(this.state).areas;
    const known = new Set(listed.map((a) => a.toLowerCase()));
    const used = new Set<string>();
    for (const i of Object.values(this.state.items)) {
      if (!i.deleted && i.area && !known.has(i.area.toLowerCase())) used.add(i.area);
    }
    return [...listed, ...[...used].sort((a, b) => a.localeCompare(b))];
  }

  /**
   * Everything filed, for All (DESIGN.md §5.4): top-level items grouped by tier, notes on their
   * own. Finished tasks only with `withDone`. A query matches title, next action, body and area;
   * a step that matches brings its top-level item.
   */
  all({ q = "", area = "", withDone = false }: { q?: string; area?: string; withDone?: boolean } = {}): { tier: Tier | "notes"; items: Item[] }[] {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    const text = (i: Item) => `${i.title}\n${i.nextAction}\n${i.body}\n${i.area}`.toLowerCase();
    const matches = (i: Item): boolean => terms.every((t) => text(i).includes(t)) || this.children(i.id).some(matches);
    const top = this.children_(null).filter(
      (i) =>
        i.tier !== "inbox" &&
        (withDone || i.status === "open" || i.status === null) &&
        (!area || i.area.toLowerCase() === area.toLowerCase()) &&
        (!terms.length || matches(i)),
    );
    const groups: { tier: Tier | "notes"; items: Item[] }[] = [
      { tier: "hard", items: top.filter((i) => !isNote(i) && i.tier === "hard").sort((a, b) => (a.deadline ?? "9999").localeCompare(b.deadline ?? "9999") || byPosition(a, b)) },
      { tier: "chip", items: top.filter((i) => !isNote(i) && i.tier === "chip") },
      { tier: "back", items: top.filter((i) => !isNote(i) && i.tier === "back") },
      { tier: "notes", items: top.filter(isNote).sort((a, b) => b.updatedAt - a.updatedAt) },
    ];
    return groups.filter((g) => g.items.length);
  }
}
