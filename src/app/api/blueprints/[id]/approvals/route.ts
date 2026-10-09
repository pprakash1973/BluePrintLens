import { NextRequest, NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { comments, approvals } from "@/lib/schema";

type Ctx = { params: Promise<{ id: string }> };

/** Latest approval status and comment count per step, for badges in the viewer. */
export async function GET(_: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const db = await getDb();
  const a = await db.select().from(approvals).where(eq(approvals.blueprintId, id)).orderBy(asc(approvals.createdAt));
  const c = await db.select({ stepId: comments.stepId }).from(comments).where(eq(comments.blueprintId, id));
  const latest: Record<string, { status: string; by: string; at: string }> = {};
  for (const x of a) latest[`${x.stepId}:${x.userId}`] = { status: x.status, by: x.userName, at: x.createdAt.toISOString() };
  const perStep: Record<string, { approved: number; changes: number; comments: number }> = {};
  for (const [k, v] of Object.entries(latest)) {
    const sid = k.split(":")[0];
    perStep[sid] ??= { approved: 0, changes: 0, comments: 0 };
    if (v.status === "approved") perStep[sid].approved++; else perStep[sid].changes++;
  }
  for (const x of c) { perStep[x.stepId] ??= { approved: 0, changes: 0, comments: 0 }; perStep[x.stepId].comments++; }
  return NextResponse.json({ perStep, trail: a.map((x) => ({ stepId: x.stepId, by: x.userName, status: x.status, note: x.note, at: x.createdAt })) });
}
