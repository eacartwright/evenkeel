import type { Attachment } from "@evenkeel/shared";

// Files on dev notes go straight to the server (POST /api/files), which keeps them and answers
// with an id; the note that shows them is saved through the outbox as usual. Unlike edits, an
// upload needs the server: it isn't queued while offline. Same as foodlab's and sideshow's.

/** The server's limit (files.ts MAX_FILE). */
export const MAX_UPLOAD = 25 * 1024 * 1024;

async function send(body: Blob, name: string, type: string): Promise<string> {
  if (body.size > MAX_UPLOAD) throw new Error(`${name} is over ${MAX_UPLOAD / 1024 / 1024} MB`);
  let res: Response;
  try {
    res = await fetch("/api/files", {
      method: "POST",
      headers: { "content-type": type || "application/octet-stream", "x-file-name": encodeURIComponent(name) },
      body,
      redirect: "manual",
    });
  } catch {
    throw new Error("Couldn't upload: no connection to evenkeel. Try again when online");
  }
  if (res.type === "opaqueredirect" || res.status === 401 || res.status === 403) throw new Error("Signed out: reload to sign in, then add it again");
  if (res.status === 413) throw new Error(`${name} is too big`);
  if (!res.ok) throw new Error("Couldn't upload it: try again");
  return ((await res.json()) as { id: string }).id;
}

const stamp = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

/** A file for a dev note, as it is (a screenshot should stay sharp). A pasted one is "image.png": name it by when. */
export async function uploadFile(file: File): Promise<Attachment> {
  const name = file.name && file.name !== "image.png" ? file.name : `screenshot-${stamp()}.${file.type.split("/")[1]?.replace("jpeg", "jpg") ?? "png"}`;
  return { id: await send(file, name, file.type), name, type: file.type };
}
