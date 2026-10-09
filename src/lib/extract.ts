import { generateText, Output, NoObjectGeneratedError } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { z } from "zod";
import { ProcessSchema, StepSchema, LinkSchema, emptyModel, normalizeModel, type ProcessModel } from "./model";
import { getFile } from "./storage";
import { slicePdf } from "./parse";
import type { Chunk, DocSection } from "./schema";

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;
const MODEL = () => process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5-5";
export const chatModel = () => anthropic(MODEL());

// What the LLM returns per chunk. Ids are local to the chunk unless they reference an existing process.
const ChunkOutput = z.object({
  processes: z.array(ProcessSchema),
  steps: z.array(StepSchema),
  links: z.array(LinkSchema),
});
type ChunkOut = z.infer<typeof ChunkOutput>;

const SYSTEM = `You are a business process analyst converting a process blueprint document into a structured process model.

Rules:
- Build a hierarchy: L0 = value chain / end-to-end landscape (at most one in the whole model), L1 = process area, L2 = process, L3 = sub-process / activity group. Steps (tasks, decisions, events, subprocess calls) belong to a process via processId.
- Only extract what the document actually states. NEVER invent steps, roles, systems or rules. If something is unclear, extract it with a low confidence score.
- For each step capture: name (short verb phrase), description, roles with RACI letters (R responsible, A accountable, C consulted, I informed; use R when only an actor is stated), systems used, inputs, outputs, business rules, SLA, controls, pain points, and an automation tag (none, RPA, AI, Integration, Workflow) with a one-sentence rationale ONLY when the document supports it or it is an evident candidate (otherwise tag "none" and empty rationale).
- Links: sequence between consecutive steps, conditional for decision branches (put the branch condition in "condition"), handoff when responsibility moves to a different role/team, exception for error/exception paths. Link only steps by their ids.
- Use empty strings / empty arrays for unknown attributes. Do not use placeholders like "N/A".
- confidence is 0..1: 1 = stated explicitly and unambiguously, 0.5 = inferred, below 0.4 = guess.
- sourceRef: copy the section reference label or page (e.g. "p.14" or "§3 Invoice Handling") the element came from.
- Diagrams/swimlane images: read them carefully; lanes are roles; boxes are steps; arrows are links. Lower confidence when text is hard to read.
- Ids: use short unique ids local to this extraction (p1, p2, s1, s2, l1 ...). If an element belongs to a process that already exists in the "EXISTING PROCESSES" list, reuse that exact id for processId/parentId and do not re-create it. If the document continues a process from before, add steps to it.`;

function outline(m: ProcessModel) {
  if (!m.processes.length) return "(none yet)";
  return m.processes.map((p) => `${p.id} | ${p.level} | ${p.name}${p.parentId ? ` | parent ${p.parentId}` : ""}`).join("\n");
}

/** Merge one chunk's output into the running model, namespacing new ids so chunks never collide. */
export function mergeChunk(partial: ProcessModel, out: ChunkOut, idx: string | number): ProcessModel {
  const existing = new Set(partial.processes.map((p) => p.id));
  const ns = (id: string) => `c${idx}_${id}`;
  const procIds = new Set(out.processes.map((p) => p.id));
  const mapProc = (id: string | null) => (id == null ? null : existing.has(id) && !procIds.has(id) ? id : procIds.has(id) ? ns(id) : id);
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const byName = new Map(partial.processes.map((p) => [`${p.level}:${norm(p.name)}`, p.id]));

  const remap = new Map<string, string>();
  const newProcs = [];
  for (const p of out.processes) {
    const dupe = byName.get(`${p.level}:${norm(p.name)}`);
    if (dupe) { remap.set(p.id, dupe); continue; } // same process mentioned again
    remap.set(p.id, ns(p.id));
    newProcs.push(p);
  }
  const pid = (id: string | null) => (id == null ? null : remap.get(id) ?? (existing.has(id) ? id : mapProc(id)));
  const processes = newProcs.map((p) => ({ ...p, id: remap.get(p.id)!, parentId: pid(p.parentId) }));

  const stepIds = new Set(out.steps.map((s) => s.id));
  const steps = out.steps.map((s) => ({ ...s, id: ns(s.id), processId: pid(s.processId) ?? s.processId }));
  const sid = (id: string) => (stepIds.has(id) ? ns(id) : id);
  const links = out.links.map((l) => ({ ...l, id: ns(l.id), from: sid(l.from), to: sid(l.to) }));

  return {
    ...partial,
    processes: [...partial.processes, ...processes],
    steps: [...partial.steps, ...steps],
    links: [...partial.links, ...links],
  };
}

