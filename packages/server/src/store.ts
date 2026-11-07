import { Invalid, View, validators, type AnyRecord, type Id, type Item, type Kind, type Records, type State } from "@evenkeel/shared";
import { getRev, loadState, save, setRev, transaction, type DB } from "./db";

// The authoritative state: held in memory, written through to SQLite on every save.
// A save is a whole record (DESIGN.md §9): validated, its links checked, given the next rev.

export class Store {
  state: State;

  constructor(private db: DB) {
    this.state = loadState(db);
  }

  get rev() {
    return this.state.rev;
  }

  /** Save one record. Returns it as stored. */
  put<K extends Kind>(kind: K, id: Id, body: unknown, now = Date.now()): { rev: number; record: Records[K] } {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) throw new Invalid("Bad id");
    const rec = validators[kind](body, id, now) as Records[K];
    const prev = this.state[kind][id] as Records[K] | undefined;
    if (prev) rec.createdAt = prev.createdAt;
    this.check(kind, rec);

    const rev = this.state.rev + 1;
    rec.rev = rev;
    transaction(this.db, () => {
      (save[kind] as (db: DB, x: AnyRecord) => void)(this.db, rec);
      setRev(this.db, rev);
    });
    (this.state[kind] as Record<Id, AnyRecord>)[id] = rec;
    this.state.rev = rev;
    return { rev, record: rec };
  }

  /** A step's parent must exist and can't be the step itself or below it; what it waits on must exist. */
  private check(kind: Kind, rec: AnyRecord) {
    if (kind !== "items") return;
    const i = rec as Item;
    const s = this.state;
    if (i.parentId) {
      if (!s.items[i.parentId]) throw new Invalid(`parent: no such item (${i.parentId})`);
      if (new View(s).wouldLoop(i.id, i.parentId)) throw new Invalid("An item can't be a step of itself");
    }
    for (const b of i.blockedBy) if (!s.items[b]) throw new Invalid(`waits on: no such item (${b})`);
  }

  /** Reload from disk (after a failed write left memory ahead of the file). */
  reload() {
    this.state = loadState(this.db);
    this.state.rev = getRev(this.db);
  }
}
