"use client";
import { useEffect, useRef, useState } from "react";
import { Sparkles, Crown, UserCog, Server, Cog, X } from "lucide-react";
import { api } from "@/lib/client";
import type { ProcessModel, Step } from "@/lib/model";
import type { StepBadge } from "@/components/FlowCanvas";

export type Persona = "exec" | "owner" | "it" | "automation";
export const PERSONAS: { id: Persona; label: string; blurb: string; icon: typeof Crown }[] = [
  { id: "exec", label: "Executive / sponsor", blurb: "One-screen overview and where the risks are", icon: Crown },
  { id: "owner", label: "Process owner / SME", blurb: "Only the steps my team owns, ready to review", icon: UserCog },
  { id: "it", label: "IT / architect", blurb: "Systems, data in/out and integrations", icon: Server },
  { id: "automation", label: "Automation lead", blurb: "Automation candidates and pain points", icon: Cog },
];

export function PersonaModal({ roles, onPick, onClose }: { roles: string[]; onPick: (p: Persona, role?: string) => void; onClose: () => void }) {
  const [role, setRole] = useState("");
  const [picked, setPicked] = useState<Persona | null>(null);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="persona-title">
      <div className="card w-full max-w-lg p-5">
        <div className="mb-1 flex items-start justify-between">
          <h2 id="persona-title" className="text-lg font-semibold">Welcome — who are you?</h2>
          <button className="btn !p-1.5" onClick={onClose} aria-label="Skip"><X size={14} /></button>
        </div>
        <p className="mb-4 text-sm text-muted">We&apos;ll start you in the view that suits you. You can switch any time.</p>
        <div className="grid gap-2 sm:grid-cols-2">
          {PERSONAS.map((p) => (
            <button key={p.id} onClick={() => (p.id === "owner" ? setPicked("owner") : onPick(p.id))}
              className={`card flex gap-3 p-3 text-left hover:border-brand ${picked === p.id ? "!border-brand" : ""}`}>
              <p.icon size={20} className="mt-0.5 shrink-0 text-brand" aria-hidden />
              <span><b className="block text-sm">{p.label}</b><span className="text-xs text-muted">{p.blurb}</span></span>
            </button>
          ))}
        </div>
        {picked === "owner" && (
          <div className="mt-4 flex items-end gap-2">
            <div className="flex-1">
              <label className="label" htmlFor="myrole">Which role are you?</label>
              <select id="myrole" className="input" value={role} onChange={(e) => setRole(e.target.value)}>
                <option value="">Select your role…</option>{roles.map((r) => <option key={r}>{r}</option>)}
              </select>
            </div>
            <button className="btn btn-primary" disabled={!role} onClick={() => onPick("owner", role)}>Show my steps</button>
          </div>
        )}
      </div>
    </div>
  );
}

const TOUR = [
  { title: "Overview", text: "Start here: the value chain, key numbers and an AI summary. Click any process area to drill into its flow." },
  { title: "Process flow", text: "Swimlanes show who does what. Click a step to see its details and highlight everything before and after it." },
  { title: "Filters & overlays", text: "Filter by role or system, search, and switch on overlays for pain points, controls, automation and handoffs." },
  { title: "Trace & walk through", text: "Use ‘Trace path’ to see the route between two steps, or press Walkthrough for a guided, narrated tour." },
  { title: "Review & ask", text: "Reviewers can comment and approve steps. The Ask tab answers questions with citations to the blueprint." },
];

export function TourCard({ onDone, onStep }: { onDone: () => void; onStep: (i: number) => void }) {
  const [i, setI] = useState(0);
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } onStep(i); }, [i]); // eslint-disable-line react-hooks/exhaustive-deps
  const t = TOUR[i];
  return (
    <div className="no-print fixed bottom-4 right-4 z-40 w-80 rounded-xl border border-brand bg-white p-4 shadow-xl" role="dialog" aria-label="Product tour">
      <p className="text-xs text-muted">Tour {i + 1} of {TOUR.length}</p>
      <h3 className="font-semibold">{t.title}</h3>
      <p className="mb-3 text-sm">{t.text}</p>
      <div className="flex justify-between">
        <button className="btn" onClick={onDone}>Skip</button>
        <div className="flex gap-2">
          {i > 0 && <button className="btn" onClick={() => setI(i - 1)}>Back</button>}
          <button className="btn btn-primary" onClick={() => (i + 1 >= TOUR.length ? onDone() : setI(i + 1))}>{i + 1 >= TOUR.length ? "Done" : "Next"}</button>
        </div>
      </div>
    </div>
  );
}

type Insights = { summary: string; risks: string[]; handoffs: string[]; questions: string[]; source: "ai" | "auto" };

export function SummaryPanel({ id, version }: { id: string; version: number | "draft" }) {
  const [d, setD] = useState<Insights | null>(null);
  useEffect(() => { api<Insights>(`/api/blueprints/${id}/insights?v=${version || "latest"}`).then(setD).catch(() => setD(null)); }, [id, version]);
  if (!d) return <div className="card mb-5 p-4 text-sm text-muted">Preparing summary…</div>;
  return (
    <section className="card mb-5 p-4" aria-label="Process summary">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-semibold"><Sparkles size={14} className="text-auto" aria-hidden /> What is this process?
        <span className="chip">{d.source === "ai" ? "AI-written" : "auto summary"}</span></h3>
      <p className="mb-3 text-sm leading-relaxed">{d.summary}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        {d.risks.length > 0 && <div><h4 className="label text-pain">Top risks</h4><ul className="list-disc pl-5 text-sm">{d.risks.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
        {d.handoffs.length > 0 && <div><h4 className="label">Key handoffs</h4><ul className="list-disc pl-5 text-sm">{d.handoffs.map((r, i) => <li key={i}>{r}</li>)}</ul></div>}
      </div>
    </section>
  );
}

export function SignoffPanel({ model, badges, mine, canCollab, myRole, onOpen }: {
  model: ProcessModel; badges: Record<string, StepBadge>; mine: Record<string, string>; canCollab: boolean; myRole: string; onOpen: (s: Step) => void;
}) {
  const total = model.steps.length;
  const approved = model.steps.filter((s) => (badges[s.id]?.approved ?? 0) > 0 && (badges[s.id]?.changes ?? 0) === 0).length;
  const changes = model.steps.filter((s) => (badges[s.id]?.changes ?? 0) > 0).length;
  const pct = total ? Math.round((approved / total) * 100) : 0;
  const waiting = canCollab ? model.steps.filter((s) => mine[s.id] !== "approved" && (!myRole || s.roles.some((r) => r.role === myRole))) : [];
  return (
    <section className="card mb-5 p-4" aria-label="Sign-off progress">
      <h3 className="mb-2 text-sm font-semibold">Sign-off progress</h3>
      <div className="h-2.5 overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
        <div className="h-full bg-control" style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 text-xs text-muted">{approved} of {total} steps approved{changes > 0 ? ` · ${changes} with changes requested` : ""}</p>
      {canCollab && (
        <div className="mt-3">
          <h4 className="label">{myRole ? `Awaiting your review (${myRole})` : "Awaiting your review"} — {waiting.length}</h4>
          <ul className="flex flex-wrap gap-1">
            {waiting.slice(0, 10).map((s) => <li key={s.id}><button className="chip hover:border-brand" onClick={() => onOpen(s)}>{s.name}</button></li>)}
            {waiting.length > 10 && <li className="text-xs text-muted">+{waiting.length - 10} more</li>}
            {waiting.length === 0 && <li className="text-sm text-control">You&apos;re all caught up.</li>}
          </ul>
        </div>
      )}
    </section>
  );
}
