"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { Play, Pause, SkipBack, SkipForward, Search, Download, Flame, ShieldCheck, Cog, AlertTriangle, Pencil } from "lucide-react";
import Link from "next/link";
import { api, useMe, roleRank } from "@/lib/client";
import { Header } from "@/components/Header";
import { FlowCanvas, type Overlays, type StepBadge } from "@/components/FlowCanvas";
import { StepDetail } from "@/components/StepDetail";
import { childrenOf, descendantIds, LOW_CONFIDENCE, processPath, type Process, type ProcessModel, type Step } from "@/lib/model";
import { layoutSteps, laneOf, type LaneBy } from "@/lib/layout";

type Tab = "overview" | "flow" | "raci" | "systems" | "heatmap" | "ask" | "changes";
type VersionMeta = { id: string; versionNo: number; status: string; changeSummary: string; publishedBy: string | null; createdAt: string };
type Bundle = { blueprint: { id: string; name: string }; versions: VersionMeta[] };
type DiffRes = { added: { id: string; name: string }[]; removed: { id: string; name: string }[]; changed: { id: string; name: string; fields: string[] }[] };

const TABS: [Tab, string][] = [
  ["overview", "Overview"], ["flow", "Process flow"], ["raci", "RACI"], ["systems", "Systems"], ["heatmap", "Heatmap"], ["ask", "Ask"], ["changes", "Changes"],
];

function stats(m: ProcessModel, ids: Set<string>) {
  const steps = m.steps.filter((s) => ids.has(s.processId));
  return {
    steps: steps.length,
    pain: steps.reduce((a, s) => a + s.painPoints.length, 0),
    auto: steps.filter((s) => s.automationTag !== "none").length,
    controls: steps.reduce((a, s) => a + s.controls.length, 0),
    low: steps.filter((s) => s.confidence < LOW_CONFIDENCE).length,
  };
}

