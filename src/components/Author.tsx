"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowDown, ArrowUp, Plus, Trash2, Merge } from "lucide-react";
import { api, useMe } from "@/lib/client";
import { Header } from "@/components/Header";
import { UploadPanel } from "@/components/UploadPanel";
import {
  AUTOMATION_TAGS, LEVELS, LINK_TYPES, LOW_CONFIDENCE, STEP_TYPES, normalizeModel, uid, processPath,
  type Link as L, type Process, type ProcessModel, type Step,
} from "@/lib/model";

type Bundle = { blueprint: { id: string; name: string }; versions: { versionNo: number; status: string }[]; documents: { id: string; filename: string }[] };
type Source = { sections: { ref: string; doc: string; text: string }[] };
const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

function LineField({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const [text, setText] = useState(value.join("\n"));
  useEffect(() => { setText(value.join("\n")); }, [value.join("\n")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div>
      <label className="label">{label} <span className="normal-case font-normal">(one per line)</span></label>
      <textarea className="input" rows={Math.min(5, Math.max(2, value.length + 1))} value={text} onChange={(e) => { setText(e.target.value); onChange(lines(e.target.value)); }} />
    </div>
  );
}

export function Author({ id }: { id: string }) {
  const me = useMe();
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [model, setModel] = useState<ProcessModel | null>(null);
  const [dirty, setDirty] = useState(false);
  const [sel, setSel] = useState<string | null>(null);
  const [left, setLeft] = useState<"steps" | "processes">("steps");
  const [onlyLow, setOnlyLow] = useState(false);
  const [source, setSource] = useState<Source | null>(null);
  const [msg, setMsg] = useState("");
  const [summary, setSummary] = useState("");
  const [diff, setDiff] = useState<string>("");
  const [publishing, setPublishing] = useState(false);
  const [confirmLow, setConfirmLow] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(null);

  const reload = useCallback(async () => {
    const b = await api<Bundle>(`/api/blueprints/${id}`);
    setBundle(b);
    try {
      const r = await api<{ model: ProcessModel }>(`/api/blueprints/${id}/model?v=draft`);
      setModel(r.model); setDirty(false);
      setSel((cur) => cur ?? r.model.steps[0]?.id ?? null);
    } catch { setModel(null); }
  }, [id]);
  useEffect(() => { reload().catch((e) => setMsg(e.message)); }, [reload]);

  const step = model?.steps.find((s) => s.id === sel) ?? null;
  useEffect(() => {
    if (!step) { setSource(null); return; }
    api<Source>(`/api/blueprints/${id}/source?ref=${encodeURIComponent(step.sourceRef)}`).then(setSource).catch(() => setSource(null));
  }, [id, step?.id, step?.sourceRef]); // eslint-disable-line react-hooks/exhaustive-deps

  const edit = (fn: (m: ProcessModel) => void) => {
    setModel((cur) => { if (!cur) return cur; const c = structuredClone(cur); fn(c); return c; });
    setDirty(true);
  };
  const editStep = (patch: Partial<Step>) => step && edit((m) => { Object.assign(m.steps.find((s) => s.id === step.id)!, patch); });

  const lowCount = useMemo(() => model?.steps.filter((s) => s.confidence < LOW_CONFIDENCE).length ?? 0, [model]);
  const shown = useMemo(() => (model?.steps ?? []).filter((s) => !onlyLow || s.confidence < LOW_CONFIDENCE), [model, onlyLow]);

  async function save(): Promise<boolean> {
    if (!model) return false;
    try { await api(`/api/blueprints/${id}/model`, { method: "PUT", json: normalizeModel(model) }); setDirty(false); setMsg("Draft saved"); return true; }
    catch (e) { setMsg(e instanceof Error ? e.message : "Save failed"); return false; }
  }
  async function publish(force = false) {
    if (!model || publishing) return;
    if (lowCount > 0 && !force) { setConfirmLow(true); return; }
    setConfirmLow(false); setPublishing(true); setBanner(null);
    try {
      if (!(await save())) throw new Error("Could not save the draft before publishing");
      const r = await api<{ versionNo: number }>(`/api/blueprints/${id}/model`, { method: "POST", json: { changeSummary: summary } });
      setBanner({ ok: true, text: `Published version ${r.versionNo}.` }); setSummary(""); await reload();
    } catch (e) { setBanner({ ok: false, text: e instanceof Error ? e.message : "Publish failed" }); }
    finally { setPublishing(false); }
  }
  async function showDiff() {
    if (!(await save())) return;
    try {
      const d = await api<{ added: unknown[]; removed: unknown[]; changed: { name: string }[] }>(`/api/blueprints/${id}/diff?from=latest&to=draft`);
      setDiff(`Draft vs published: ${d.added.length} added, ${d.changed.length} changed, ${d.removed.length} removed`);
    } catch (e) { setDiff(e instanceof Error ? e.message : "No published version to compare"); }
  }

  const addStep = () => edit((m) => {
    const proc = m.steps.find((s) => s.id === sel)?.processId ?? m.processes.find((p) => p.level !== "L0")?.id ?? m.processes[0]?.id;
    const s: Step = { id: uid("s"), processId: proc, name: "New step", type: "task", description: "", roles: [], systems: [], inputs: [], outputs: [], rules: [], sla: "", controls: [], painPoints: [], automationTag: "none", automationRationale: "", confidence: 1, sourceRef: "" };
    const at = m.steps.findIndex((x) => x.id === sel);
    m.steps.splice(at >= 0 ? at + 1 : m.steps.length, 0, s);
    setSel(s.id);
  });
  const move = (dir: -1 | 1) => edit((m) => {
    const i = m.steps.findIndex((s) => s.id === sel), j = i + dir;
    if (i < 0 || j < 0 || j >= m.steps.length) return;
    [m.steps[i], m.steps[j]] = [m.steps[j], m.steps[i]];
  });
  const del = () => step && confirm(`Delete “${step.name}” and its links?`) && edit((m) => {
    m.steps = m.steps.filter((s) => s.id !== step.id);
    m.links = m.links.filter((l) => l.from !== step.id && l.to !== step.id);
    setSel(m.steps[0]?.id ?? null);
  });
  const merge = (otherId: string) => step && edit((m) => {
    const a = m.steps.find((s) => s.id === step.id)!, b = m.steps.find((s) => s.id === otherId);
    if (!b) return;
    const u = (x: string[], y: string[]) => [...new Set([...x, ...y])];
    a.description = a.description || b.description;
    a.roles = [...a.roles, ...b.roles.filter((r) => !a.roles.some((x) => x.role === r.role && x.raci === r.raci))];
    a.systems = u(a.systems, b.systems); a.inputs = u(a.inputs, b.inputs); a.outputs = u(a.outputs, b.outputs);
    a.rules = u(a.rules, b.rules); a.controls = u(a.controls, b.controls); a.painPoints = u(a.painPoints, b.painPoints);
    m.links = m.links.map((l) => ({ ...l, from: l.from === b.id ? a.id : l.from, to: l.to === b.id ? a.id : l.to })).filter((l) => l.from !== l.to);
    m.steps = m.steps.filter((s) => s.id !== b.id);
  });
  const patchLink = (lid: string, patch: Partial<L>) => edit((m) => { Object.assign(m.links.find((l) => l.id === lid)!, patch); });

  if (bundle && me?.user && me.user.role !== "author") return <div className="p-8"><Header me={me} /><p className="mt-6 text-pain">Only authors can edit blueprints.</p></div>;
  if (!bundle) return <div className="p-8 text-muted">{msg || "Loading…"}</div>;
  const publishedCount = bundle.versions.filter((v) => v.status === "published").length;

  return (
    <div className="flex h-dvh flex-col">
      <Header me={me} />
      <div className="no-print flex flex-wrap items-center gap-3 border-b border-line bg-panel px-4 py-2">
        <h1 className="font-semibold">{bundle.blueprint.name}</h1>
        <span className="chip">{publishedCount ? `${publishedCount} published` : "never published"}</span>
        {dirty && <span className="chip text-warn">unsaved changes</span>}
        <span className="text-xs text-muted" aria-live="polite">{msg}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {diff && <span className="text-xs text-muted">{diff}</span>}
          {publishedCount > 0 && <button className="btn" onClick={showDiff}>Compare with published</button>}
          <button className="btn" onClick={save} disabled={!dirty}>Save draft</button>
          <input className="input !w-56" placeholder="Change summary (optional)" value={summary} onChange={(e) => setSummary(e.target.value)} aria-label="Change summary" />
          <button className="btn btn-primary" onClick={() => publish()} disabled={!model || publishing}>{publishing ? "Publishing…" : "Publish"}</button>
          {publishedCount > 0 && <Link className="btn" href={`/b/${id}`}>Open viewer</Link>}
        </div>
      </div>

      {confirmLow && (
        <div role="alertdialog" className="flex flex-wrap items-center gap-3 border-b border-warn bg-amber-50 px-4 py-2 text-sm">
          <AlertTriangle size={16} className="text-warn" aria-hidden />
          <span>{lowCount} step(s) still have low confidence. Review them first (tick “Needs review” in the list), or publish anyway.</span>
          <button className="btn" onClick={() => { setConfirmLow(false); setOnlyLow(true); setLeft("steps"); }}>Review them</button>
          <button className="btn btn-primary" onClick={() => publish(true)}>Publish anyway</button>
          <button className="btn" onClick={() => setConfirmLow(false)}>Cancel</button>
        </div>
      )}
      {banner && (
        <div role={banner.ok ? "status" : "alert"} className={`flex items-center gap-3 border-b px-4 py-2 text-sm ${banner.ok ? "border-control bg-green-50 text-control" : "border-pain bg-red-50 text-pain"}`}>
          <span>{banner.text}</span>
          {banner.ok && <Link className="btn" href={`/b/${id}`}>Open viewer</Link>}
          <button className="btn ml-auto" onClick={() => setBanner(null)}>Dismiss</button>
        </div>
      )}
      <div className="border-b border-line p-3">
        <UploadPanel blueprintId={id} blob={!!me?.blob} ai={!!me?.ai} hasDraft={!!model} onDone={reload} />
      </div>

      {!model ? <p className="p-6 text-muted">Upload a document to generate the first draft.</p> : (
        <div className="grid min-h-0 flex-1 grid-cols-[18rem_1fr_22rem]">
          <section className="flex min-h-0 flex-col border-r border-line bg-panel" aria-label="Model outline">
            <div className="flex border-b border-line">
              {(["steps", "processes"] as const).map((t) => <button key={t} role="tab" aria-selected={left === t} className="tab flex-1 capitalize" onClick={() => setLeft(t)}>{t} ({t === "steps" ? model.steps.length : model.processes.length})</button>)}
            </div>
            {left === "steps" ? (
              <>
                <div className="flex items-center gap-1 border-b border-line p-2">
                  <button className="btn !px-2" onClick={addStep} title="Add step"><Plus size={14} /></button>
                  <button className="btn !px-2" onClick={() => move(-1)} title="Move up" aria-label="Move step up"><ArrowUp size={14} /></button>
                  <button className="btn !px-2" onClick={() => move(1)} title="Move down" aria-label="Move step down"><ArrowDown size={14} /></button>
                  <button className="btn btn-danger !px-2" onClick={del} title="Delete step" aria-label="Delete step"><Trash2 size={14} /></button>
                  <label className="ml-auto flex items-center gap-1 text-xs"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} /> Needs review ({lowCount})</label>
                </div>
                <ul className="min-h-0 flex-1 overflow-auto">
                  {shown.map((s) => (
                    <li key={s.id}>
                      <button onClick={() => setSel(s.id)} className={`flex w-full items-start gap-2 border-b border-line px-3 py-2 text-left text-sm ${sel === s.id ? "bg-blue-50" : "hover:bg-slate-50"}`}>
                        {s.confidence < LOW_CONFIDENCE && <AlertTriangle size={13} className="mt-0.5 shrink-0 text-warn" aria-label="Low confidence" />}
                        <span><span className="block">{s.name}</span><span className="text-xs text-muted">{model.processes.find((p) => p.id === s.processId)?.name} · {Math.round(s.confidence * 100)}%</span></span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : <ProcessEditor model={model} edit={edit} />}
          </section>

          <section className="min-h-0 overflow-y-auto p-4" aria-label="Step editor">
            {step ? (
              <div className="mx-auto max-w-2xl space-y-3">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-3 sm:col-span-2"><label className="label" htmlFor="sn">Name</label><input id="sn" className="input" value={step.name} onChange={(e) => editStep({ name: e.target.value })} /></div>
                  <div><label className="label" htmlFor="st">Type</label><select id="st" className="input" value={step.type} onChange={(e) => editStep({ type: e.target.value as Step["type"] })}>{STEP_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
                </div>
                <div><label className="label" htmlFor="sp">Process</label>
                  <select id="sp" className="input" value={step.processId} onChange={(e) => editStep({ processId: e.target.value })}>
                    {model.processes.map((p) => <option key={p.id} value={p.id}>{processPath(model, p.id).map((x) => x.name).join(" › ")}</option>)}
                  </select></div>
                <div><label className="label" htmlFor="sd">Description</label><textarea id="sd" className="input" rows={3} value={step.description} onChange={(e) => editStep({ description: e.target.value })} /></div>

                <div>
                  <label className="label">Roles (RACI)</label>
                  {step.roles.map((r, i) => (
                    <div key={i} className="mb-1 flex gap-2">
                      <input className="input" list="roles" value={r.role} onChange={(e) => editStep({ roles: step.roles.map((x, j) => (j === i ? { ...x, role: e.target.value } : x)) })} aria-label="Role" />
                      <select className="input !w-20" value={r.raci} onChange={(e) => editStep({ roles: step.roles.map((x, j) => (j === i ? { ...x, raci: e.target.value as "R" } : x)) })} aria-label="RACI">{["R", "A", "C", "I"].map((c) => <option key={c}>{c}</option>)}</select>
                      <button className="btn btn-danger" aria-label="Remove role" onClick={() => editStep({ roles: step.roles.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
                    </div>
                  ))}
                  <datalist id="roles">{model.roles.map((r) => <option key={r.id} value={r.name} />)}</datalist>
                  <button className="btn" onClick={() => editStep({ roles: [...step.roles, { role: "", raci: "R" }] })}><Plus size={13} /> Role</button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <LineField label="Systems" value={step.systems} onChange={(v) => editStep({ systems: v })} />
                  <LineField label="Inputs" value={step.inputs} onChange={(v) => editStep({ inputs: v })} />
                  <LineField label="Outputs" value={step.outputs} onChange={(v) => editStep({ outputs: v })} />
                  <LineField label="Business rules" value={step.rules} onChange={(v) => editStep({ rules: v })} />
                  <LineField label="Controls" value={step.controls} onChange={(v) => editStep({ controls: v })} />
                  <LineField label="Pain points" value={step.painPoints} onChange={(v) => editStep({ painPoints: v })} />
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div><label className="label" htmlFor="ssla">SLA / KPI</label><input id="ssla" className="input" value={step.sla} onChange={(e) => editStep({ sla: e.target.value })} /></div>
                  <div><label className="label" htmlFor="sat">Automation</label><select id="sat" className="input" value={step.automationTag} onChange={(e) => editStep({ automationTag: e.target.value as Step["automationTag"] })}>{AUTOMATION_TAGS.map((t) => <option key={t}>{t}</option>)}</select></div>
                  <div><label className="label" htmlFor="sc">Confidence ({Math.round(step.confidence * 100)}%)</label><input id="sc" type="range" min={0} max={1} step={0.05} value={step.confidence} onChange={(e) => editStep({ confidence: Number(e.target.value) })} className="w-full" /></div>
                </div>
                {step.automationTag !== "none" && <div><label className="label" htmlFor="sar">Automation rationale</label><input id="sar" className="input" value={step.automationRationale} onChange={(e) => editStep({ automationRationale: e.target.value })} /></div>}
                <div><label className="label" htmlFor="ssr">Source reference</label><input id="ssr" className="input" value={step.sourceRef} onChange={(e) => editStep({ sourceRef: e.target.value })} /></div>

                <div className="card p-3">
                  <h3 className="label">Outgoing links</h3>
                  {model.links.filter((l) => l.from === step.id).map((l) => (
                    <div key={l.id} className="mb-1 flex flex-wrap gap-2">
                      <select className="input !w-56" aria-label="Target step" value={l.to} onChange={(e) => patchLink(l.id, { to: e.target.value })}>{model.steps.filter((s) => s.id !== step.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
                      <select className="input !w-32" aria-label="Link type" value={l.type} onChange={(e) => patchLink(l.id, { type: e.target.value as L["type"] })}>{LINK_TYPES.map((t) => <option key={t}>{t}</option>)}</select>
                      <input className="input !w-36" placeholder="Condition" value={l.condition} onChange={(e) => patchLink(l.id, { condition: e.target.value })} aria-label="Condition" />
                      <button className="btn btn-danger" aria-label="Delete link" onClick={() => edit((m) => { m.links = m.links.filter((x) => x.id !== l.id); })}><Trash2 size={13} /></button>
                    </div>
                  ))}
                  <button className="btn" onClick={() => { const t = model.steps.find((s) => s.id !== step.id); if (t) edit((m) => { m.links.push({ id: uid("l"), from: step.id, to: t.id, type: "sequence", condition: "" }); }); }}><Plus size={13} /> Link</button>
                </div>

                <div className="flex items-center gap-2">
                  <Merge size={14} aria-hidden />
                  <select className="input !w-64" aria-label="Merge another step into this one" value="" onChange={(e) => { if (e.target.value && confirm("Merge the selected step into this one?")) merge(e.target.value); }}>
                    <option value="">Merge another step into this one…</option>
                    {model.steps.filter((s) => s.id !== step.id).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
              </div>
            ) : <p className="text-muted">Select a step.</p>}
          </section>

          <section className="min-h-0 overflow-y-auto border-l border-line bg-panel p-4" aria-label="Source excerpt">
            <h2 className="label">Source document</h2>
            {step?.sourceRef ? <p className="mb-2 text-sm font-medium">{step.sourceRef}</p> : <p className="text-sm text-muted">No source reference on this step.</p>}
            {source?.sections.map((s) => (
              <article key={s.ref} className="mb-3">
                <h3 className="text-xs font-semibold text-muted">{s.doc} · {s.ref}</h3>
                <pre className="mt-1 whitespace-pre-wrap rounded-md bg-slate-50 p-2 font-sans text-xs leading-relaxed">{s.text}</pre>
              </article>
            ))}
            {source && source.sections.length === 0 && step?.sourceRef && <p className="text-sm text-muted">Could not locate this reference in the uploaded document(s).</p>}
          </section>
        </div>
      )}
    </div>
  );
}

function ProcessEditor({ model, edit }: { model: ProcessModel; edit: (fn: (m: ProcessModel) => void) => void }) {
  const [sel, setSel] = useState<string | null>(model.processes[0]?.id ?? null);
  const p = model.processes.find((x) => x.id === sel);
  const patch = (v: Partial<Process>) => edit((m) => { Object.assign(m.processes.find((x) => x.id === sel)!, v); });
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <ul className="max-h-56 overflow-auto border-b border-line">
        {model.processes.map((x) => (
          <li key={x.id}><button onClick={() => setSel(x.id)} className={`w-full px-3 py-1.5 text-left text-sm ${sel === x.id ? "bg-blue-50" : "hover:bg-slate-50"}`} style={{ paddingLeft: 12 + LEVELS.indexOf(x.level) * 12 }}><span className="text-xs text-muted">{x.level}</span> {x.name}</button></li>
        ))}
      </ul>
      <div className="flex gap-2 p-2">
        <button className="btn" onClick={() => edit((m) => { const id = uid("p"); m.processes.push({ id, name: "New process", level: "L2", parentId: m.processes.find((q) => q.level === "L1")?.id ?? m.processes[0].id, owner: "", objective: "", scope: "", kpis: [] }); setSel(id); })}><Plus size={13} /> Process</button>
        {p && p.level !== "L0" && <button className="btn btn-danger" onClick={() => confirm("Delete this process? Its steps move to its parent.") && edit((m) => {
          const gone = m.processes.find((x) => x.id === p.id)!;
          m.steps.forEach((s) => { if (s.processId === gone.id) s.processId = gone.parentId!; });
          m.processes.forEach((x) => { if (x.parentId === gone.id) x.parentId = gone.parentId; });
          m.processes = m.processes.filter((x) => x.id !== gone.id); setSel(gone.parentId);
        })}><Trash2 size={13} /></button>}
      </div>
      {p && (
        <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
          <div><label className="label" htmlFor="pn">Name</label><input id="pn" className="input" value={p.name} onChange={(e) => patch({ name: e.target.value })} /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><label className="label" htmlFor="pl">Level</label><select id="pl" className="input" value={p.level} onChange={(e) => patch({ level: e.target.value as Process["level"] })}>{LEVELS.map((l) => <option key={l}>{l}</option>)}</select></div>
            <div><label className="label" htmlFor="pp">Parent</label><select id="pp" className="input" value={p.parentId ?? ""} disabled={p.level === "L0"} onChange={(e) => patch({ parentId: e.target.value || null })}>{model.processes.filter((x) => x.id !== p.id).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select></div>
          </div>
          <div><label className="label" htmlFor="po">Owner</label><input id="po" className="input" value={p.owner} onChange={(e) => patch({ owner: e.target.value })} /></div>
          <div><label className="label" htmlFor="pob">Objective</label><textarea id="pob" className="input" rows={2} value={p.objective} onChange={(e) => patch({ objective: e.target.value })} /></div>
          <LineField label="KPIs" value={p.kpis} onChange={(v) => patch({ kpis: v })} />
        </div>
      )}
    </div>
  );
}
