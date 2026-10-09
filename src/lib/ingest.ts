import { getDb } from "./db";
import { documents, jobs } from "./schema";
import { parseDocument } from "./parse";
import { aiConfigured } from "./extract";
import { emptyModel } from "./model";
import { getBlueprint, getDraft, newId } from "./bp";

export const MAX_BYTES = 50 * 1024 * 1024;

/** Parse an uploaded document and create an extraction job. `append` adds to the existing draft (multi-document landscape, FR-04). */
export async function ingest(opts: { blueprintId: string; filename: string; storageKey: string; data: Buffer; append: boolean }) {
  const { blueprintId, filename, storageKey, data, append } = opts;
  if (data.length > MAX_BYTES) throw new Error("File exceeds the 50 MB limit");
  const bp = await getBlueprint(blueprintId);
  if (!bp) throw new Error("Blueprint not found");
  const docId = newId("doc");
  const parsed = await parseDocument(data, filename, docId);
  if (!parsed.chunks.length) throw new Error("No readable content found in the document");
  const db = await getDb();
  await db.insert(documents).values({
    id: docId, blueprintId, filename, mime: filename.toLowerCase().endsWith(".pdf") ? "application/pdf" : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    storageKey, sizeBytes: data.length, pageCount: parsed.pageCount, content: parsed.sections,
  });
  const draft = append ? await getDraft(blueprintId) : null;
  const jobId = newId("job");
  await db.insert(jobs).values({
    id: jobId, blueprintId, documentId: docId, status: "pending", chunks: parsed.chunks, nextChunk: 0,
    partial: draft ? draft.model : emptyModel(bp.name), log: [`Parsed ${filename}: ${parsed.sections.length} sections, ${parsed.chunks.length} chunks`],
    mode: aiConfigured() ? "ai" : "offline",
  });
  return { jobId, docId, chunks: parsed.chunks.length, mode: aiConfigured() ? "ai" : "offline" };
}
