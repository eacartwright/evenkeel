import { repeatState } from "./repeat";
import { addDays, settingsOf, today, type Id, type Item, type State, type Tier } from "./types";

// Views derived from the state (DESIGN.md §5): pure, used by the app's pages and by the server's checks.

const byPosition = (a: Item, b: Item) => a.position - b.position || a.createdAt - b.createdAt;

/** An item that still asks for something: an open task. Notes and finished tasks don't. */
export const isOpen = (i: Item) => !i.deleted && i.status === "open";
export const isNote = (i: Item) => i.status === null;

/** Put off with Later: still to come today or after. */
export const snoozed = (i: Item, day = today()) => i.snoozedUntil !== null && i.snoozedUntil > day;

/** The area filter's value for "filed without an area". */
export const NO_AREA = "-";
/** How many area colors styles.css has (--area-0…). */
export const AREA_COLORS = 12;

const matchesArea = (i: Item, area: string) => !area || (area === NO_AREA ? !i.area : i.area.toLowerCase() === area.toLowerCase());

/** A stable number for a string (FNV-1a), so a day's shuffle stays put between visits. */
function hash(s: string): number {
  let h = 2166136261;
  for (let n = 0; n < s.length; n++) h = Math.imul(h ^ s.charCodeAt(n), 16777619);
  return h >>> 0;
}

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
  /** Repeating things that are due (DESIGN.md §6.1), stalest first: their own group. */
  chores: Item[];
}

export interface Progress {
  done: number;
  total: number;
}

export class View {
  private kids = new Map<Id | null, Item[]>();
  private colors: Map<string, number> | undefined;

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
    const chores = open
      .filter((i) => i.repeat && !shown.has(i.id) && !snoozed(i, day))
      .map((i) => ({ i, r: repeatState(i, day)! }))
      .filter(({ r }) => r.due)
      .sort((a, b) => (b.r.ratio ?? 99) - (a.r.ratio ?? 99) || (a.r.next ?? "").localeCompare(b.r.next ?? "") || byPosition(a.i, b.i))
      .map(({ i }) => i);
    for (const i of chores) shown.add(i.id);
    const quickWins = open
      .filter(
        (i) =>
          !shown.has(i.id) &&
          !i.repeat &&
          (i.tier === "chip" || i.tier === "hard") &&
          this.children(i.id).every((c) => c.status !== "open") &&
          !this.blocked(i) &&
          (i.nextAction !== "" || (i.estMinutes !== null && i.estMinutes <= 20)),
      )
      .sort((a, b) => a.updatedAt - b.updatedAt)
      .slice(0, 3);
    return { planned, onDeck, deadlines, quickWins, chores };
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
        matchesArea(i, area) &&
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

  /** The same items by area (A–Z, no area last), tiers in All's order within each. */
  byArea(filter: { q?: string; area?: string; withDone?: boolean } = {}): { area: string; items: Item[] }[] {
    const groups = new Map<string, { area: string; items: Item[] }>();
    for (const i of this.all(filter).flatMap((g) => g.items)) {
      const key = i.area.toLowerCase();
      const g = groups.get(key) ?? { area: i.area, items: [] };
      g.items.push(i);
      groups.set(key, g);
    }
    return [...groups.values()].sort((a, b) => (!a.area ? 1 : !b.area ? -1 : a.area.localeCompare(b.area)));
  }

  /** The area an item counts under: a step's is its top-level item's. */
  areaOf(i: Item): string {
    return this.ancestors(i.id)[0]?.area ?? i.area;
  }

  /** Which area color (0…) an area gets: its place among the areas in use, A–Z. Null for none. */
  areaColor(area: string): number | null {
    if (!area) return null;
    if (!this.colors) {
      const used = new Set(Object.values(this.state.items).filter((i) => !i.deleted && !i.parentId && i.area).map((i) => i.area.toLowerCase()));
      this.colors = new Map([...used].sort().map((a, n) => [a, n % AREA_COLORS]));
    }
    return this.colors.get(area.toLowerCase()) ?? null;
  }

  /**
   * What could be done next (DESIGN.md §5.4): hard and chip items, not waiting on anything. A
   * project offers its first open step rather than the whole of itself; the back burner and notes
   * aren't offered.
   */
  doable(area = ""): Item[] {
    const next = (i: Item): Item | null => {
      if (!isOpen(i) || this.blocked(i)) return null;
      // A repeating thing is offered only once it's due again.
      if (i.repeat && !repeatState(i)!.due) return null;
      if (snoozed(i)) return null;
      const steps = this.children(i.id).filter(isOpen);
      if (!steps.length) return i;
      for (const s of steps) {
        const found = next(s);
        if (found) return found;
      }
      return null;
    };
    return this.children_(null)
      .filter((i) => (i.tier === "chip" || i.tier === "hard") && matchesArea(i, area))
      .map(next)
      .filter((i): i is Item => !!i);
  }

  /** A few doable things, in an order fixed by `seed` (the day). Skipped ones come back only when nothing else is left. */
  pick(seed: string, n: number, area = "", skipped: readonly Id[] = []): Item[] {
    const order = this.doable(area).sort((a, b) => hash(seed + a.id) - hash(seed + b.id) || a.id.localeCompare(b.id));
    const skip = new Set(skipped);
    return [...order.filter((i) => !skip.has(i.id)), ...order.filter((i) => skip.has(i.id))].slice(0, n);
  }
}
