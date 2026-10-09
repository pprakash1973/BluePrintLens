import fs from "node:fs/promises";
import path from "node:path";

const LOCAL_DIR = process.env.LOCAL_STORAGE_DIR ?? ".data/files";
export const blobEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;
export const BLOB_ACCESS = (process.env.BLOB_ACCESS ?? "private") as "private" | "public";

const safe = (key: string) => key.replace(/[^a-zA-Z0-9._/-]/g, "_").replace(/\.\.+/g, ".");

/** Save a file; returns the storage key (local path key or blob pathname). */
export async function putFile(key: string, data: Buffer, contentType: string): Promise<string> {
  if (blobEnabled()) {
    const { put } = await import("@vercel/blob");
    const r = await put(key, data, { access: BLOB_ACCESS, contentType, addRandomSuffix: true });
    return r.pathname;
  }
  const file = path.join(LOCAL_DIR, safe(key));
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, data);
  return safe(key);
}

export async function getFile(key: string): Promise<Buffer> {
  if (blobEnabled()) {
    const { get } = await import("@vercel/blob");
    const r = await get(key, { access: BLOB_ACCESS });
    if (!r || !r.stream) throw new Error("File not found in storage");
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  }
  return fs.readFile(path.join(LOCAL_DIR, safe(key)));
}
