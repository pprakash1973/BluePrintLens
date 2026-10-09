import { NextRequest, NextResponse } from "next/server";
import { asc, and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { comments, approvals } from "@/lib/schema";
import { requireRole, isResponse } from "@/lib/auth";
import { newId } from "@/lib/bp";

type Ctx = { params: Promise<{ id: string; stepId: string }> };

export async function GET(_: NextRequest, { params }: Ctx) {
  const { id, stepId } = await params;
  const db = await getDb();
  const c = await db.select().from(comments).where(and(eq(comments.blueprintId, id), eq(comments.stepId, stepId))).orderBy(asc(comments.createdAt));
  const a = await db.select().from(approvals).where(and(eq(approvals.blueprintId, id), eq(approvals.stepId, stepId))).orderBy(asc(approvals.createdAt));
  return NextResponse.json({ comments: c, approvals: a });
}

/** body: { comment?: string } or { approval: "approved"|"changes_requested", note? } (FR-24). Reviewers and authors only. */
export async function POST(req: NextRequest, { params }: Ctx) {
  const u = await requireRole("reviewer");
  if (isResponse(u)) return u;
  const { id, stepId } = await params;
  const body = await req.json();
  const db = await getDb();
  if (typeof body.comment === "string" && body.comment.trim()) {
    await db.insert(comments).values({ id: newId("c"), blueprintId: id, stepId, userId: u.id, userName: u.name, body: body.comment.trim().slice(0, 2000) });
  } else if (body.approval === "approved" || body.approval === "changes_requested") {
    await db.insert(approvals).values({ id: newId("a"), blueprintId: id, stepId, userId: u.id, userName: u.name, status: body.approval, note: String(body.note ?? "").slice(0, 1000) });
  } else {
    return NextResponse.json({ error: "Nothing to save" }, { status: 400 });
  }
  return NextResponse.json({ ok: true });
}
