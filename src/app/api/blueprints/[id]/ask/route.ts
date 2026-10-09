import { NextRequest, NextResponse } from "next/server";
import { generateText } from "ai";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { documents } from "@/lib/schema";
import { getVersionModel } from "@/lib/bp";
import { aiConfigured, chatModel } from "@/lib/extract";
import { type ProcessModel } from "@/lib/model";

export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

/** Compact text form of the model for grounding. */
function modelContext(m: ProcessModel): string {
  const proc = new Map(m.processes.map((p) => [p.id, p]));
  const lines: string[] = [`PROCESS MODEL: ${m.title}`];
  for (const p of m.processes) lines.push(`PROCESS ${p.id} [${p.level}] ${p.name}${p.parentId ? ` (in ${proc.get(p.parentId)?.name})` : ""} owner=${p.owner} kpis=${p.kpis.join("; ")}`);
  for (const s of m.steps) {
    lines.push(
      `STEP ${s.id} "${s.name}" in ${proc.get(s.processId)?.name} type=${s.type} src=${s.sourceRef} | ${s.description} | roles=${s.roles.map((r) => `${r.role}:${r.raci}`).join(",")} | systems=${s.systems.join(",")} | in=${s.inputs.join(",")} | out=${s.outputs.join(",")} | rules=${s.rules.join("; ")} | sla=${s.sla} | controls=${s.controls.join("; ")} | pain=${s.painPoints.join("; ")} | automation=${s.automationTag} ${s.automationRationale}`,
    );
  }
  for (const l of m.links) lines.push(`LINK ${l.from} -> ${l.to} ${l.type}${l.condition ? ` [${l.condition}]` : ""}`);
  return lines.join("\n");
}

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const { question, version } = await req.json();
  const q = String(question ?? "").trim();
  if (!q) return NextResponse.json({ error: "Ask a question" }, { status: 400 });
  if (!aiConfigured()) return NextResponse.json({ error: "Q&A needs an ANTHROPIC_API_KEY to be configured." }, { status: 503 });
  const r = await getVersionModel(id, version ?? "latest");
  if (!r) return NextResponse.json({ error: "No published version" }, { status: 404 });

  const db = await getDb();
  const docs = await db.select().from(documents).where(eq(documents.blueprintId, id));
  // include source text, bounded, so answers can cite the document as well as the model
  let src = docs.flatMap((d) => d.content.map((s) => `[${s.ref}] ${s.text}`)).join("\n").slice(0, 120_000);
  if (!src) src = "(source text not available)";

  const { text } = await generateText({
    model: chatModel(),
    system: `You answer questions about a business process, using ONLY the process model and source excerpts provided. If the answer is not there, say you cannot find it. Be concise. Cite evidence inline as [step name — source ref] using the step's src value, or [source ref] for document text. Never invent steps, roles or systems.`,
    prompt: `${modelContext(r.model)}\n\nSOURCE DOCUMENT TEXT:\n${src}\n\nQUESTION: ${q}`,
    maxOutputTokens: 1500,
  });
  // surface which steps were mentioned so the UI can link to them
  const mentioned = r.model.steps.filter((s) => text.includes(s.name)).slice(0, 8).map((s) => ({ id: s.id, name: s.name }));
  return NextResponse.json({ answer: text, steps: mentioned });
}
