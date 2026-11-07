import { emptyState, KINDS, nameOf, View, type AnyRecord, type Id, type Kind, type Records, type State } from "@evenkeel/shared";
import { useSyncExternalStore } from "react";
import { showToast } from "./toast";

// The app's copy of the data (DESIGN.md §9). The server's state, cached in localStorage for
// reading offline, with an outbox of whole records waiting to be saved laid over it. Saves are
// idempotent and last-write-wins, so the outbox keeps only the latest version of each record,
// in the order they were first changed (a new item goes before the step that points at it).

const STATE_KEY = "evenkeel:state";
const OUTBOX_KEY = "evenkeel:outbox";

interface Pending {
  kind: Kind;
  id: Id;
  body: AnyRecord;
  /** Bumped each time the record changes again while waiting, so a reply for an older version doesn't clear a newer one. */
  seq: number;
}

export type SyncStatus = "loading" | "synced" | "saving" | "offline" | "signedout";

function read<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Full or blocked: the in-memory copy still works until the page closes.
  }
}

let server: State = { ...emptyState(), ...read<State>(STATE_KEY, emptyState()) };
let outbox: Pending[] = read<Pending[]>(OUTBOX_KEY, []);
let status: SyncStatus = server.rev ? "synced" : "loading";
let loaded = server.rev > 0;
let seq = outbox.reduce((n, p) => Math.max(n, p.seq), 0);
let snapshot: { state: State; view: View; status: SyncStatus; pending: number; loaded: boolean; update: boolean } | null = null;
// This page's build, named like the server names it (its hashed script); none in dev.
const BUILD = document.querySelector('script[type="module"][src^="/assets/"]')?.getAttribute("src") ?? "";
/** The server has a newer build than the one running here (DESIGN.md §9). */
let update = false;
const listeners = new Set<() => void>();

function emit() {
  snapshot = null;
  listeners.forEach((fn) => fn());
}

function current() {
  if (!snapshot) {
    const state: State = { ...server };
    for (const k of KINDS) state[k] = { ...server[k] } as never;
    for (const p of outbox) (state[p.kind] as Record<Id, AnyRecord>)[p.id] = p.body;
    snapshot = { state, view: new View(state), status, pending: outbox.length, loaded, update };
  }
  return snapshot;
}

export function useData() {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    current,
  );
}

/** The data right now, outside React (actions read it before deciding what to save). */
export const data = () => current();

function setStatus(s: SyncStatus) {
  if (status !== s) {
    status = s;
    emit();
  }
}

/** Save a whole record: shown at once, sent when the server can be reached. */
export function put<K extends Kind>(kind: K, record: Records[K]) {
  const body = { ...record, updatedAt: Date.now() } as AnyRecord;
  const existing = outbox.find((p) => p.kind === kind && p.id === record.id);
  if (existing) {
    existing.body = body;
    existing.seq = ++seq;
  } else {
    outbox.push({ kind, id: record.id, body, seq: ++seq });
  }
  write(OUTBOX_KEY, outbox);
  emit();
  void flush();
}

function noteBuild(res: Response) {
  const b = res.headers.get("x-evenkeel-build");
  if (BUILD && b && (b !== BUILD) !== update) {
    update = b !== BUILD;
    emit();
  }
}

let flushing = false;
let retry: ReturnType<typeof setTimeout> | undefined;

async function flush() {
  if (flushing) return;
  flushing = true;
  clearTimeout(retry);
  try {
    while (outbox.length) {
      const p = outbox[0]!;
      const sentSeq = p.seq;
      setStatus("saving");
      let res: Response;
      try {
        res = await fetch(`/api/${p.kind}/${encodeURIComponent(p.id)}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(p.body),
          redirect: "manual",
        });
      } catch {
        setStatus("offline");
        retry = setTimeout(() => void flush(), 15_000);
        return;
      }
      if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) {
        // Cloudflare Access wants a fresh sign-in. Nothing is lost: it waits in the outbox.
        setStatus("signedout");
        return;
      }
      noteBuild(res);
      if (res.ok) {
        const r = (await res.json()) as { rev: number; record: AnyRecord };
        (server[p.kind] as Record<Id, AnyRecord>)[p.id] = r.record;
        server.rev = Math.max(server.rev, r.rev);
        write(STATE_KEY, server);
        // Changed again while this was on its way: keep it, so the newer version goes too.
        if (p.seq === sentSeq) outbox.shift();
      } else if (res.status >= 400 && res.status < 500) {
        // The server refused this record (a bug, not the connection). Drop it so the rest can go.
        const err = (await res.json().catch(() => null)) as { error?: string } | null;
        const name = `“${nameOf(p.body)}”`;
        showToast(`Couldn't save ${name}: ${err?.error ?? res.statusText}`, undefined, 12_000);
        outbox.shift();
      } else {
        setStatus("offline");
        retry = setTimeout(() => void flush(), 15_000);
        return;
      }
      write(OUTBOX_KEY, outbox);
      emit();
    }
    setStatus("synced");
  } finally {
    flushing = false;
  }
}

let etag: string | null = null;

/** Fetch the server's state if it changed. */
export async function refresh() {
  try {
    const res = await fetch("/api/state", { headers: etag && loaded ? { "if-none-match": etag } : {}, redirect: "manual" });
    if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) return setStatus("signedout");
    noteBuild(res);
    if (res.status === 304) return;
    if (!res.ok) return setStatus("offline");
    const next = (await res.json()) as State;
    etag = res.headers.get("etag");
    // A save that finished while this was loading may be newer than what came back.
    if (next.rev < server.rev && loaded) return;
    server = { ...emptyState(), ...next };
    loaded = true;
    write(STATE_KEY, server);
    if (status === "loading" || status === "offline" || status === "signedout") status = outbox.length ? "saving" : "synced";
    emit();
    if (outbox.length) void flush();
  } catch {
    setStatus("offline");
  }
}

export function start() {
  void refresh();
  if (outbox.length) void flush();
  const wake = async () => {
    if (document.visibilityState === "visible") {
      void flush();
      await refresh();
      // Back from the background with a new build waiting: take it now, before anything is
      // typed (drafts were saved on the way out). Otherwise it waits for ↻ Update.
      if (update && !outbox.length && (!document.activeElement || document.activeElement === document.body)) location.reload();
    }
  };
  document.addEventListener("visibilitychange", () => void wake());
  window.addEventListener("online", () => void wake());
  window.addEventListener("focus", () => void wake());
  setInterval(() => document.visibilityState === "visible" && void refresh(), 60_000);
}

/** Signed out of Cloudflare Access: reloading goes through its login and back. */
export function signIn() {
  location.reload();
}
