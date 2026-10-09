"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, useMe } from "@/lib/client";
import { Header } from "@/components/Header";

type BP = { id: string; name: string; description: string; createdAt: string; latestVersion: number | null; hasDraft: boolean };

export default function Dashboard() {
  const me = useMe();
  const router = useRouter();
  const [list, setList] = useState<BP[] | null>(null);
  const [name, setName] = useState("");
  const [sample, setSample] = useState(false);
  const [error, setError] = useState("");
  const isAuthor = me?.user?.role === "author";

  const load = () => api<{ blueprints: BP[] }>("/api/blueprints").then((r) => setList(r.blueprints)).catch((e) => setError(e.message));
  useEffect(() => { load(); }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const { id } = await api<{ id: string }>("/api/blueprints", { method: "POST", json: { name, sample } });
      router.push(`/b/${id}/author`);
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); }
  }

  return (
    <>
      <Header me={me} />
      <main className="mx-auto max-w-5xl px-5 py-8">
        <h1 className="text-2xl font-semibold">Process blueprints</h1>
        <p className="mb-6 text-sm text-muted">Upload a blueprint document and explore it as an interactive process model.</p>

        {isAuthor && (
          <form onSubmit={create} className="card mb-8 flex flex-wrap items-end gap-3 p-4">
            <div className="min-w-60 flex-1">
              <label className="label" htmlFor="bpname">New blueprint name</label>
              <input id="bpname" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Order to Cash — Blueprint v2" required />
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm"><input type="checkbox" checked={sample} onChange={(e) => setSample(e.target.checked)} /> Start from sample (Order to Cash)</label>
            <button className="btn btn-primary">Create &amp; upload document</button>
          </form>
        )}
        {error && <p role="alert" className="mb-4 text-sm text-pain">{error}</p>}

        {list === null ? <p className="text-muted">Loading…</p> : list.length === 0 ? (
          <p className="card p-6 text-muted">{isAuthor ? "No blueprints yet. Create one above." : "No blueprints have been published yet."}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {list.map((b) => (
              <li key={b.id} className="card p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-semibold">{b.name}</h2>
                  <span className="chip">{b.latestVersion ? `v${b.latestVersion}` : "unpublished"}</span>
                </div>
                <p className="mt-1 text-xs text-muted">Created {new Date(b.createdAt).toLocaleDateString()}{b.hasDraft && isAuthor ? " · draft in progress" : ""}</p>
                <div className="mt-3 flex gap-2">
                  {b.latestVersion && <Link className="btn btn-primary" href={`/b/${b.id}`}>Open viewer</Link>}
                  {isAuthor && <Link className="btn" href={`/b/${b.id}/author`}>Author</Link>}
                  {isAuthor && (
                    <button className="btn btn-danger ml-auto" onClick={async () => { if (confirm(`Delete “${b.name}” and all its versions?`)) { await api(`/api/blueprints/${b.id}`, { method: "DELETE" }); load(); } }}>Delete</button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
