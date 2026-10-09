"use client";
import { useEffect, useState } from "react";
import { api, useMe } from "@/lib/client";
import { Header } from "@/components/Header";

type U = { id: string; email: string; name: string; role: string };

export default function Users() {
  const me = useMe();
  const [users, setUsers] = useState<U[]>([]);
  const [f, setF] = useState({ email: "", name: "", password: "", role: "viewer" });
  const [msg, setMsg] = useState("");
  const load = () => api<{ users: U[] }>("/api/users").then((r) => setUsers(r.users)).catch((e) => setMsg(e.message));
  useEffect(() => { load(); }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault(); setMsg("");
    try { await api("/api/users", { method: "POST", json: f }); setF({ email: "", name: "", password: "", role: "viewer" }); load(); }
    catch (err) { setMsg(err instanceof Error ? err.message : "Failed"); }
  }

  return (
    <>
      <Header me={me} />
      <main className="mx-auto max-w-3xl px-5 py-8">
        <h1 className="mb-1 text-2xl font-semibold">Users &amp; roles</h1>
        <p className="mb-6 text-sm text-muted">Author: upload, edit, publish. Reviewer: comment and approve steps. Viewer: read-only.</p>
        <form onSubmit={add} className="card mb-6 grid gap-3 p-4 sm:grid-cols-5">
          <input className="input sm:col-span-2" placeholder="Email" type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} aria-label="Email" />
          <input className="input" placeholder="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} aria-label="Name" />
          <input className="input" placeholder="Password (8+)" type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} aria-label="Password" />
          <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} aria-label="Role">
            <option>viewer</option><option>reviewer</option><option>author</option>
          </select>
          <button className="btn btn-primary sm:col-span-5 justify-center">Add user</button>
        </form>
        {msg && <p role="alert" className="mb-3 text-sm text-pain">{msg}</p>}
        <ul className="card divide-y divide-line">
          {users.map((u) => (
            <li key={u.id} className="flex items-center justify-between gap-3 p-3 text-sm">
              <div><div className="font-medium">{u.name}</div><div className="text-muted">{u.email}</div></div>
              <select className="input w-32" value={u.role} disabled={u.id === me?.user?.id} aria-label={`Role for ${u.email}`}
                onChange={async (e) => { await api("/api/users", { method: "PATCH", json: { id: u.id, role: e.target.value } }); load(); }}>
                <option>viewer</option><option>reviewer</option><option>author</option>
              </select>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
