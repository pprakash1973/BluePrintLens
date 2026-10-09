import { NextRequest, NextResponse } from "next/server";
import { generateText, Output } from "ai";
import { z } from "zod";
import { getVersionModel } from "@/lib/bp";
import { aiConfigured, chatModel } from "@/lib/extract";
import { childrenOf, descendantIds, type ProcessModel } from "@/lib/model";

export const maxDuration = 120;
type Ctx = { params: Promise<{ id: string }> };

const Insights = z.object({
  summary: z.string(),
  risks: z.array(z.string()),
  handoffs: z.array(z.string()),
  questions: z.array(z.string()),
});
const Narration = z.object({ items: z.array(z.object({ id: z.string(), text: z.string() })) });

const cache = new Map<string, unknown>();

function compact(m: ProcessModel, ids?: Set<string>) {
  const proc = new Map(m.processes.map((p) => [p.id, p.name]));
  const steps = m.steps.filter((s) => !ids || ids.has(s.processId));
  return [
    `PROCESS: ${m.title}`,
    ...m.processes.filter((p) => !ids || ids.has(p.id)).map((p) => `${p.level} ${p.name}${p.owner ? ` (owner ${p.owner})` : ""}`),
    ...steps.map((s) => `STEP ${s.id} | ${proc.get(s.processId)} | ${s.name} | ${s.type} | ${s.description} | roles ${s.roles.map((r) => `${r.role}:${r.raci}`).join(",")} | systems ${s.systems.join(",")} | pain ${s.painPoints.join("; ")} | auto ${s.automationTag}`),
    ...m.links.filter((l) => !ids || (steps.some((s) => s.id === l.from) && steps.some((s) => s.id === l.to))).map((l) => `LINK ${l.from} -> ${l.to} ${l.type} ${l.condition}`),
  ].join("\n").slice(0, 60000);
}

/** Heuristic fallback when no AI key is set. */
function auto(m: ProcessModel) {
  const root = m.processes.find((p) => p.level === "L0");
  const areas = root ? childrenOf(m, root.id) : [];
  const pain = m.steps.filter((s) => s.painPoints.length);
  return {
    summary: `${m.title} spans ${areas.length || m.processes.length} process areas${areas.length ? ` (${areas.map((a) => a.name).join(", ")})` : ""}, with ${m.steps.length} steps performed by ${m.roles.length} roles across ${m.systems.length} systems.`,
    risks: pain.slice(0, 3).map((s) => `${s.name}: ${s.painPoints[0]}`),
    handoffs: [],
    questions: ["Who is responsible for each step in this process?", "Which steps use the most systems?", "Where are the biggest pain points?"],
    source: "auto" as const,
  };
}

export async function GET(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const sp = req.nextUrl.searchParams;
  const v = sp.get("v") ?? "latest";
  const r = await getVersionModel(id, v);
  if (!r) return NextResponse.json({ error: "No such version" }, { status: 404 });
  const kind = sp.get("kind") ?? "summary";

  if (kind === "narration") {
    const scope = sp.get("p");
    if (!aiConfigured()) return NextResponse.json({ items: [], source: "auto" });
    const key = `n:${id}:${r.versionNo}:${scope}`;
    if (cache.has(key)) return NextResponse.json(cache.get(key));
    const ids = scope ? descendantIds(r.model, scope) : undefined;
    try {
      const { output } = await generateText({
        model: chatModel(),
        system: "You narrate a business process walkthrough for non-experts. For each step id given, write ONE plain-language sentence (max 30 words) saying who does what, with which system, and why it matters or what happens next. Use only facts from the data. Return every step id exactly once.",
        prompt: compact(r.model, ids),
        output: Output.object({ schema: Narration }),
        maxOutputTokens: 8000,
      });
      const out = { items: output.items, source: "ai" };
      cache.set(key, out);
      return NextResponse.json(out);
    } catch {
      return NextResponse.json({ items: [], source: "auto" });
    }
  }

  const key = `s:${id}:${r.versionNo}`;
  if (cache.has(key)) return NextResponse.json(cache.get(key));
  if (!aiConfigured()) return NextResponse.json(auto(r.model));
  try {
    const { output } = await generateText({
      model: chatModel(),
      system: "You explain a business process to someone seeing it for the first time. Using ONLY the data given: summary = 4-6 plain-language sentences describing the end-to-end story; risks = top 3 risks/pain points as short sentences naming the step; handoffs = up to 3 key handoffs between teams/systems; questions = 5 useful questions a stakeholder might ask about this process. Never invent facts.",
      prompt: compact(r.model),
      output: Output.object({ schema: Insights }),
      maxOutputTokens: 2000,
    });
    const out = { ...output, source: "ai" };
    cache.set(key, out);
    return NextResponse.json(out);
  } catch {
    return NextResponse.json(auto(r.model));
  }
}
