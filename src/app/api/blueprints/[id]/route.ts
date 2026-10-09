import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { documents, jobs, versions, blueprints, comments, approvals, evidence } from "@/lib/schema";
import { requireRole, isResponse } from "@/lib/auth";
import { getBlueprint } from "@/lib/bp";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const bp = await getBlueprint(id);
  if (!bp) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const db = await getDb();
  const vs = await db.select({ id: versions.id, versionNo: versions.versionNo, status: versions.status, changeSummary: versions.changeSummary, publishedBy: versions.publishedBy, createdAt: versions.createdAt })
    .from(versions).where(eq(versions.blueprintId, id)).orderBy(desc(versions.versionNo));
  const docs = await db.select({ id: documents.id, filename: documents.filename, sizeBytes: documents.sizeBytes, pageCount: documents.pageCount, createdAt: documents.createdAt })
    .from(documents).where(eq(documents.blueprintId, id)).orderBy(desc(documents.createdAt));
  const [job] = await db.select({ id: jobs.id, status: jobs.status, nextChunk: jobs.nextChunk, chunks: jobs.chunks, error: jobs.error })
    .from(jobs).where(eq(jobs.blueprintId, id)).orderBy(desc(jobs.createdAt)).limit(1);
  return NextResponse.json({
    blueprint: bp, versions: vs, documents: docs,
    job: job ? { id: job.id, status: job.status, done: job.nextChunk, total: job.chunks.length, error: job.error } : null,
  });
}

export async function DELETE(_: NextRequest, { params }: Ctx) {
  const u = await requireRole("author");
  if (isResponse(u)) return u;
  const { id } = await params;
  const db = await getDb();
  await db.delete(comments).where(eq(comments.blueprintId, id));
  await db.delete(approvals).where(eq(approvals.blueprintId, id));
  await db.delete(evidence).where(eq(evidence.blueprintId, id));
  await db.delete(versions).where(eq(versions.blueprintId, id));
  await db.delete(jobs).where(eq(jobs.blueprintId, id));
  await db.delete(documents).where(eq(documents.blueprintId, id));
  await db.delete(blueprints).where(eq(blueprints.id, id));
  return NextResponse.json({ ok: true });
}
