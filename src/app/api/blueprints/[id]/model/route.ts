import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { versions } from "@/lib/schema";
import { requireRole, isResponse } from "@/lib/auth";
import { getVersionModel, getDraft, listPublished, saveDraft, newId } from "@/lib/bp";
import { ProcessModelSchema, normalizeModel, diffModels } from "@/lib/model";

type Ctx = { params: Promise<{ id: string }> };

/** GET ?v=latest|draft|<n>  (draft only for authors) */
export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const v = req.nextUrl.searchParams.get("v") ?? "latest";
  if (v === "draft") {
    const u = await requireRole("author");
    if (isResponse(u)) return u;
  }
  const r = await getVersionModel(id, v);
  if (!r) return NextResponse.json({ error: "No such version" }, { status: 404 });
  return NextResponse.json(r);
}

/** Save the draft. */
export async function PUT(req: NextRequest, { params }: Ctx) {
  const u = await requireRole("author");
  if (isResponse(u)) return u;
  const { id } = await params;
  const parsed = ProcessModelSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid model", issues: parsed.error.issues.slice(0, 5) }, { status: 400 });
  await saveDraft(id, normalizeModel(parsed.data));
  return NextResponse.json({ ok: true });
}

/** Publish the draft as a new version (human review gate happens in the UI; publishing is author-only). */
export async function POST(req: NextRequest, { params }: Ctx) {
  const u = await requireRole("author");
  if (isResponse(u)) return u;
  const { id } = await params;
  const { changeSummary } = await req.json().catch(() => ({ changeSummary: "" }));
  const draft = await getDraft(id);
  if (!draft) return NextResponse.json({ error: "Nothing to publish" }, { status: 400 });
  if (!draft.model.steps.length) return NextResponse.json({ error: "The model has no steps" }, { status: 400 });
  const pubs = await listPublished(id);
  const next = (pubs[0]?.versionNo ?? 0) + 1;
  let summary = String(changeSummary ?? "").trim();
  if (!summary && pubs[0]) {
    const d = diffModels(pubs[0].model, draft.model);
    summary = `${d.added.length} added, ${d.changed.length} changed, ${d.removed.length} removed steps`;
  }
  const db = await getDb();
  await db.insert(versions).values({
    id: newId("v"), blueprintId: id, versionNo: next, status: "published", model: draft.model,
    changeSummary: summary || "Initial publication", publishedBy: u.name,
  });
  return NextResponse.json({ versionNo: next });
}