export function Viewer({ id }: { id: string }) {
  const me = useMe();
  const [model, setModel] = useState<ProcessModel | null>(null);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [versionNo, setVersionNo] = useState<number | "draft">(0);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<Tab>("overview");
  const [scope, setScope] = useState<string | null>(null);
  const [by, setBy] = useState<LaneBy>("role");
  const [selected, setSelected] = useState<string | null>(null);
  const [fRole, setFRole] = useState("");
  const [fSystem, setFSystem] = useState("");
  const [q, setQ] = useState("");
  const [overlays, setOverlays] = useState<Overlays>({ pain: false, controls: false, automation: false, confidence: false });
  const [badges, setBadges] = useState<Record<string, StepBadge>>({});
  const [embed, setEmbed] = useState(false);
  const [diffMap, setDiffMap] = useState<Record<string, "added" | "changed"> | undefined>();
  const [playing, setPlaying] = useState(false);
  const [wIdx, setWIdx] = useState<number | null>(null);
  const flowRef = useRef<HTMLDivElement>(null);

  const canCollab = !!me?.user && roleRank[me.user.role] >= roleRank.reviewer;
  const isAuthor = me?.user?.role === "author";

  const loadBadges = useCallback(() => {
    api<{ perStep: Record<string, StepBadge> }>(`/api/blueprints/${id}/approvals`).then((r) => setBadges(r.perStep)).catch(() => {});
  }, [id]);

  // initial load + URL state
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    setEmbed(sp.get("embed") === "1");
    const v = sp.get("v");
    api<Bundle>(`/api/blueprints/${id}`).then(setBundle).catch((e) => setError(e.message));
    api<{ model: ProcessModel; versionNo: number }>(`/api/blueprints/${id}/model?v=${v ?? "latest"}`)
      .then((r) => {
        setModel(r.model); setVersionNo(r.versionNo);
        const t = sp.get("view") as Tab | null;
        if (t && TABS.some(([k]) => k === t)) setTab(t);
        const p = sp.get("p");
        if (p && r.model.processes.some((x) => x.id === p)) setScope(p);
        const s = sp.get("s");
        if (s && r.model.steps.some((x) => x.id === s)) { setSelected(s); setTab("flow"); setScope((cur) => cur ?? r.model.steps.find((x) => x.id === s)!.processId); }
      })
      .catch((e) => setError(e.message));
    loadBadges();
  }, [id, loadBadges]);

  // keep the URL shareable (FR-27)
  useEffect(() => {
    if (!model) return;
    const sp = new URLSearchParams(window.location.search);
    const set = (k: string, v: string | null) => (v ? sp.set(k, v) : sp.delete(k));
    set("view", tab === "overview" ? null : tab); set("p", scope); set("s", selected);
    set("v", versionNo === 0 ? null : String(versionNo));
    const qs = sp.toString();
    window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
  }, [tab, scope, selected, versionNo, model]);

  const root = model?.processes.find((p) => p.level === "L0") ?? null;
  const scopeId = scope ?? root?.id ?? null;
  const scopeSteps = useMemo(() => {
    if (!model || !scopeId) return [];
    const ids = descendantIds(model, scopeId);
    return model.steps.filter((s) => ids.has(s.processId));
  }, [model, scopeId]);

  const matches = useMemo(() => {
    if (!model || (!fRole && !fSystem && !q.trim())) return null;
    const needle = q.trim().toLowerCase();
    const set = new Set<string>();
    for (const s of scopeSteps) {
      if (fRole && !s.roles.some((r) => r.role === fRole)) continue;
      if (fSystem && !s.systems.includes(fSystem)) continue;
      if (needle && !stepText(s).includes(needle)) continue;
      set.add(s.id);
    }
    return set;
  }, [model, scopeSteps, fRole, fSystem, q]);

  const searchHits = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!model || needle.length < 2) return [];
    return model.steps.filter((s) => stepText(s).includes(needle)).slice(0, 8);
  }, [model, q]);

  const order = useMemo(() => layoutSteps(scopeSteps, model?.links ?? [], by).order, [scopeSteps, model, by]);

  // walkthrough player
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setWIdx((i) => {
      const n = (i ?? -1) + 1;
      if (n >= order.length) { setPlaying(false); return i; }
      return n;
    }), 3800);
    return () => clearInterval(t);
  }, [playing, order.length]);
  useEffect(() => { setWIdx(null); setPlaying(false); }, [scopeId, by]);

  const activeStep = wIdx !== null ? order[wIdx] : null;
  const narration = useMemo(() => {
    if (!activeStep || !model) return "";
    const outs = model.links.filter((l) => l.from === activeStep.id);
    const who = laneOf(activeStep, "role");
    const next = outs.map((l) => `${l.condition ? `If “${l.condition}”, ` : ""}${l.type === "handoff" ? "hand off to" : "go to"} “${model.steps.find((s) => s.id === l.to)?.name}”`).join("; ");
    return `${who} — ${activeStep.name}. ${activeStep.description}${activeStep.systems.length ? ` Uses ${activeStep.systems.join(", ")}.` : ""}${next ? ` Next: ${next}.` : " This is an end point of the flow."}`;
  }, [activeStep, model]);

  if (error) return <div className="p-8"><Header me={me} /><p role="alert" className="text-pain">{error}</p></div>;
  if (!model || !root) return <div className="p-8 text-muted">Loading…</div>;

  const sel = selected ? model.steps.find((s) => s.id === selected) ?? null : null;
  const goFlow = (pid: string) => { setScope(pid); setTab("flow"); setSelected(null); };
  const deepLink = typeof window === "undefined" ? "" : `${window.location.origin}/b/${id}?view=flow&p=${sel?.processId ?? ""}&s=${sel?.id ?? ""}`;
  const published = bundle?.versions.filter((v) => v.status === "published") ?? [];

  async function exportPng() {
    const el = flowRef.current?.querySelector(".react-flow") as HTMLElement | null;
    if (!el) return;
    const url = await toPng(el, { backgroundColor: "#ffffff", pixelRatio: 2, filter: (n) => !(n as HTMLElement).classList?.contains("react-flow__controls") });
    const a = document.createElement("a");
    a.href = url; a.download = `${model!.title.replace(/\W+/g, "_")}-flow.png`; a.click();
  }

  return (
    <div className="flex h-dvh flex-col">
      {!embed && <Header me={me} />}
      <div className="no-print flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-panel px-4">
        <h1 className="py-2 text-base font-semibold">{model.title}</h1>
        {published.length > 0 && (
          <select className="input !w-auto !py-1 text-xs" aria-label="Version" value={String(versionNo)}
            onChange={(e) => { window.location.search = `?v=${e.target.value}${embed ? "&embed=1" : ""}`; }}>
            {published.map((v) => <option key={v.id} value={v.versionNo}>v{v.versionNo} — {new Date(v.createdAt).toLocaleDateString()}</option>)}
          </select>
        )}
        <div role="tablist" className="flex flex-wrap">
          {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className="tab" onClick={() => setTab(k)}>{label}</button>)}
        </div>
        <div className="ml-auto flex items-center gap-2 py-1">
          {isAuthor && <Link className="btn" href={`/b/${id}/author`}><Pencil size={14} /> Author</Link>}
          <details className="relative">
            <summary className="btn list-none"><Download size={14} /> Export</summary>
            <div className="absolute right-0 z-30 mt-1 w-56 rounded-lg border border-line bg-panel p-1 text-sm shadow-lg">
              <button className="block w-full rounded px-3 py-1.5 text-left hover:bg-slate-100" onClick={() => { setTab("flow"); setTimeout(exportPng, 400); }}>Flow as PNG</button>
              <button className="block w-full rounded px-3 py-1.5 text-left hover:bg-slate-100" onClick={() => window.print()}>Print / Save as PDF</button>
              {[["pptx", "PowerPoint"], ["raci", "Excel — RACI"], ["backlog", "Excel — automation backlog"], ["bpmn", "BPMN 2.0 XML"]].map(([f, l]) => (
                <a key={f} className="block rounded px-3 py-1.5 hover:bg-slate-100" href={`/api/blueprints/${id}/export?format=${f}&v=${versionNo || "latest"}`}>{l}</a>
              ))}
            </div>
          </details>
        </div>
      </div>

      {tab === "flow" && (
        <div className="no-print flex flex-wrap items-center gap-2 border-b border-line bg-panel px-4 py-2 text-sm">
          <select className="input !w-auto" aria-label="Process scope" value={scopeId ?? ""} onChange={(e) => { setScope(e.target.value); setSelected(null); }}>
            {model.processes.map((p) => <option key={p.id} value={p.id}>{"— ".repeat(["L0", "L1", "L2", "L3"].indexOf(p.level))}{p.name}</option>)}
          </select>
          <div className="flex overflow-hidden rounded-lg border border-line" role="group" aria-label="Swimlanes">
            {(["role", "system"] as const).map((b) => <button key={b} aria-pressed={by === b} className={`px-3 py-1.5 ${by === b ? "bg-brand text-white" : "bg-white"}`} onClick={() => setBy(b)}>By {b}</button>)}
          </div>
          <select className="input !w-auto" aria-label="Filter by role" value={fRole} onChange={(e) => setFRole(e.target.value)}>
            <option value="">All roles</option>{model.roles.map((r) => <option key={r.id}>{r.name}</option>)}
          </select>
          <select className="input !w-auto" aria-label="Filter by system" value={fSystem} onChange={(e) => setFSystem(e.target.value)}>
            <option value="">All systems</option>{model.systems.map((s) => <option key={s.id}>{s.name}</option>)}
          </select>
          <div className="relative">
            <Search size={14} className="pointer-events-none absolute left-2 top-2.5 text-muted" />
            <input className="input !w-56 !pl-7" placeholder="Search steps, roles, rules…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search" />
            {searchHits.length > 0 && (
              <ul className="absolute z-30 mt-1 max-h-72 w-80 overflow-auto rounded-lg border border-line bg-panel p-1 shadow-lg">
                {searchHits.map((s) => (
                  <li key={s.id}><button className="block w-full rounded px-2 py-1.5 text-left text-sm hover:bg-slate-100" onClick={() => { setScope(s.processId); setSelected(s.id); setQ(""); }}>
                    <b>{s.name}</b><div className="text-xs text-muted">{processPath(model, s.processId).slice(1).map((p) => p.name).join(" › ")}</div>
                  </button></li>
                ))}
              </ul>
            )}
          </div>
          <div className="ml-auto flex items-center gap-1" role="group" aria-label="Overlays">
            {([["pain", Flame, "Pain points"], ["controls", ShieldCheck, "Controls"], ["automation", Cog, "Automation"], ["confidence", AlertTriangle, "Low confidence"]] as const).map(([k, Icon, label]) => (
              <button key={k} aria-pressed={overlays[k]} className={`btn ${overlays[k] ? "!border-brand !bg-blue-50" : ""}`} onClick={() => setOverlays({ ...overlays, [k]: !overlays[k] })}><Icon size={14} />{label}</button>
            ))}
            {diffMap && <button className="btn" onClick={() => setDiffMap(undefined)}>Clear change highlights</button>}
          </div>
        </div>
      )}

      <div className="flex min-h-0 flex-1">
        <main className="min-w-0 flex-1 overflow-auto">
          {tab === "overview" && <Overview model={model} root={root} onOpen={goFlow} />}
          {tab === "flow" && (
            <div className="flex h-full flex-col">
              <nav className="no-print flex flex-wrap items-center gap-1 border-b border-line bg-white px-4 py-1.5 text-xs text-muted" aria-label="Breadcrumb">
                {processPath(model, scopeId!).map((p, i, a) => (
                  <span key={p.id}>{i > 0 && " › "}<button className="hover:underline" onClick={() => { setScope(p.id); setSelected(null); }}>{p.name}</button>{i === a.length - 1 && <span className="ml-2">{scopeSteps.length} steps</span>}</span>
                ))}
                <span className="ml-auto flex items-center gap-1">
                  <button className="btn !py-1" onClick={() => { setWIdx(0); setPlaying(true); }}><Play size={13} />Walkthrough</button>
                </span>
              </nav>
              {activeStep && (
                <div className="no-print flex items-center gap-3 border-b border-line bg-blue-50 px-4 py-2 text-sm" aria-live="polite">
                  <div className="flex gap-1">
                    <button className="btn !p-1.5" aria-label="Previous step" onClick={() => { setPlaying(false); setWIdx(Math.max(0, (wIdx ?? 0) - 1)); }}><SkipBack size={14} /></button>
                    <button className="btn !p-1.5" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)}>{playing ? <Pause size={14} /> : <Play size={14} />}</button>
                    <button className="btn !p-1.5" aria-label="Next step" onClick={() => { setPlaying(false); setWIdx(Math.min(order.length - 1, (wIdx ?? 0) + 1)); }}><SkipForward size={14} /></button>
                  </div>
                  <span className="text-xs text-muted">{(wIdx ?? 0) + 1}/{order.length}</span>
                  <p className="flex-1">{narration}</p>
                  <button className="btn !py-1" onClick={() => { setWIdx(null); setPlaying(false); }}>Exit</button>
                </div>
              )}
              <div ref={flowRef} className="min-h-0 flex-1 bg-white">
                <FlowCanvas steps={scopeSteps} links={model.links} by={by} matches={matches} selectedId={selected} activeId={activeStep?.id ?? null}
                  overlays={overlays} badges={badges} diff={diffMap} onSelect={setSelected} />
              </div>
            </div>
          )}
          {tab === "raci" && <Raci model={model} scopeId={scopeId!} setScope={setScope} onSelect={(sid) => { setSelected(sid); }} />}
          {tab === "systems" && <Systems model={model} onSelect={(sid, pid) => { setScope(pid); setSelected(sid); setTab("flow"); }} />}
          {tab === "heatmap" && <Heatmap model={model} root={root} onOpen={goFlow} />}
          {tab === "ask" && <Ask id={id} version={versionNo} ai={!!me?.ai} onStep={(sid) => { const s = model.steps.find((x) => x.id === sid); if (s) { setScope(s.processId); setSelected(sid); setTab("flow"); } }} />}
          {tab === "changes" && <Changes id={id} versions={published} current={versionNo} onHighlight={(m) => { setDiffMap(m); setTab("flow"); setScope(root.id); }} />}
        </main>
        {sel && (
          <div className="no-print w-[26rem] shrink-0">
            <StepDetail step={sel} model={model} blueprintId={id} user={me?.user ?? null} canCollab={canCollab} deepLink={deepLink}
              onClose={() => setSelected(null)} onSelect={(sid) => setSelected(sid)} onChanged={loadBadges} />
          </div>
        )}
      </div>
    </div>
  );
}

