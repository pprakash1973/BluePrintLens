import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { jobs, documents } from "@/lib/schema";
import { requireRole, isResponse } from "@/lib/auth";
import { processChunk, finalizeModel } from "@/lib/extract";
import { saveDraft } from "@/lib/bp";

export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

const view = (j: typeof jobs.$inferSelect) => ({
  id: j.id, status: j.status, done: j.nextChunk, total: j.chunks.length, error: j.error, log: j.log.slice(-12), mode: j.mode,
  counts: { processes: j.partial.processes.length, steps: j.partial.steps.length, links: j.partial.links.length },
});

export async function GET(_: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const db = await getDb();
  const [j] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!j) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(view(j));
}

/** Process the next chunk. The browser calls this repeatedly until status is "done" (keeps each call inside the function time limit). */
export async function POST(_: NextRequest, { params }: Ctx) {
  const u = await requireRole("author");
  if (isResponse(u)) return u;
  const { id } = await params;
  const db = await getDb();
  const [j] = await db.select().from(jobs).where(eq(jobs.id, id));
  if (!j) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (j.status === "done") return NextResponse.json(view(j));

  const [doc] = await db.select().from(documents).where(eq(documents.id, j.documentId));
  try {
    const idx = j.nextChunk;
    const chunk = j.chunks[idx];
    const r = await processChunk({
      mode: j.mode as "ai" | "offline", partial: j.partial, chunk, idx: `${j.id.slice(-4)}${idx}`,
      storageKey: doc.storageKey, sections: doc.content,
    });
    const last = idx + 1 >= j.chunks.length;
    const model = last ? finalizeModel(r.model, doc.filename.replace(/\.[^.]+$/, "")) : r.model;
    if (last) await saveDraft(j.blueprintId, model);
    await db.update(jobs).set({
      partial: model, nextChunk: idx + 1, status: last ? "done" : "running", error: null,
      log: [...j.log, r.log], updatedAt: new Date(),
    }).where(eq(jobs.id, id));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db.update(jobs).set({ status: "error", error: msg.slice(0, 500), updatedAt: new Date() }).where(eq(jobs.id, id));
    return NextResponse.json({ error: msg }, { status: 500 });
  }
  const [fresh] = await db.select().from(jobs).where(eq(jobs.id, id));
  return NextResponse.json(view(fresh));
}

/** Retry a failed job from the failed chunk. */
export async function PUT(_: NextRequest, { params }: Ctx) {
  const u = await requireRole("author");
  if (isResponse(u)) return u;
  const { id } = await params;
  const db = await getDb();
  await db.update(jobs).set({ status: "running", error: null }).where(eq(jobs.id, id));
  return NextResponse.json({ ok: true });
}