async function aiChunk(args: {
  partial: ProcessModel; chunk: Chunk; idx: string | number; pdf?: Buffer; images: { data: Buffer; mediaType: string }[];
}): Promise<ChunkOut> {
  const { partial, chunk, pdf, images } = args;
  const content: Array<
    | { type: "text"; text: string }
    | { type: "file"; data: Uint8Array; mediaType: string; filename?: string }
    | { type: "image"; image: Buffer; mediaType?: string }
  > = [];
  content.push({
    type: "text",
    text: `Document title: ${partial.title}\nThis chunk: ${chunk.label}\n\nEXISTING PROCESSES (reuse these ids when continuing them):\n${outline(partial)}\n\nExtract the process model elements from this part of the document.`,
  });
  if (chunk.kind === "pdf" && pdf && chunk.pages) {
    const part = await slicePdf(pdf, chunk.pages[0], chunk.pages[1]);
    content.push({ type: "file", data: part, mediaType: "application/pdf", filename: `${chunk.label}.pdf` });
    content.push({ type: "text", text: `Page numbers inside this excerpt start at 1, but the real page numbers are ${chunk.pages[0]}–${chunk.pages[1]}: use real numbers ("p.${chunk.pages[0]}"...) in sourceRef.` });
  } else {
    content.push({ type: "text", text: chunk.text ?? "" });
    for (const im of images) content.push({ type: "image", image: im.data, mediaType: im.mediaType });
    if (images.length) content.push({ type: "text", text: "The images above are diagrams embedded in this section (in document order). Interpret them as process flows." });
  }
  const { output } = await generateText({
    model: chatModel(),
    system: SYSTEM,
    messages: [{ role: "user", content }],
    output: Output.object({ schema: ChunkOutput }),
    maxOutputTokens: 32000,
  });
  return output as ChunkOut;
}

// ---------- Offline fallback (no API key): rough heading/list heuristic, low confidence ----------
function offlineChunk(chunk: Chunk, sections: DocSection[]): ChunkOut {
  const text = chunk.kind === "text" ? chunk.text ?? "" : sections.filter((s) => {
    const n = Number(s.ref.replace("p.", ""));
    return chunk.pages && n >= chunk.pages[0] && n <= chunk.pages[1];
  }).map((s) => `=== SECTION REF: ${s.ref} ===\n${s.text}`).join("\n");
  const out: ChunkOut = { processes: [], steps: [], links: [] };
  let ref = chunk.label;
  let curProc: string | null = null;
  let prev: string | null = null;
  let n = 0;
  const stack: { level: number; id: string }[] = [];
  const mk = (name: string, level: 1 | 2 | 3, parent: string | null) => {
    const id = `p${++n}`;
    out.processes.push({ id, name, level: (`L${level}`) as "L1", parentId: parent, owner: "", objective: "", scope: "", kpis: [] });
    return id;
  };
  curProc = mk(chunk.label.slice(0, 60), 1, null);
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const sec = line.match(/^=== SECTION REF: (.*) ===$/);
    if (sec) { ref = sec[1]; continue; }
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const depth = Math.min(3, h[1].length) as 1 | 2 | 3;
      while (stack.length && stack[stack.length - 1].level >= depth) stack.pop();
      const parent = stack.length ? stack[stack.length - 1].id : null;
      curProc = mk(h[2].slice(0, 80), depth, parent);
      stack.push({ level: depth, id: curProc });
      prev = null;
      continue;
    }
    const item = line.match(/^(?:\d+[.)]|[-•*])\s+(.{4,})$/);
    if (item && curProc) {
      const id = `s${++n}`;
      const label = item[1];
      const roleMatch = label.match(/\b(?:by|owner:|role:)\s+([A-Z][A-Za-z ]{2,30})/);
      out.steps.push({
        id, processId: curProc, name: label.slice(0, 70), type: /\?$|^if |decision/i.test(label) ? "decision" : "task",
        description: label, roles: roleMatch ? [{ role: roleMatch[1].trim(), raci: "R" }] : [], systems: [], inputs: [], outputs: [],
        rules: [], sla: "", controls: [], painPoints: [], automationTag: "none", automationRationale: "", confidence: 0.35, sourceRef: ref,
      });
      if (prev) out.links.push({ id: `l${++n}`, from: prev, to: id, type: "sequence", condition: "" });
      prev = id;
    }
  }
  // drop processes that ended up with no steps and no children (e.g. the chunk placeholder)
  let pruned = true;
  while (pruned) {
    pruned = false;
    out.processes = out.processes.filter((p) => {
      const used = out.steps.some((s) => s.processId === p.id) || out.processes.some((c) => c.parentId === p.id);
      if (!used) pruned = true;
      return used;
    });
  }
  return out;
}

