"use client";
import { useRef, useState } from "react";
import { upload } from "@vercel/blob/client";
import { Upload } from "lucide-react";
import { api } from "@/lib/client";

type JobView = { id: string; status: string; done: number; total: number; error: string | null; log: string[]; mode: string; counts: { processes: number; steps: number; links: number } };

/** Upload a DOCX/PDF, then drive chunked extraction one request at a time (stays within serverless time limits). */
export function UploadPanel({ blueprintId, blob, ai, hasDraft, onDone }: { blueprintId: string; blob: boolean; ai: boolean; hasDraft: boolean; onDone: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [append, setAppend] = useState(false);
  const [phase, setPhase] = useState<"idle" | "uploading" | "extracting" | "done" | "error">("idle");
  const [job, setJob] = useState<JobView | null>(null);
  const [err, setErr] = useState("");

  async function run(file: File) {
    setErr(""); setJob(null); setPhase("uploading");
    try {
      let start: { jobId: string };
      if (blob) {
        const b = await upload(`docs/${blueprintId}/${file.name}`, file, {
          access: "private", handleUploadUrl: `/api/blueprints/${blueprintId}/upload`, multipart: file.size > 20 * 1024 * 1024,
        });
        start = await api(`/api/blueprints/${blueprintId}/upload`, { method: "POST", json: { pathname: b.pathname, filename: file.name, append } });
      } else {
        const fd = new FormData();
        fd.append("file", file); fd.append("append", String(append));
        start = await api(`/api/blueprints/${blueprintId}/upload`, { method: "POST", body: fd });
      }
      setPhase("extracting");
      let j = await api<JobView>(`/api/jobs/${start.jobId}`);
      setJob(j);
      while (j.status !== "done") {
        j = await api<JobView>(`/api/jobs/${start.jobId}`, { method: "POST" });
        setJob(j);
      }
      setPhase("done");
      onDone();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed"); setPhase("error");
    }
  }

  const pct = job ? Math.round((job.done / Math.max(1, job.total)) * 100) : 0;
  return (
    <section className="card p-4">
      <div className="flex flex-wrap items-center gap-3">
        <input ref={input} type="file" accept=".docx,.pdf" className="hidden" aria-label="Choose blueprint document"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) run(f); e.target.value = ""; }} />
        <button className="btn btn-primary" disabled={phase === "uploading" || phase === "extracting"} onClick={() => input.current?.click()}><Upload size={14} /> Upload DOCX / PDF</button>
        {hasDraft && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={append} onChange={(e) => setAppend(e.target.checked)} /> Add to current draft (multi-document landscape)</label>}
        {!ai && <span className="chip text-warn" title="Set ANTHROPIC_API_KEY for real AI extraction">Offline mode: heuristic extraction only (no AI key)</span>}
        <span className="text-xs text-muted">Up to 50 MB. Existing draft is replaced unless “add to current draft” is ticked.</span>
      </div>
      {phase === "uploading" && <p className="mt-3 text-sm text-muted">Uploading and parsing…</p>}
      {job && phase !== "idle" && (
        <div className="mt-3">
          <div className="h-2 overflow-hidden rounded bg-slate-200" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} /></div>
          <p className="mt-1 text-xs text-muted">Extracting chunk {Math.min(job.done + (phase === "done" ? 0 : 1), job.total)} of {job.total} · {job.counts.processes} processes, {job.counts.steps} steps, {job.counts.links} links so far</p>
          <ul className="mt-1 text-xs text-muted">{job.log.slice(-3).map((l, i) => <li key={i}>{l}</li>)}</ul>
        </div>
      )}
      {phase === "done" && <p className="mt-2 text-sm text-control">Extraction complete. Review the draft below, then publish.</p>}
      {err && <p role="alert" className="mt-2 text-sm text-pain">{err}</p>}
    </section>
  );
}
