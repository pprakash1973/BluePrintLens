"use client";
import { useCallback, useEffect, useState } from "react";
import { X, Link2, Check, AlertTriangle } from "lucide-react";
import { api } from "@/lib/client";
import { LOW_CONFIDENCE, processPath, type ProcessModel, type Step } from "@/lib/model";
import type { SessionUser } from "@/lib/auth";

type Thread = {
  comments: { id: string; userName: string; body: string; createdAt: string }[];
  approvals: { id: string; userName: string; status: string; note: string; createdAt: string }[];
};

function List({ title, items, tone }: { title: string; items: string[]; tone?: string }) {
  if (!items.length) return null;
  return (
    <section className="mb-3">
      <h4 className="label">{title}</h4>
      <ul className={`list-disc pl-5 text-sm ${tone ?? ""}`}>{items.map((x, i) => <li key={i}>{x}</li>)}</ul>
    </section>
  );
}

export function StepDetail(p: {
  step: Step; model: ProcessModel; blueprintId: string; user: SessionUser | null; canCollab: boolean;
  onClose: () => void; onSelect: (id: string) => void; onChanged?: () => void; deepLink: string;
}) {
  const { step: s, model } = p;
  const [thread, setThread] = useState<Thread>({ comments: [], approvals: [] });
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState("");

  const load = useCallback(() => {
    api<Thread>(`/api/blueprints/${p.blueprintId}/steps/${s.id}`).then(setThread).catch(() => {});
  }, [p.blueprintId, s.id]);
  useEffect(() => { load(); }, [load]);

  const post = async (json: unknown) => {
    setErr("");
    try { await api(`/api/blueprints/${p.blueprintId}/steps/${s.id}`, { method: "POST", json }); setText(""); setNote(""); load(); p.onChanged?.(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
  };

  const name = (id: string) => model.steps.find((x) => x.id === id)?.name ?? id;
  const outs = model.links.filter((l) => l.from === s.id);
  const ins = model.links.filter((l) => l.to === s.id);
  const mine = [...thread.approvals].reverse().find((a) => a.userName === p.user?.name);

  return (
    <aside className="flex h-full w-full flex-col overflow-y-auto border-l border-line bg-panel p-4" aria-label="Step details">
      <div className="mb-2 flex items-start justify-between gap-2">
        <div>
          <p className="text-xs text-muted">{processPath(model, s.processId).slice(1).map((x) => x.name).join(" › ")}</p>
          <h3 className="text-lg font-semibold leading-tight">{s.name}</h3>
          <div className="mt-1 flex flex-wrap gap-1">
            <span className="chip">{s.type}</span>
            {s.automationTag !== "none" && <span className="chip text-auto">⚙ {s.automationTag}</span>}
            <span className={`chip ${s.confidence < LOW_CONFIDENCE ? "text-warn" : ""}`}>
              {s.confidence < LOW_CONFIDENCE && <AlertTriangle size={11} />} {Math.round(s.confidence * 100)}% confidence
            </span>
          </div>
        </div>
        <div className="flex gap-1">
          <button className="btn !px-2" title="Copy link to this step" aria-label="Copy link to this step"
            onClick={() => { navigator.clipboard?.writeText(p.deepLink); setCopied(true); setTimeout(() => setCopied(false), 1500); }}>
            {copied ? <Check size={14} /> : <Link2 size={14} />}
          </button>
          <button className="btn !px-2" onClick={p.onClose} aria-label="Close details"><X size={14} /></button>
        </div>
      </div>

      {s.description && <p className="mb-3 text-sm">{s.description}</p>}

      {s.roles.length > 0 && (
        <section className="mb-3">
          <h4 className="label">Roles (RACI)</h4>
          <div className="flex flex-wrap gap-1">{s.roles.map((r, i) => <span key={i} className="chip"><b>{r.raci}</b> {r.role}</span>)}</div>
        </section>
      )}
      {s.systems.length > 0 && (
        <section className="mb-3">
          <h4 className="label">Systems</h4>
          <div className="flex flex-wrap gap-1">{s.systems.map((x) => <span key={x} className="chip">{x}</span>)}</div>
        </section>
      )}
      <List title="Inputs" items={s.inputs} />
      <List title="Outputs" items={s.outputs} />
      <List title="Business rules" items={s.rules} />
      {s.sla && <section className="mb-3"><h4 className="label">SLA / KPI</h4><p className="text-sm">{s.sla}</p></section>}
      <List title="Controls" items={s.controls} tone="text-control" />
      <List title="Pain points" items={s.painPoints} tone="text-pain" />
      {s.automationTag !== "none" && <section className="mb-3"><h4 className="label">Automation opportunity</h4><p className="text-sm">{s.automationTag}: {s.automationRationale || "No rationale recorded."}</p></section>}

      {(ins.length > 0 || outs.length > 0) && (
        <section className="mb-3">
          <h4 className="label">Flow</h4>
          <ul className="space-y-1 text-sm">
            {ins.map((l) => <li key={l.id}>← <button className="text-brand hover:underline" onClick={() => p.onSelect(l.from)}>{name(l.from)}</button> <span className="text-muted">({l.type})</span></li>)}
            {outs.map((l) => <li key={l.id}>→ <button className="text-brand hover:underline" onClick={() => p.onSelect(l.to)}>{name(l.to)}</button> <span className="text-muted">({l.type}{l.condition ? `: ${l.condition}` : ""})</span></li>)}
          </ul>
        </section>
      )}
      {s.sourceRef && <p className="mb-4 text-xs text-muted">Source: {s.sourceRef}</p>}

      <section className="mt-auto border-t border-line pt-3">
        <h4 className="label">Review &amp; sign-off</h4>
        {thread.approvals.length > 0 && (
          <ul className="mb-2 space-y-1 text-xs">
            {thread.approvals.map((a) => (
              <li key={a.id} className={a.status === "approved" ? "text-control" : "text-warn"}>
                {a.status === "approved" ? "✓ Approved" : "✎ Changes requested"} by {a.userName} · {new Date(a.createdAt).toLocaleDateString()}{a.note ? ` — ${a.note}` : ""}
              </li>
            ))}
          </ul>
        )}
        {thread.comments.map((c) => (
          <div key={c.id} className="mb-2 rounded-md bg-slate-50 p-2 text-sm">
            <div className="text-xs text-muted">{c.userName} · {new Date(c.createdAt).toLocaleString()}</div>
            {c.body}
          </div>
        ))}
        {p.canCollab ? (
          <>
            <textarea className="input mb-2" rows={2} placeholder="Add a comment (use @name to mention)" value={text} onChange={(e) => setText(e.target.value)} aria-label="Comment" />
            <div className="mb-2 flex flex-wrap gap-2">
              <button className="btn" disabled={!text.trim()} onClick={() => post({ comment: text })}>Comment</button>
              <input className="input !w-40" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Approval note" />
              <button className={`btn ${mine?.status === "approved" ? "btn-primary" : ""}`} onClick={() => post({ approval: "approved", note })}>✓ Approve</button>
              <button className="btn" onClick={() => post({ approval: "changes_requested", note })}>Request changes</button>
            </div>
          </>
        ) : <p className="text-xs text-muted">Reviewers and authors can comment and approve.</p>}
        {err && <p role="alert" className="text-xs text-pain">{err}</p>}
      </section>
    </aside>
  );
}
