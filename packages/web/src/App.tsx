import { useEffect, useRef, useState } from "react";
import { AllPage } from "./components/AllPage";
import { CapturePage } from "./components/CapturePage";
import { DevNotesDialog } from "./components/DevNotes";
import { InboxPage } from "./components/InboxPage";
import { ItemPage } from "./components/ItemPage";
import { closeQuickAddFromBack, fromShare, openQuickAdd, QuickAdd, useQuickAdd } from "./components/QuickAdd";
import { SettingsDialog } from "./components/Settings";
import { TodayPage } from "./components/TodayPage";
import { A, go, useRoute } from "./router";
import { signIn, useData } from "./sync";
import { dismissToast, useToast } from "./toast";

const NAV = [
  { href: "/", label: "Capture", icon: "✍️" },
  { href: "/inbox", label: "Inbox", icon: "📥" },
  { href: "/today", label: "Today", icon: "☀️" },
  { href: "/all", label: "All", icon: "🗂️" },
] as const;

/** The phone's tab bar, Capture rightmost: the right thumb reaches the right end best. More opens the drawer. */
const TABS = [
  { href: "/today", label: "Today", icon: "☀️" },
  { href: "/all", label: "All", icon: "🗂️" },
  { href: "/inbox", label: "Inbox", icon: "📥" },
  { href: "/", label: "Capture", icon: "✍️" },
] as const;

const isTyping = (el: EventTarget | null) => el instanceof HTMLElement && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName));

function Page() {
  const { path } = useRoute();
  const m = /^\/items\/([^/]+)$/.exec(path);
  if (m) {
    const id = decodeURIComponent(m[1]!);
    return <ItemPage key={id} id={id} />;
  }
  switch (path) {
    case "/inbox":
      return <InboxPage />;
    case "/today":
      return <TodayPage />;
    case "/all":
      return <AllPage />;
    default:
      return <CapturePage />;
  }
}

/** A count beside a nav entry. Its own component so a save doesn't redraw the whole app. */
function Count({ of }: { of: string }) {
  const { view } = useData();
  const n = of === "/inbox" ? view.inbox().length : of === "/today" ? view.todayCount() : 0;
  return n > 0 ? <span className="nav-count">{n}</span> : null;
}

function Status() {
  const { status, pending, update } = useData();
  if (update && status === "synced" && !pending)
    return (
      <button className="sync sync-update" onClick={() => location.reload()} title="A new version of Evenkeel is on the server">
        ↻ Update
      </button>
    );
  if (status === "signedout")
    return (
      <button className="sync sync-warn" onClick={signIn}>
        Signed out · Sign in
      </button>
    );
  const text =
    status === "loading"
      ? "Loading…"
      : status === "offline"
        ? pending
          ? `Offline · ${pending} waiting`
          : "Offline"
        : pending
          ? `Saving ${pending}…`
          : "Saved";
  return (
    <span className={`sync ${status === "offline" ? "sync-warn" : status === "synced" && !pending ? "" : "sync-wait"}`} title={status}>
      <span className="sync-dot" />
      {text}
    </span>
  );
}