const stepText = (s: Step) =>
  [s.name, s.description, ...s.roles.map((r) => r.role), ...s.systems, ...s.rules, ...s.inputs, ...s.outputs, ...s.controls, ...s.painPoints].join(" ").toLowerCase();

function Stat({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return <div className="card px-4 py-3"><div className={`text-2xl font-semibold ${tone ?? ""}`}>{value}</div><div className="text-xs text-muted">{label}</div></div>;
}

function Overview({ model, root, onOpen }: { model: ProcessModel; root: Process; onOpen: (id: string) => void }) {
  const all = stats(model, new Set(model.processes.map((p) => p.id)));
  const l1 = childrenOf(model, root.id);
  return (
    <div className="p-5">
      <div className="mb-1 flex flex-wrap items-baseline gap-3">
        <h2 className="text-xl font-semibold">{root.name}</h2>
        <button className="btn !py-1" onClick={() => onOpen(root.id)}>View end-to-end flow</button>
      </div>
      <p className="mb-4 max-w-3xl text-sm text-muted">{root.objective || root.scope || "End-to-end process landscape. Click a process area to drill down."}</p>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Steps" value={all.steps} /><Stat label="Pain points" value={all.pain} tone="text-pain" /><Stat label="Controls" value={all.controls} tone="text-control" />
        <Stat label="Automation candidates" value={all.auto} tone="text-auto" /><Stat label="Need review (low confidence)" value={all.low} tone="text-warn" />
      </div>
      <div className="flex gap-2 overflow-x-auto pb-2">
        {l1.map((p) => {
          const st = stats(model, descendantIds(model, p.id));
          return (
            <section key={p.id} className="min-w-64 flex-1">
              <button onClick={() => onOpen(p.id)} className="w-full rounded-lg bg-brand px-4 py-3 text-left text-white [clip-path:polygon(0_0,92%_0,100%_50%,92%_100%,0_100%)] hover:brightness-110">
                <div className="font-semibold">{p.name}</div>
                <div className="text-xs opacity-90">{st.steps} steps · {st.pain} pain points · {st.auto} automation</div>
              </button>
              <div className="mt-2 space-y-2">
                {childrenOf(model, p.id).map((c) => {
                  const cs = stats(model, descendantIds(model, c.id));
                  return (
                    <button key={c.id} onClick={() => onOpen(c.id)} className="card w-full p-3 text-left hover:border-brand">
                      <div className="text-sm font-medium">{c.name}</div>
                      <div className="mt-1 flex gap-2 text-xs text-muted">
                        <span>{cs.steps} steps</span>{cs.pain > 0 && <span className="text-pain">🔥{cs.pain}</span>}{cs.auto > 0 && <span className="text-auto">⚙{cs.auto}</span>}{cs.low > 0 && <span className="text-warn">⚠{cs.low}</span>}
                      </div>
                      {c.owner && <div className="text-xs text-muted">Owner: {c.owner}</div>}
                      {childrenOf(model, c.id).length > 0 && <div className="mt-1 text-xs text-muted">{childrenOf(model, c.id).length} sub-processes</div>}
                    </button>
                  );
                })}
                {childrenOf(model, p.id).length === 0 && model.steps.filter((s) => s.processId === p.id).length > 0 && (
                  <p className="px-1 text-xs text-muted">Steps defined directly in this area.</p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function Raci({ model, scopeId, setScope, onSelect }: { model: ProcessModel; scopeId: string; setScope: (id: string) => void; onSelect: (id: string) => void }) {
  const ids = descendantIds(model, scopeId);
  const steps = model.steps.filter((s) => ids.has(s.processId));
  const roles = model.roles.filter((r) => steps.some((s) => s.roles.some((x) => x.role === r.name)));
  const color: Record<string, string> = { R: "bg-blue-100 text-blue-800", A: "bg-green-100 text-green-800", C: "bg-amber-100 text-amber-800", I: "bg-slate-100 text-slate-700" };
  return (
    <div className="p-5">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold">RACI matrix</h2>
        <select className="input !w-auto" aria-label="Process scope" value={scopeId} onChange={(e) => setScope(e.target.value)}>
          {model.processes.map((p) => <option key={p.id} value={p.id}>{p.level} {p.name}</option>)}
        </select>
      </div>
      <div className="card overflow-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50"><tr><th className="sticky left-0 bg-slate-50 p-2 text-left">Step</th>{roles.map((r) => <th key={r.id} className="p-2 text-center text-xs">{r.name}</th>)}</tr></thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.id} className="border-t border-line">
                <td className="sticky left-0 bg-white p-2"><button className="text-left hover:text-brand" onClick={() => onSelect(s.id)}>{s.name}</button></td>
                {roles.map((r) => {
                  const x = s.roles.filter((y) => y.role === r.name).map((y) => y.raci);
                  return <td key={r.id} className="p-1 text-center">{x.map((l) => <span key={l} className={`mx-0.5 inline-block rounded px-1.5 text-xs font-semibold ${color[l]}`}>{l}</span>)}</td>;
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Systems({ model, onSelect }: { model: ProcessModel; onSelect: (stepId: string, processId: string) => void }) {
  return (
    <div className="p-5">
      <h2 className="mb-3 text-lg font-semibold">System touchpoints</h2>
      <div className="grid gap-3 md:grid-cols-2">
        {model.systems.map((sys) => {
          const steps = model.steps.filter((s) => s.systems.includes(sys.name));
          const inputs = [...new Set(steps.flatMap((s) => s.inputs))].slice(0, 8);
          const outputs = [...new Set(steps.flatMap((s) => s.outputs))].slice(0, 8);
          return (
            <section key={sys.id} className="card p-4">
              <h3 className="font-semibold">{sys.name} <span className="chip ml-1">{steps.length} steps</span></h3>
              {inputs.length > 0 && <p className="mt-2 text-xs"><b>Data in:</b> {inputs.join(", ")}</p>}
              {outputs.length > 0 && <p className="mt-1 text-xs"><b>Data out:</b> {outputs.join(", ")}</p>}
              <ul className="mt-2 space-y-0.5 text-sm">
                {steps.map((s) => <li key={s.id}><button className="text-left hover:text-brand" onClick={() => onSelect(s.id, s.processId)}>• {s.name}</button></li>)}
              </ul>
            </section>
          );
        })}
        {model.systems.length === 0 && <p className="text-muted">No systems recorded.</p>}
      </div>
    </div>
  );
}

function Heatmap({ model, root, onOpen }: { model: ProcessModel; root: Process; onOpen: (id: string) => void }) {
  const [metric, setMetric] = useState<"pain" | "steps" | "auto" | "low">("pain");
  const areas = model.processes.filter((p) => p.level === "L2" || (p.level === "L1" && childrenOf(model, p.id).length === 0));
  const rows = areas.map((p) => ({ p, v: stats(model, descendantIds(model, p.id)) }));
  const val = (r: (typeof rows)[0]) => r.v[metric];
  const max = Math.max(1, ...rows.map(val));
  const label = { pain: "Pain points", steps: "Number of steps", auto: "Automation candidates", low: "Low-confidence items" }[metric];
  return (
    <div className="p-5">
      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold">Heatmap — {root.name}</h2>
        <select className="input !w-auto" aria-label="Metric" value={metric} onChange={(e) => setMetric(e.target.value as typeof metric)}>
          <option value="pain">Pain points</option><option value="steps">Steps (effort proxy)</option><option value="auto">Automation candidates</option><option value="low">Low confidence</option>
        </select>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {rows.map((r) => {
          const a = val(r) / max;
          return (
            <button key={r.p.id} onClick={() => onOpen(r.p.id)} className="card p-4 text-left hover:border-brand" style={{ background: `rgba(217,59,59,${(0.08 + a * 0.55).toFixed(2)})` }}>
              <div className="text-sm font-semibold">{r.p.name}</div>
              <div className="text-2xl font-bold">{val(r)}</div>
              <div className="text-xs text-muted">{label}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Ask({ id, version, ai, onStep }: { id: string; version: number | "draft"; ai: boolean; onStep: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState<{ q: string; a: string; steps: { id: string; name: string }[] }[]>([]);
  const [err, setErr] = useState("");
  const examples = ["Who approves credit exceptions?", "Which steps use SAP?", "Where are the biggest pain points?"];
  async function ask(question: string) {
    if (!question.trim()) return;
    setBusy(true); setErr("");
    try {
      const r = await api<{ answer: string; steps: { id: string; name: string }[] }>(`/api/blueprints/${id}/ask`, { method: "POST", json: { question, version: version || "latest" } });
      setLog((l) => [{ q: question, a: r.answer, steps: r.steps }, ...l]); setQ("");
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }
  return (
    <div className="mx-auto max-w-3xl p-5">
      <h2 className="mb-1 text-lg font-semibold">Ask the blueprint</h2>
      <p className="mb-3 text-sm text-muted">Answers are grounded in the published process model and source document, with citations.</p>
      {!ai && <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-warn">Q&amp;A is unavailable: no ANTHROPIC_API_KEY is configured on the server.</p>}
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="mb-3 flex gap-2">
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask in plain language…" aria-label="Question" />
        <button className="btn btn-primary" disabled={busy || !ai}>{busy ? "Thinking…" : "Ask"}</button>
      </form>
      <div className="mb-4 flex flex-wrap gap-2">{examples.map((x) => <button key={x} className="chip hover:border-brand" onClick={() => ask(x)} disabled={!ai}>{x}</button>)}</div>
      {err && <p role="alert" className="mb-3 text-sm text-pain">{err}</p>}
      <div className="space-y-4">
        {log.map((m, i) => (
          <div key={i} className="card p-4">
            <p className="mb-2 text-sm font-semibold">{m.q}</p>
            <p className="whitespace-pre-wrap text-sm">{m.a}</p>
            {m.steps.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{m.steps.map((s) => <button key={s.id} className="chip text-brand" onClick={() => onStep(s.id)}>{s.name}</button>)}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}

function Changes({ id, versions, current, onHighlight }: { id: string; versions: VersionMeta[]; current: number | "draft"; onHighlight: (m: Record<string, "added" | "changed">) => void }) {
  const [from, setFrom] = useState<number | null>(null);
  const [diff, setDiff] = useState<DiffRes | null>(null);
  const cur = typeof current === "number" && current > 0 ? current : versions[0]?.versionNo;
  const prev = versions.filter((v) => v.versionNo < (cur ?? 0));
  useEffect(() => { if (from === null && prev[0]) setFrom(prev[0].versionNo); }, [prev, from]);
  useEffect(() => {
    if (from === null || !cur) return;
    api<DiffRes>(`/api/blueprints/${id}/diff?from=${from}&to=${cur}`).then(setDiff).catch(() => setDiff(null));
  }, [from, cur, id]);
  return (
    <div className="mx-auto max-w-3xl p-5">
      <h2 className="mb-3 text-lg font-semibold">Version history</h2>
      <ul className="card mb-6 divide-y divide-line">
        {versions.map((v) => <li key={v.id} className="p-3 text-sm"><b>v{v.versionNo}</b> · {new Date(v.createdAt).toLocaleString()} · {v.publishedBy}<div className="text-muted">{v.changeSummary}</div></li>)}
      </ul>
      {prev.length > 0 ? (
        <>
          <div className="mb-3 flex items-center gap-2 text-sm">Compare v{cur} with
            <select className="input !w-auto" value={from ?? ""} onChange={(e) => setFrom(Number(e.target.value))} aria-label="Compare against">{prev.map((v) => <option key={v.id} value={v.versionNo}>v{v.versionNo}</option>)}</select>
          </div>
          {diff && (
            <div className="space-y-3 text-sm">
              <button className="btn" onClick={() => { const m: Record<string, "added" | "changed"> = {}; diff.added.forEach((x) => (m[x.id] = "added")); diff.changed.forEach((x) => (m[x.id] = "changed")); onHighlight(m); }}>Highlight in flow</button>
              <DiffList title="Added" tone="text-control" items={diff.added.map((x) => x.name ?? x.id)} />
              <DiffList title="Changed" tone="text-warn" items={diff.changed.map((x) => `${x.name} (${x.fields.join(", ")})`)} />
              <DiffList title="Removed" tone="text-pain" items={diff.removed.map((x) => x.name ?? x.id)} />
              {!diff.added.length && !diff.changed.length && !diff.removed.length && <p className="text-muted">No step-level differences.</p>}
            </div>
          )}
        </>
      ) : <p className="text-sm text-muted">Publish a second version to compare changes.</p>}
    </div>
  );
}

function DiffList({ title, items, tone }: { title: string; items: string[]; tone: string }) {
  if (!items.length) return null;
  return <section><h3 className={`font-semibold ${tone}`}>{title} ({items.length})</h3><ul className="list-disc pl-5">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></section>;
}