export type StepResult = { model: ProcessModel; log: string };

/** Split a chunk in two so a failed (oversized) extraction can be retried in smaller pieces. */
function splitChunk(c: Chunk): [Chunk, Chunk] | null {
  if (c.kind === "pdf" && c.pages && c.pages[1] > c.pages[0]) {
    const mid = Math.floor((c.pages[0] + c.pages[1]) / 2);
    const mk = (a: number, b: number): Chunk => ({ kind: "pdf", pages: [a, b], label: a === b ? `p.${a}` : `p.${a}-${b}` });
    return [mk(c.pages[0], mid), mk(mid + 1, c.pages[1])];
  }
  if (c.kind === "text" && c.text && c.text.length > 3000) {
    const t = c.text;
    const around = t.indexOf("\n=== SECTION REF:", Math.floor(t.length / 2));
    const cut = around > 0 && around < t.length - 500 ? around : Math.floor(t.length / 2);
    const a = t.slice(0, cut), b = t.slice(cut);
    const keys = (x: string) => [...x.matchAll(/\[IMAGE:([^\]]+)\]/g)].map((m) => m[1]).slice(0, 4);
    return [
      { kind: "text", label: `${c.label} (1/2)`, text: a, imageKeys: keys(a) },
      { kind: "text", label: `${c.label} (2/2)`, text: b, imageKeys: keys(b) },
    ];
  }
  return null;
}

/** Run AI extraction for a chunk; if the model's output cannot be parsed (usually truncated), split and retry. */
async function runAi(partial: ProcessModel, chunk: Chunk, tag: string, storageKey: string, depth = 0): Promise<{ model: ProcessModel; out: ChunkOut }> {
  const images: { data: Buffer; mediaType: string }[] = [];
  for (const k of chunk.imageKeys ?? []) {
    try { images.push({ data: await getFile(k), mediaType: k.endsWith(".png") ? "image/png" : "image/jpeg" }); } catch { /* skip missing image */ }
  }
  const pdf = chunk.kind === "pdf" ? await getFile(storageKey) : undefined;
  try {
    const out = await aiChunk({ partial, chunk, idx: tag, pdf, images });
    return { model: mergeChunk(partial, out, tag), out };
  } catch (e) {
    const parts = NoObjectGeneratedError.isInstance(e) && depth < 3 ? splitChunk(chunk) : null;
    if (!parts) {
      if (NoObjectGeneratedError.isInstance(e)) {
        throw new Error(`The AI response for ${chunk.label} could not be parsed (finish reason: ${e.finishReason ?? "unknown"}). Try a smaller document section.`);
      }
      throw e;
    }
    const a = await runAi(partial, parts[0], `${tag}a`, storageKey, depth + 1);
    const b = await runAi(a.model, parts[1], `${tag}b`, storageKey, depth + 1);
    return {
      model: b.model,
      out: { processes: [...a.out.processes, ...b.out.processes], steps: [...a.out.steps, ...b.out.steps], links: [...a.out.links, ...b.out.links] },
    };
  }
}

export async function processChunk(opts: {
  mode: "ai" | "offline"; partial: ProcessModel; chunk: Chunk; idx: string | number; storageKey: string; sections: DocSection[];
}): Promise<StepResult> {
  const { mode, partial, chunk, idx, storageKey, sections } = opts;
  let model: ProcessModel;
  let out: ChunkOut;
  if (mode === "offline") {
    out = offlineChunk(chunk, sections);
    model = mergeChunk(partial, out, idx);
  } else {
    ({ model, out } = await runAi(partial, chunk, String(idx), storageKey));
  }
  return { model, log: `${chunk.label}: +${out.processes.length} processes, +${out.steps.length} steps, +${out.links.length} links` };
}

/** After the last chunk: normalise and stitch consecutive process roots together. */
export function finalizeModel(m: ProcessModel, title: string): ProcessModel {
  const model = { ...m, title: m.title || title };
  return normalizeModel(model);
}

export { emptyModel };
