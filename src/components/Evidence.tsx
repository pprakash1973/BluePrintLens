"use client";
import { useRef, useState } from "react";
import { Upload, Download, Trash2, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { api } from "@/lib/client";
import type { ProcessModel } from "@/lib/model";
import { autoMatch, computeEvidence, fmtHrs, guessColumns, parseCsv, EVENT_LOG_TEMPLATE, type ColumnMap, type EvidenceStats } from "@/lib/evidence";

type Draft = { filename: string; rows: string[][]; header: string[]; cols: ColumnMap; mapping: Record<string, string | null>; activities: { name: string; count: number }[] };

function Kpi({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return <div className="rounded-lg border border-line bg-white px-3 py-2"><div className={`text-lg font-semibold ${tone ?? ""}`}>{value}</div><div className="text-[11px] text-muted">{label}</div></div>;
}

/** Evidence overlay controls: upload an event log (processed in the browser), map activities to steps, and read the headline metrics. */
export function EvidencePanel({ id, model, evidence, canUpload, onChange, onHighlight, onSelect }: {
  id: string; model: ProcessModel; evidence: EvidenceStats | null; canUpload: boolean;
  onChange: () => void; onHighlight: (ids: string[] | null) => void; onSelect: (stepId: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(true);
  const name = (sid: string) => model.steps.find((s) => s.id === sid)?.name ?? sid;

  async function load(file: File) {
    setErr("");
    const rows = parseCsv(await file.text());
    if (rows.length < 2) { setErr("The file has no data rows."); return; }
    const header = rows[0];
    const cols = guessColumns(header);
    prepare({ filename: file.name, rows: rows.slice(1), header, cols, mapping: {}, activities: [] });
  }
  function prepare(d: Draft) {
    const counts = new Map<string, number>();
    d.rows.forEach((r) => { const a = r[d.cols.activity]?.trim(); if (a) counts.set(a, (counts.get(a) ?? 0) + 1); });
    const activities = [...counts.entries()].map(([n, c]) => ({ name: n, count: c })).sort((a, b) => b.count - a.count);
    setDraft({ ...d, activities, mapping: autoMatch(activities.map((a) => a.name), model) });
  }
  async function save() {
    if (!draft) return;
    setBusy(true); setErr("");
    try {
      const stats = computeEvidence(draft.rows, draft.cols, draft.mapping, model, draft.filename);
      if (!stats.cases) throw new Error("No valid events found — check the column mapping and timestamp format.");
      await api(`/api/blueprints/${id}/evidence`, { method: "POST", json: stats });
      setDraft(null); onChange();
    } catch (e) { setErr(e instanceof Error ? e.message : "Failed"); } finally { setBusy(false); }
  }

  const uploader = canUpload && (
    <>
      <input ref={input} type="file" accept=".csv,text/csv" className="hidden" aria-label="Choose event log CSV" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ""; }} />
      <button className="btn btn-primary" onClick={() => input.current?.click()}><Upload size={14} /> {evidence ? "Replace event log" : "Upload event log (CSV)"}</button>
    </>
  );
  const template = (
    <a className="btn" download="event_log_template.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(EVENT_LOG_TEMPLATE)}`}><Download size={14} /> Template</a>
  );

  if (draft) {
    const mapped = draft.activities.filter((a) => draft.mapping[a.name]).length;
    return (
      <section className="no-print max-h-[55%] overflow-auto border-b border-line bg-white p-4 text-sm">
        <h3 className="mb-1 font-semibold">Map the event log — {draft.filename}</h3>
        <p className="mb-3 text-xs text-muted">{draft.rows.length.toLocaleString()} events. The file is processed in your browser; only aggregated statistics are saved.</p>
        <div className="mb-3 flex flex-wrap gap-3">
          {(["caseId", "activity", "timestamp"] as const).map((k) => (
            <label key={k} className="text-xs"><span className="label">{k === "caseId" ? "Case ID column" : k === "activity" ? "Activity column" : "Timestamp column"}</span>
              <select className="input !w-48" value={draft.cols[k]} onChange={(e) => prepare({ ...draft, cols: { ...draft.cols, [k]: Number(e.target.value) } })}>
                {draft.header.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
              </select></label>
          ))}
        </div>
        <p className="mb-2 text-xs"><b>{mapped}</b> of {draft.activities.length} activities matched to steps. Unmatched activities are reported as deviations-in-waiting; map them if they correspond to a step.</p>
        <table className="mb-3 w-full text-xs">
          <thead><tr className="text-left text-muted"><th className="py-1">Activity in log</th><th>Events</th><th>Model step</th></tr></thead>
          <tbody>
            {draft.activities.slice(0, 80).map((a) => (
              <tr key={a.name} className="border-t border-line">
                <td className="py-1 pr-2">{a.name}</td><td className="pr-2">{a.count}</td>
                <td><select className={`input !py-1 ${draft.mapping[a.name] ? "" : "!border-warn"}`} value={draft.mapping[a.name] ?? ""} aria-label={`Step for ${a.name}`}
                  onChange={(e) => setDraft({ ...draft, mapping: { ...draft.mapping, [a.name]: e.target.value || null } })}>
                  <option value="">— not in model —</option>{model.steps.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select></td>
              </tr>
            ))}
          </tbody>
        </table>
        {err && <p role="alert" className="mb-2 text-pain">{err}</p>}
        <div className="flex gap-2">
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? <Loader2 size={14} className="animate-spin" /> : null} Compute &amp; save evidence</button>
          <button className="btn" onClick={() => setDraft(null)}>Cancel</button>
        </div>
      </section>
    );
  }

  if (!evidence) {
    return (
      <section className="no-print border-b border-line bg-white p-4 text-sm">
        <h3 className="font-semibold">No evidence yet</h3>
        <p className="mb-3 max-w-3xl text-muted">
          Upload an event log exported from your ERP, ticketing or workflow system — one row per event with a <b>case ID</b> (e.g. order number), an <b>activity</b> name and a <b>timestamp</b>.
          BlueprintLens overlays the actual paths, volumes, waiting times, rework and deviations on the blueprint.
        </p>
        <div className="flex flex-wrap gap-2">{uploader}{template}</div>
        {!canUpload && <p className="mt-2 text-xs text-muted">Ask an author to upload an event log.</p>}
        {err && <p role="alert" className="mt-2 text-pain">{err}</p>}
      </section>
    );
  }

  const bottlenecks = Object.entries(evidence.steps).sort((a, b) => b[1].medianWaitHrs - a[1].medianWaitHrs).slice(0, 5);
  const reworkSteps = Object.entries(evidence.steps).filter(([, v]) => v.reworkCases > 0).sort((a, b) => b[1].reworkCases - a[1].reworkCases).slice(0, 5);
  return (
    <section className="no-print border-b border-line bg-[#f8fafc] text-sm">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2">
        <b>Evidence:</b><span className="text-muted">{evidence.filename} · {evidence.cases.toLocaleString()} cases · {evidence.from.slice(0, 10)} → {evidence.to.slice(0, 10)}</span>
        <span className="ml-auto flex gap-2">
          {uploader}
          {canUpload && <button className="btn btn-danger" onClick={async () => { if (confirm("Remove the evidence overlay?")) { await api(`/api/blueprints/${id}/evidence`, { method: "DELETE" }); onChange(); } }}><Trash2 size={14} /></button>}
          <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? <ChevronUp size={14} /> : <ChevronDown size={14} />} Metrics</button>
        </span>
      </div>
      {open && (
        <div className="grid gap-3 px-4 pb-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="grid grid-cols-3 gap-2 self-start">
            <Kpi label="Median cycle time" value={fmtHrs(evidence.cycle.medianHrs)} />
            <Kpi label="90th percentile" value={fmtHrs(evidence.cycle.p90Hrs)} tone="text-warn" />
            <Kpi label="Cases" value={evidence.cases.toLocaleString()} />
            <Kpi label="Follow the model" value={`${Math.round(evidence.conformance * 100)}%`} tone={evidence.conformance < 0.7 ? "text-pain" : "text-control"} />
            <Kpi label="Cases with rework" value={`${Math.round(evidence.reworkRate * 100)}%`} tone={evidence.reworkRate > 0.15 ? "text-pain" : ""} />
            <Kpi label="Deviating transitions" value={String(evidence.deviations.length)} tone={evidence.deviations.length ? "text-[#9333ea]" : ""} />
          </div>
          <div>
            <h4 className="label">Top bottlenecks (median wait)</h4>
            <ol className="space-y-0.5">
              {bottlenecks.map(([sid, v]) => <li key={sid}><button className="text-left hover:text-brand" onClick={() => onSelect(sid)}><b className="text-pain">{fmtHrs(v.medianWaitHrs)}</b> · {name(sid)}</button></li>)}
            </ol>
            {reworkSteps.length > 0 && <>
              <h4 className="label mt-2">Rework</h4>
              <ul className="space-y-0.5">{reworkSteps.map(([sid, v]) => <li key={sid}><button className="text-left hover:text-brand" onClick={() => onSelect(sid)}>↻ {Math.round((v.reworkCases / v.cases) * 100)}% · {name(sid)}</button></li>)}</ul>
            </>}
          </div>
          <div>
            <h4 className="label">Most common paths (variants)</h4>
            <ol className="space-y-1">
              {evidence.variants.slice(0, 5).map((v, i) => {
                const base = new Set(evidence.variants[0].path);
                const extra = v.path.filter((x) => !base.has(x));
                const missing = evidence.variants[0].path.filter((x) => !v.path.includes(x));
                const repeats = v.path.length - new Set(v.path).size;
                const how = i === 0 ? "most common path" : extra.length ? `via ${name(extra[0])}${extra.length > 1 ? ` +${extra.length - 1}` : ""}` : missing.length ? `skips ${name(missing[0])}` : repeats ? `repeats ${repeats} step(s)` : "different order";
                return (
                  <li key={i}><button className="w-full text-left hover:text-brand" onClick={() => onHighlight(v.path)} title={v.path.map(name).join(" → ")}>
                    <b>{Math.round((v.count / evidence.cases) * 100)}%</b> · {v.path.length} steps — <span className="text-muted">{how}</span>
                  </button></li>
                );
              })}
            </ol>
            {evidence.unmatched.length > 0 && <p className="mt-2 text-xs text-warn">{evidence.unmatched.length} activities in the log are not in the blueprint (e.g. “{evidence.unmatched[0].activity}”).</p>}
            {evidence.notObserved.length > 0 && <p className="text-xs text-muted">{evidence.notObserved.length} documented steps never appear in the log.</p>}
          </div>
        </div>
      )}
    </section>
  );
}
