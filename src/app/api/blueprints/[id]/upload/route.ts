import { NextRequest, NextResponse } from "next/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireRole, isResponse } from "@/lib/auth";
import { putFile, blobEnabled, getFile } from "@/lib/storage";
import { ingest, MAX_BYTES } from "@/lib/ingest";
import { newId } from "@/lib/bp";

export const maxDuration = 300;
type Ctx = { params: Promise<{ id: string }> };

/**
 * Local dev: multipart form upload (field "file", optional "append").
 * Vercel: JSON. Either a Blob client-upload token handshake, or { pathname, filename, append } after the browser upload.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const ct = req.headers.get("content-type") ?? "";

  try {
    if (ct.includes("multipart/form-data")) {
      const u = await requireRole("author");
      if (isResponse(u)) return u;
      const form = await req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
      const data = Buffer.from(await file.arrayBuffer());
      const key = await putFile(`docs/${id}/${newId("f")}-${file.name}`, data, file.type || "application/octet-stream");
      const r = await ingest({ blueprintId: id, filename: file.name, storageKey: key, data, append: form.get("append") === "true" });
      return NextResponse.json(r);
    }

    const body = await req.json();
    if (body.type === "blob.generate-client-token" || body.type === "blob.upload-completed") {
      if (!blobEnabled()) return NextResponse.json({ error: "Blob storage not configured" }, { status: 400 });
      const res = await handleUpload({
        body: body as HandleUploadBody, request: req,
        onBeforeGenerateToken: async () => {
          const u = await requireRole("author");
          if (isResponse(u)) throw new Error("Not allowed");
          return {
            allowedContentTypes: ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
            maximumSizeInBytes: MAX_BYTES, addRandomSuffix: true,
          };
        },
        onUploadCompleted: async () => {},
      });
      return NextResponse.json(res);
    }

    // browser finished a direct Blob upload; register + parse
    const u = await requireRole("author");
    if (isResponse(u)) return u;
    const { pathname, filename, append } = body as { pathname: string; filename: string; append?: boolean };
    if (!pathname || !pathname.startsWith(`docs/${id}/`)) return NextResponse.json({ error: "Invalid upload" }, { status: 400 });
    const data = await getFile(pathname);
    const r = await ingest({ blueprintId: id, filename, storageKey: pathname, data, append: !!append });
    return NextResponse.json(r);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Upload failed" }, { status: 400 });
  }
}
