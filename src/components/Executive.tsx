"use client";
import { useMemo } from "react";
import { ArrowRight, Printer, Flame, ShieldCheck, Cog, Gauge, Server, UserRound, Hand, Clock } from "lucide-react";
import { childrenOf, descendantIds, type Process, type ProcessModel, type Step } from "@/lib/model";
import { layoutSteps } from "@/lib/layout";
import { isManual } from "@/lib/flowtools";
import { fmtHrs, type EvidenceStats } from "@/lib/evidence";

const top = <T,>(xs: T[], n: number) => {
  const m = new Map<T, number>();
  xs.forEach((x) => m.set(x, (m.get(x) ?? 0) + 1));
  return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
};

type Stage = {
  p: Process; steps: Step[]; owner: string; roles: string[]; systems: string[]; risks: string[]; riskCount: number;
  controls: string[]; kpis: string[]; automation: number; manual: number;
  ev?: { cases: number; timeHrs: number; bottleneck?: string };
};

/** One-page executive blueprint: major stages left-to-right with owners, systems, risks and KPIs (progressive: click a stage for its flow). */
export function Executive({ model, root, evidence, onOpenStage, children }: {
  model: ProcessModel; root: Process; evidence: EvidenceStats | null; onOpenStage: (id: string) => void; children?: React.ReactNode;
}) {
  const stages: Stage[] = useMemo(() => {
    const order = layoutSteps(model.steps, model.links, "role").order;
    const pos = new Map(order.map((s, i) => [s.id, i]));
    let kids = childrenOf(model, root.id);
    if (kids.length === 0) kids = [root];
    const built = kids.map((p) => {
      const ids = descendantIds(model, p.id);
      const steps = model.steps.filter((s) => ids.has(s.processId));
      const accountable = steps.flatMap((s) => s.roles.filter((r) => r.raci === "A").map((r) => r.role));
      const responsible = steps.flatMap((s) => s.roles.filter((r) => r.raci === "R").map((r) => r.role));
      const pains = steps.flatMap((s) => s.painPoints);
      const slas = steps.map((s) => s.sla).filter(Boolean);
      let ev: Stage["ev"];
      if (evidence) {
        const st = steps.map((s) => ({ s, e: evidence.steps[s.id] })).filter((x) => x.e);
        if (st.length) {
          const b = [...st].sort((a, c) => c.e!.medianWaitHrs - a.e!.medianWaitHrs)[0];
          ev = { cases: Math.max(...st.map((x) => x.e!.cases)), timeHrs: st.reduce((a, x) => a + x.e!.medianWaitHrs, 0), bottleneck: b.e!.medianWaitHrs > 0 ? b.s.name : undefined };
        }
      }
      return {
        p, steps,
        owner: p.owner || top(accountable, 1)[0] || top(responsible, 1)[0] || "—",
        roles: top(responsible, 3),
        systems: top(steps.flatMap((s) => s.systems), 4),
        risks: pains.slice(0, 2), riskCount: pains.length,
        controls: steps.flatMap((s) => s.controls),
        kpis: [...p.kpis, ...slas].slice(0, 3),
        automation: steps.filter((s) => s.automationTag !== "none").length,
        manual: steps.filter(isManual).length,
        ev,
        first: Math.min(...steps.map((s) => pos.get(s.id) ?? 1e9)),
      };
    });
    return built.sort((a, b) => a.first - b.first);
  }, [model, root, evidence]);

  const maxTime = Math.max(1, ...stages.map((s) => s.ev?.timeHrs ?? 0));
  const Row = ({ icon: Icon, label, render }: { icon: typeof Flame; label: string; render: (s: Stage) => React.ReactNode }) => (
    <tr className="border-t border-line align-top">
      <th scope="row" className="sticky left-0 z-[1] w-36 bg-[#f4f6fa] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide text-muted">
        <span className="flex items-center gap-1.5"><Icon size={13} aria-hidden />{label}</span>
      </th>
      {stages.map((s) => <td key={s.p.id} className="min-w-44 px-3 py-2 text-[12.5px] leading-snug">{render(s)}</td>)}
    </tr>
  );

  return (
    <div className="p-5">
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-xl font-semibold">{root.name} — executive blueprint</h2>
        <button className="btn no-print !py-1" onClick={() => window.print()}><Printer size={14} /> Print one-pager</button>
      </div>
      <p className="mb-4 flex flex-wrap items-center gap-1.5 text-sm text-ink" aria-label="Main path">
        <b className="mr-1">Main path:</b>
        {stages.map((s, i) => (
          <span key={s.p.id} className="flex items-center gap-1.5">
            {i > 0 && <ArrowRight size={14} className="text-muted" aria-hidden />}
            <button className="rounded-full bg-blue-50 px-2.5 py-0.5 font-medium text-brand hover:bg-blue-100" onClick={() => onOpenStage(s.p.id)}>{s.p.name}</button>
          </span>
        ))}
      </p>

      <div className="card overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 z-[1] w-36 bg-white" />
              {stages.map((s, i) => (
                <th key={s.p.id} className="p-1 align-bottom">
                  <button onClick={() => onOpenStage(s.p.id)} title="Open the operational flow for this stage"
                    className="w-full bg-brand px-4 py-3 text-left text-white hover:brightness-110"
                    style={{ clipPath: i === stages.length - 1 ? "polygon(0 0,100% 0,100% 100%,0 100%,8% 50%)" : i === 0 ? "polygon(0 0,92% 0,100% 50%,92% 100%,0 100%)" : "polygon(0 0,92% 0,100% 50%,92% 100%,0 100%,8% 50%)" }}>
                    <div className="text-[13px] font-semibold leading-tight">{s.p.name}</div>
                    <div className="text-[11px] opacity-90">{s.steps.length} steps</div>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Row icon={UserRound} label="Owner" render={(s) => <><b>{s.owner}</b>{s.roles.length > 0 && <div className="text-muted">{s.roles.join(", ")}</div>}</>} />
            <Row icon={Server} label="Systems" render={(s) => s.systems.length ? <div className="flex flex-wrap gap-1">{s.systems.map((x) => <span key={x} className="chip">{x}</span>)}</div> : <span className="text-muted">—</span>} />
            <Row icon={Flame} label="Key risks" render={(s) => s.riskCount ? <ul className="space-y-0.5 text-pain">{s.risks.map((r, i) => <li key={i}>• {r}</li>)}{s.riskCount > 2 && <li className="text-muted">+{s.riskCount - 2} more</li>}</ul> : <span className="text-muted">None recorded</span>} />
            <Row icon={ShieldCheck} label="Controls" render={(s) => s.controls.length ? <span className="text-control">{s.controls.length} · {s.controls[0]}</span> : <span className="text-muted">None recorded</span>} />
            <Row icon={Gauge} label="KPIs / SLAs" render={(s) => s.kpis.length ? <ul className="space-y-0.5">{s.kpis.map((k, i) => <li key={i}>{k}</li>)}</ul> : <span className="text-muted">—</span>} />
            <Row icon={Cog} label="Improvement" render={(s) => (
              <span className="flex flex-wrap gap-1">
                {s.automation > 0 && <span className="chip text-auto"><Cog size={11} />{s.automation} automation</span>}
                {s.manual > 0 && <span className="chip text-[#b45309]"><Hand size={11} />{s.manual} manual</span>}
                {!s.automation && !s.manual && <span className="text-muted">—</span>}
              </span>
            )} />
            {evidence && (
              <Row icon={Clock} label="Evidence" render={(s) => s.ev ? (
                <div>
                  <div className="mb-1 h-1.5 overflow-hidden rounded bg-slate-200"><div className="h-full bg-pain" style={{ width: `${(s.ev.timeHrs / maxTime) * 100}%` }} /></div>
                  <div><b>{fmtHrs(s.ev.timeHrs)}</b> median wait · {s.ev.cases.toLocaleString()} cases</div>
                  {s.ev.bottleneck && <div className="text-muted">Bottleneck: {s.ev.bottleneck}</div>}
                </div>
              ) : <span className="text-muted">No events</span>} />
            )}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">Click a stage to open its operational flow. Owners default to the accountable role when not stated in the document.</p>
      {children && <div className="mt-5">{children}</div>}
    </div>
  );
}
