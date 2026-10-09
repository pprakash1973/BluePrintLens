import { NextRequest, NextResponse } from "next/server";
import { getVersionModel } from "@/lib/bp";
import { diffModels } from "@/lib/model";
import { requireRole, isResponse } from "@/lib/auth";

type Ctx = { params: Promise<{ id: string }> };

/** GET ?from=<n>&to=<n|draft> — step-level comparison (FR-14). */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const from = req.nextUrl.searchParams.get("from") ?? "latest";
  const to = req.nextUrl.searchParams.get("to") ?? "latest";
  if (to === "draft" || from === "draft") {
    const u = await requireRole("author");
    if (isResponse(u)) return u;
  }
  const a = await getVersionModel(id, from);
  const b = await getVersionModel(id, to);
  if (!a || !b) return NextResponse.json({ error: "Version not found" }, { status: 404 });
  const d = diffModels(a.model, b.model);
  const nameA = new Map(a.model.steps.map((s) => [s.id, s.name]));
  const nameB = new Map(b.model.steps.map((s) => [s.id, s.name]));
  return NextResponse.json({
    added: d.added.map((i) => ({ id: i, name: nameB.get(i) })),
    removed: d.removed.map((i) => ({ id: i, name: nameA.get(i) })),
    changed: d.changed.map((i) => ({ id: i, name: nameB.get(i), fields: d.details[i] })),
  });
}
