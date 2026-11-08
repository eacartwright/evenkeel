import { newId } from "@evenkeel/shared";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { DB } from "./db";

// Files: attachments on dev notes. Each is stored once, under its id, in a folder beside the
// database (backed up with it, backup.ts); its name and type are in the `files` table. Same as
// foodlab's and sideshow's files.ts. Served at /api/files/<id>.

export interface FileInfo {
  id: string;
  name: string;
  type: string;
  size: number;
  createdAt: number;
}

/** The largest file accepted, in bytes. */
export const MAX_FILE = 25 * 1024 * 1024;

/** A file name safe to keep and to put in a URL path: no folders, no control characters. */
export function cleanName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f<>:"|?*]/g, "").trim().slice(0, 120);
  return clean || "file";
}

export class FileStore {
  constructor(
    private db: DB,
    readonly dir: string,
  ) {
    mkdirSync(dir, { recursive: true });
  }

  save(data: Uint8Array, name: string, type: string): FileInfo {
    const info: FileInfo = {
      id: newId(),
      name: cleanName(name),
      type: type || "application/octet-stream",
      size: data.byteLength,
      createdAt: Date.now(),
    };
    writeFileSync(join(this.dir, info.id), data);
    this.db
      .prepare("INSERT INTO files (id, name, type, size, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(info.id, info.name, info.type, info.size, info.createdAt);
    return info;
  }

  info(id: string): FileInfo | null {
    const r = this.db.prepare("SELECT * FROM files WHERE id = ?").get(id) as any;
    return r ? { id: r.id, name: r.name, type: r.type, size: r.size, createdAt: r.created_at } : null;
  }

  /** The file's bytes, or null if it's unknown or missing on disk. */
  read(id: string): { info: FileInfo; data: Buffer } | null {
    const info = this.info(id);
    const path = info && join(this.dir, info.id);
    if (!info || !path || !existsSync(path)) return null;
    return { info, data: readFileSync(path) };
  }

  /** Where a note links to a file. */
  static url(info: Pick<FileInfo, "id" | "name">) {
    return `/api/files/${info.id}/${encodeURIComponent(info.name)}`;
  }
}