export function App() {
  const { path } = useRoute();
  const quick = useQuickAdd();
  const [drawer, setDrawer] = useState(false);
  const [settings, setSettings] = useState(false);
  const [devNotes, setDevNotes] = useState(false);
  const toast = useToast();

  // Share to Evenkeel lands on /share?title=…&text=…&url=…: open Quick add with it.
  useEffect(() => {
    if (location.pathname === "/share") {
      const init = fromShare(new URLSearchParams(location.search));
      go("/", { replace: true });
      openQuickAdd(init);
    }
  }, []);

  // The phone's Back closes an open panel instead of leaving the page.
  const overlayOpen = !!quick || drawer || settings || devNotes;
  const pushed = useRef(false);
  useEffect(() => {
    if (overlayOpen && !pushed.current) {
      history.pushState({ overlay: true }, "", location.href);
      pushed.current = true;
    } else if (!overlayOpen && pushed.current) {
      pushed.current = false;
      if (history.state?.overlay) history.back();
    }
  }, [overlayOpen]);
  useEffect(() => {
    const onPop = () => {
      if (pushed.current) {
        pushed.current = false;
        setDrawer(false);
        setSettings(false);
        setDevNotes(false);
        if (quick) closeQuickAddFromBack();
      }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [quick]);

  // Navigating closes the drawer.
  useEffect(() => setDrawer(false), [path]);

  // Keyboard: Alt+N adds; C, I, T, A go to the pages (when not typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.code === "KeyN") {
        e.preventDefault();
        openQuickAdd();
        return;
      }
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector(".backdrop")) return;
      const to = { c: "/", i: "/inbox", t: "/today", a: "/all" }[e.key.toLowerCase()];
      if (to) {
        e.preventDefault();
        go(to);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const active = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`));
  const nav = (
    <nav className="nav" aria-label="Main">
      {NAV.map((n) => (
        <A key={n.href} href={n.href} className={active(n.href) ? "active" : ""} aria-current={active(n.href) ? "page" : undefined}>
          <span className="nav-icon">{n.icon}</span>
          {n.label}
          <Count of={n.href} />
        </A>
      ))}
    </nav>
  );

  // Sync status left; dev notes and settings right.
  const foot = (
    <div className="sidebar-foot">
      <Status />
      <span className="spacer" />
      <button
        className="btn icon subtle"
        aria-label="Dev Notes"
        title="Dev Notes"
        onClick={() => {
          setDrawer(false);
          setDevNotes(true);
        }}
      >
        🧪
      </button>
      <button
        className="btn icon subtle"
        aria-label="Settings"
        title="Settings"
        onClick={() => {
          setDrawer(false);
          setSettings(true);
        }}
      >
        ⚙️
      </button>
    </div>
  );

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <A href="/">evenkeel</A>
        </div>
        <button className="btn primary add-btn" onClick={() => openQuickAdd()}>
          + Add
        </button>
        {nav}
        {foot}
      </aside>

      <header className="topbar">
        <A href="/" className="brand">
          evenkeel
        </A>
        <span className="spacer" />
        <Status />
      </header>

      {drawer && (
        <div className="drawer-backdrop" onClick={() => setDrawer(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="brand">evenkeel</div>
            {nav}
            {foot}
          </div>
        </div>
      )}

      <main className="main">
        <Page />
      </main>

      {path !== "/" && (
        <button className="fab" aria-label="Add" onClick={() => openQuickAdd()}>
          +
        </button>
      )}

      <nav className="tabbar" aria-label="Tabs">
        <button className={drawer ? "active" : ""} aria-expanded={drawer} onClick={() => setDrawer(!drawer)}>
          <span className="tab-icon">☰</span>
          More
        </button>
        {TABS.map((t) => (
          <A key={t.href} href={t.href} className={active(t.href) && !drawer ? "active" : ""} aria-current={active(t.href) ? "page" : undefined} onClick={() => setDrawer(false)}>
            <span className="tab-icon">
              {t.icon}
              <Count of={t.href} />
            </span>
            {t.label}
          </A>
        ))}
      </nav>

      {quick && <QuickAdd key={JSON.stringify(quick)} init={quick} />}
      {settings && <SettingsDialog onClose={() => setSettings(false)} />}
      {devNotes && <DevNotesDialog onClose={() => setDevNotes(false)} />}
      {toast && (
        <div className="toast" role="status" key={toast.id}>
          <span>{toast.text}</span>
          {toast.action && (
            <button
              className="btn subtle"
              onClick={() => {
                toast.action!.run();
                dismissToast();
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="btn icon subtle" aria-label="Dismiss" onClick={dismissToast}>
            ✕
          </button>
        </div>
      )}
    </div>
  );
}
