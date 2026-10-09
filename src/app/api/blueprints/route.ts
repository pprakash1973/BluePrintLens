import { NextRequest, NextResponse } from "next/server";
import { desc } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { blueprints, versions } from "@/lib/schema";
import { requireRole, isResponse } from "@/lib/auth";
import { newId } from "@/lib/bp";
import { sampleModel } from "@/lib/sample";

export async function GET() {
  const db = await getDb();
  const bps = await db.select().from(blueprints).orderBy(desc(blueprints.createdAt));
  const vs = await db.select({ b: versions.blueprintId, n: versions.versionNo, s: versions.status, at: versions.createdAt }).from(versions);
  return NextResponse.json({
    blueprints: bps.map((b) => {
      const mine = vs.filter((v) => v.b === b.id);
      const pub = mine.filter((v) => v.s === "published").map((v) => v.n);
      return { ...b, latestVersion: pub.length ? Math.max(...pub) : null, hasDraft: mine.some((v) => v.s === "draft") };
    }),
  });
}

export async function POST(req: NextRequest) {
  const u = await requireRole("author");
  if (isResponse(u)) return u;
  const { name, description, sample } = await req.json();
  const n = String(name ?? "").trim();
  if (!n) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const db = await getDb();
  const id = newId("bp");
  await db.insert(blueprints).values({ id, name: n, description: String(description ?? ""), createdBy: u.id });
  if (sample) {
    await db.insert(versions).values({ id: newId("v"), blueprintId: id, versionNo: 0, status: "draft", model: { ...sampleModel(), title: n } });
  }
  return NextResponse.json({ id });
}
