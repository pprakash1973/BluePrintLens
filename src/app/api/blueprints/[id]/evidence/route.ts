import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { evidence } from "@/lib/schema";
import { requireRole, isResponse } from "@/lib/auth";
import { newId } from "@/lib/bp";
import type { EvidenceStats } from "@/lib/evidence";

type Ctx = { params: Promise<{ id: string }> };

/** Latest evidence (event-log statistics) for this blueprint. */
export async function GET(_: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const db = await getDb();
  const [row] = await db.select().from(evidence).where(eq(evidence.blueprintId, id)).orderBy(desc(evidence.createdAt)).limit(1);
  return NextResponse.json({ evidence: row ? { ...row.stats, uploadedBy: row.uploadedBy, uploadedAt: row.createdAt } : null });
}

/** Store aggregated statistics computed in the browser (the raw event log never leaves the user's machine). */
export async function POST(req: NextRequest, { params }: Ctx) {
  const u = await requireRole("author");
  if (isResponse(u)) return u;
  const { id } = await params;
  const stats = (await req.json()) as EvidenceStats;
  if (!stats || typeof stats.cases !== "number" || !stats.steps) return NextResponse.json({ error: "Invalid evidence" }, { status: 400 });
  if (JSON.stringify(stats).length > 2_000_000) return NextResponse.json({ error: "Evidence summary too large" }, { status: 413 });
  const db = await getDb();
  await db.insert(evidence).values({ id: newId("ev"), blueprintId: id, stats, uploadedBy: u.name });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_: NextRequest, { params }: Ctx) {
  const u = await requireRole("author");
  if (isResponse(u)) return u;
  const { id } = await params;
  const db = await getDb();
  await db.delete(evidence).where(eq(evidence.blueprintId, id));
  return NextResponse.json({ ok: true });
}
