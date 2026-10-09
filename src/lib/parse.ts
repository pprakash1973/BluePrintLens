import mammoth from "mammoth";
import { PDFDocument } from "pdf-lib";
import { putFile } from "./storage";
import type { Chunk, DocSection } from "./schema";

export type Parsed = { sections: DocSection[]; pageCount: number; chunks: Chunk[] };

const PDF_PAGES_PER_CHUNK = 8;
const TEXT_CHARS_PER_CHUNK = 9000;

const decode = (s: string) =>
  s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const strip = (s: string) => decode(s.replace(/<[^>]+>/g, "")).replace(/\s+/g, " ").trim();

/** Convert mammoth HTML into compact markdown-ish text, keeping headings, tables and image markers. */
function htmlToText(html: string): string {
  let h = html;
  h = h.replace(/<img[^>]*alt="IMG:([^"]+)"[^>]*>/g, "\n[IMAGE:$1]\n");
  h = h.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/g, (_, n, t) => `\n${"#".repeat(Number(n))} ${strip(t)}\n`);
  h = h.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/g, (_, row: string) => {
    const cells = [...row.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => strip(m[1]));
    return `\n| ${cells.join(" | ")} |`;
  });
  h = h.replace(/<li[^>]*>([\s\S]*?)<\/li>/g, (_, t) => `\n- ${strip(t)}`);
  h = h.replace(/<\/p>/g, "\n").replace(/<br\s*\/?>/g, "\n");
  h = h.replace(/<[^>]+>/g, "");
  return decode(h).replace(/\n{3,}/g, "\n\n").trim();
}

async function parseDocx(buf: Buffer, docId: string): Promise<Parsed> {
  let n = 0;
  const imageKeys: string[] = [];
  const result = await mammoth.convertToHtml(
    { buffer: buf },
    {
      convertImage: mammoth.images.imgElement(async (image) => {
        const ct = image.contentType;
        if (ct !== "image/png" && ct !== "image/jpeg") return { src: "", alt: "" };
        const data = await image.readAsBuffer();
        if (data.length < 4000) return { src: "", alt: "" }; // skip icons/bullets
        const key = await putFile(`img/${docId}/${++n}.${ct === "image/png" ? "png" : "jpg"}`, data, ct);
        imageKeys.push(key);
        return { src: "", alt: `IMG:${key}` };
      }),
    },
  );
  const text = htmlToText(result.value);

  // split into sections at headings
  const sections: DocSection[] = [];
  let cur: { title: string; lines: string[] } = { title: "Preamble", lines: [] };
  const flush = () => {
    const body = cur.lines.join("\n").trim();
    if (body) sections.push({ ref: `§${sections.length + 1} ${cur.title}`.slice(0, 80), title: cur.title, text: body });
  };
  for (const line of text.split("\n")) {
    const m = line.match(/^#{1,6}\s+(.*)$/);
    if (m) { flush(); cur = { title: m[1], lines: [line] }; } else cur.lines.push(line);
  }
  flush();

  // group sections into chunks
  const chunks: Chunk[] = [];
  let buf2 = "";
  let first = "";
  let last = "";
  const emit = () => {
    if (!buf2.trim()) return;
    const keys = [...buf2.matchAll(/\[IMAGE:([^\]]+)\]/g)].map((m) => m[1]).slice(0, 4);
    chunks.push({ kind: "text", label: first === last ? first : `${first} … ${last}`, text: buf2, imageKeys: keys });
    buf2 = "";
  };
  for (const s of sections) {
    const piece = `\n\n=== SECTION REF: ${s.ref} ===\n${s.text}`;
    if (buf2.length + piece.length > TEXT_CHARS_PER_CHUNK && buf2) emit();
    if (!buf2) first = s.ref;
    buf2 += piece;
    last = s.ref;
    // a single huge section: hard split
    while (buf2.length > TEXT_CHARS_PER_CHUNK * 1.5) {
      chunks.push({ kind: "text", label: `${last} (part)`, text: buf2.slice(0, TEXT_CHARS_PER_CHUNK), imageKeys: [] });
      buf2 = buf2.slice(TEXT_CHARS_PER_CHUNK);
    }
  }
  emit();
  return { sections, pageCount: Math.max(1, Math.ceil(text.length / 3000)), chunks };
}

async function parsePdf(buf: Buffer): Promise<Parsed> {
  const pdf = await PDFDocument.load(buf, { ignoreEncryption: true });
  const pageCount = pdf.getPageCount();
  const { extractText, getDocumentProxy } = await import("unpdf");
  const proxy = await getDocumentProxy(new Uint8Array(buf));
  const { text } = await extractText(proxy, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  const sections: DocSection[] = pages.map((t, i) => ({ ref: `p.${i + 1}`, title: `Page ${i + 1}`, text: t.trim() }));
  const chunks: Chunk[] = [];
  for (let s = 1; s <= pageCount; s += PDF_PAGES_PER_CHUNK) {
    const e = Math.min(pageCount, s + PDF_PAGES_PER_CHUNK - 1);
    chunks.push({ kind: "pdf", label: s === e ? `p.${s}` : `p.${s}-${e}`, pages: [s, e] });
  }
  return { sections, pageCount, chunks };
}

export async function parseDocument(buf: Buffer, filename: string, docId: string): Promise<Parsed> {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".docx")) return parseDocx(buf, docId);
  if (lower.endsWith(".pdf")) return parsePdf(buf);
  throw new Error("Unsupported file type. Upload a .docx or .pdf file (VSDX arrives in V2).");
}

/** Extract a page range of a PDF as a standalone PDF buffer. */
export async function slicePdf(buf: Buffer, from: number, to: number): Promise<Uint8Array> {
  const src = await PDFDocument.load(buf, { ignoreEncryption: true });
  const out = await PDFDocument.create();
  const idx = Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  const pages = await out.copyPages(src, idx);
  pages.forEach((p) => out.addPage(p));
  return out.save();
}
