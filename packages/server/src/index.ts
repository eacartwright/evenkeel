import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Invalid, KINDS, type Kind } from "@evenkeel/shared";
import { startBackups } from "./backup";
import { openDb } from "./db";
import { writeDevNotes } from "./devNotesFile";
import { FileStore, MAX_FILE } from "./files";
import { Store } from "./store";

const PORT = Number(process.env.PORT ?? 8789);
const DB_FILE = process.env.EVENKEEL_DB ?? fileURLToPath(new URL("../../../data/evenkeel.db", import.meta.url));
const BACKUP_DIR = process.env.EVENKEEL_BACKUP_DIR || join(dirname(DB_FILE), "backups");
const WEB_DIST = fileURLToPath(new URL("../../web/dist", import.meta.url));
const DEV_NOTES_FILE = join(dirname(DB_FILE), "dev-notes.md");
const FILES_DIR = process.env.EVENKEEL_FILES_DIR ?? join(dirname(DB_FILE), "files");

const db = openDb(DB_FILE);
const store = new Store(db);
const files = new FileStore(db, FILES_DIR);
const backups = startBackups(db, BACKUP_DIR, FILES_DIR, "evenkeel");
writeDevNotes(DEV_NOTES_FILE, store.state);

// The build being served, named by its hashed script ("/assets/index-Bx3k.js"). The app compares
// it with its own and offers Update when they differ (an installed app can run for days).
const BUILD = existsSync(join(WEB_DIST, "index.html"))
  ? (/src="(\/assets\/[^"]+\.js)"/.exec(readFileSync(join(WEB_DIST, "index.html"), "utf8"))?.[1] ?? "")
  : "";

export const app = new Hono();

if (BUILD)
  app.use("/api/*", async (c, next) => {
    await next();
    c.header("X-Evenkeel-Build", BUILD);
  });

app.get("/api/health", (c) => c.json({ ok: true, rev: store.rev, lastBackup: backups.latest() }));

// A file, by id (dev note attachments). The name after it is for people and is ignored.
// Never changes, so cached for good. (Same as foodlab.)
app.get("/api/files/:id/:name?", (c) => {
  const id = c.req.param("id");
  const file = /^[0-9a-f-]{36}$/.test(id) ? files.read(id) : null;
  if (!file) return c.json({ error: "No such file" }, 404);
  const inline = /^(image\/(png|jpeg|gif|webp)|application\/pdf|text\/plain)$/.test(file.info.type);
  return new Response(new Uint8Array(file.data), {
    headers: {
      "content-type": file.info.type,
      "content-length": String(file.info.size),
      "cache-control": "private, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.info.name)}`,
    },
  });
});

// Upload: the raw bytes as the body, the type as Content-Type, the name in X-File-Name
// (URL-encoded). Answers with the file's id; the note that uses it is saved separately.
app.post("/api/files", async (c) => {
  const tooBig = { error: `Files can be up to ${MAX_FILE / 1024 / 1024} MB` };
  if (Number(c.req.header("content-length") ?? 0) > MAX_FILE) return c.json(tooBig, 413);
  const data = new Uint8Array(await c.req.arrayBuffer());
  if (!data.byteLength) return c.json({ error: "Empty file" }, 400);
  if (data.byteLength > MAX_FILE) return c.json(tooBig, 413);
  let name = "file";
  try {
    name = decodeURIComponent(c.req.header("x-file-name") ?? "file");
  } catch {
    // Not URL-encoded: keep "file".
  }
  return c.json(files.save(data, name, c.req.header("content-type") ?? ""));
});

// Everything, for the app to keep a copy of. A personal task list is small; the ETag lets a
// device that's up to date get a 304 instead.
app.get("/api/state", (c) => {
  const etag = `"rev-${store.rev}"`;
  if (c.req.header("if-none-match") === etag) return c.body(null, 304, { ETag: etag });
  c.header("ETag", etag);
  c.header("Cache-Control", "no-cache");
  return c.json(store.state);
});

// Save one whole record (DESIGN.md §9). Idempotent: the outbox may send the same version twice.
app.put("/api/:kind/:id", async (c) => {
  const kind = c.req.param("kind") as Kind;
  if (!KINDS.includes(kind)) return c.json({ error: "No such kind" }, 404);
  // Only JSON (a page on another site can't send that without the browser asking first).
  if (!(c.req.header("content-type") ?? "").startsWith("application/json")) return c.json({ error: "Expected JSON" }, 415);
  const body = await c.req.json().catch(() => undefined);
  if (body === undefined) return c.json({ error: "Expected JSON" }, 400);
  try {
    const saved = store.put(kind, c.req.param("id"), body);
    if (kind === "devnotes") writeDevNotes(DEV_NOTES_FILE, store.state);
    return c.json(saved);
  } catch (err) {
    if (err instanceof Invalid) return c.json({ error: err.message }, 400);
    console.error(err);
    store.reload();
    return c.json({ error: "Couldn't save" }, 500);
  }
});

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// In production the server also serves the built web app.
if (existsSync(WEB_DIST)) {
  // Built assets have hashed names and never change. Everything else (index.html, the manifest)
  // must be revalidated, or the installed app keeps running an old build.
  app.use("/*", async (c, next) => {
    await next();
    if (c.req.path.startsWith("/api/files/")) return; // its own: cached for good
    c.header("Cache-Control", c.req.path.startsWith("/assets/") ? "public, max-age=31536000, immutable" : "no-cache");
  });
  app.use("/*", serveStatic({ root: WEB_DIST }));
  // Any other path is a page of the app (/items/…, /share?…).
  app.get("*", serveStatic({ path: `${WEB_DIST}/index.html` }));
}

serve({ fetch: app.fetch, port: PORT, hostname: "0.0.0.0" }, (info) => {
  console.log(`evenkeel server on http://localhost:${info.port}  (db: ${DB_FILE}, files: ${FILES_DIR}, backups: ${BACKUP_DIR})`);
});
