import { and, desc, eq } from "drizzle-orm";
import { getDb } from "./db";
import { blueprints, versions } from "./schema";
import type { ProcessModel } from "./model";

export const newId = (p: string) => `${p}_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

export async function getBlueprint(id: string) {
  const db = await getDb();
  const [bp] = await db.select().from(blueprints).where(eq(blueprints.id, id));
  return bp ?? null;
}

export async function getDraft(bpId: string) {
  const db = await getDb();
  const [v] = await db.select().from(versions).where(and(eq(versions.blueprintId, bpId), eq(versions.status, "draft")));
  return v ?? null;
}

export async function listPublished(bpId: string) {
  const db = await getDb();
  return db.select().from(versions).where(and(eq(versions.blueprintId, bpId), eq(versions.status, "published"))).orderBy(desc(versions.versionNo));
}

export async function getVersionModel(bpId: string, which: string | null): Promise<{ model: ProcessModel; versionNo: number; status: string } | null> {
  if (which === "draft") {
    const d = await getDraft(bpId);
    return d ? { model: d.model, versionNo: 0, status: "draft" } : null;
  }
  const pubs = await listPublished(bpId);
  if (which && which !== "latest") {
    const v = pubs.find((x) => x.versionNo === Number(which));
    return v ? { model: v.model, versionNo: v.versionNo, status: "published" } : null;
  }
  const v = pubs[0];
  return v ? { model: v.model, versionNo: v.versionNo, status: "published" } : null;
}

export async function saveDraft(bpId: string, model: ProcessModel) {
  const db = await getDb();
  const d = await getDraft(bpId);
  if (d) await db.update(versions).set({ model }).where(eq(versions.id, d.id));
  else await db.insert(versions).values({ id: newId("v"), blueprintId: bpId, versionNo: 0, status: "draft", model });
}
