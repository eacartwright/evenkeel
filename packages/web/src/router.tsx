import { useSyncExternalStore, type AnchorHTMLAttributes, type MouseEvent } from "react";

// Plain paths (/foods/<id>), so the phone's back button and shared links work.

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((fn) => fn());
window.addEventListener("popstate", emit);

// Compared as raw text: URLSearchParams writes "a b" as "a+b" where the address may say "a%20b",
// and a snapshot that never matches makes React re-render forever.
let snap = { path: location.pathname, search: location.search, query: new URLSearchParams(location.search) };
function current() {
  if (snap.path !== location.pathname || snap.search !== location.search) {
    snap = { path: location.pathname, search: location.search, query: new URLSearchParams(location.search) };
  }
  return snap;
}

export function useRoute() {
  return useSyncExternalStore((fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }, current);
}

export function go(to: string, opts: { replace?: boolean } = {}) {
  if (to === location.pathname + location.search) return;
  if (opts.replace) history.replaceState(null, "", to);
  else history.pushState(null, "", to);
  if (!opts.replace) window.scrollTo(0, 0);
  emit();
}

/** Change the query (?q=…) without a new history entry. */
export function setQuery(params: Record<string, string | null>) {
  const q = new URLSearchParams(location.search);
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === "") q.delete(k);
    else q.set(k, v);
  }
  const s = q.toString();
  history.replaceState(history.state, "", location.pathname + (s ? `?${s}` : ""));
  emit();
}

/** A link that navigates in the app (Ctrl/middle click still open a new tab). */
export function A({ href, onClick, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(e: MouseEvent<HTMLAnchorElement>) => {
        onClick?.(e);
        if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        go(href);
      }}
      {...rest}
    />
  );
}

