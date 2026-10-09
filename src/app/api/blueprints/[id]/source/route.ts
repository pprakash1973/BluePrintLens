import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { documents } from "@/lib/schema";
import { requireRole, isResponse } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

/** Source excerpt for a sourceRef like "p.14", "p.14-15" or "§3 Invoice Handling" (FR-08, FR-11). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const u = await requireRole("reviewer");
  if (isResponse(u)) return u;
  const { id } = await params;
  const ref = (req.nextUrl.searchParams.get("ref") ?? "").trim();
  const db = await getDb();
  const docs = await db.select().from(documents).where(eq(documents.blueprintId, id));
  const all = docs.flatMap((d) => d.content.map((s) => ({ ...s, doc: d.filename })));

  let hits: typeof all = [];
  const pages = ref.match(/^p\.?\s*(\d+)(?:\s*[-–]\s*(\d+))?$/i);
  if (pages) {
    const a = Number(pages[1]), b = Number(pages[2] ?? pages[1]);
    hits = all.filter((s) => { const m = s.ref.match(/^p\.(\d+)$/); return m && Number(m[1]) >= a && Number(m[1]) <= b; });
  } else if (ref) {
    const lower = ref.toLowerCase();
    hits = all.filter((s) => s.ref.toLowerCase() === lower);
    if (!hits.length) hits = all.filter((s) => s.ref.toLowerCase().includes(lower) || lower.includes(s.title.toLowerCase()));
  }
  return NextResponse.json({ ref, sections: hits.slice(0, 4).map((s) => ({ ref: s.ref, doc: s.doc, text: s.text.slice(0, 6000) })) });
}
