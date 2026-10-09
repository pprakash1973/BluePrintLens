"use client";
import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, useMe } from "@/lib/client";

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const me = useMe();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const registering = mode === "register" || me?.firstUser;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError("");
    try {
      await api(registering ? "/api/auth/register" : "/api/auth/login", { method: "POST", json: { email, password, name } });
      const next = params.get("next");
      router.push(next && next.startsWith("/") && !next.startsWith("//") ? next : "/");
      router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Failed"); } finally { setBusy(false); }
  }

  return (
    <main className="mx-auto mt-24 w-full max-w-sm px-4">
      <div className="card p-6">
        <div className="mb-1 flex items-center gap-2 text-lg font-semibold"><span className="inline-block h-6 w-6 rounded-md bg-brand" aria-hidden />BlueprintLens</div>
        <p className="mb-5 text-sm text-muted">
          {me?.firstUser ? "Create the first account — it becomes the author/admin." : registering ? "Create an account" : "Sign in to explore process blueprints."}
        </p>
        <form onSubmit={submit} className="space-y-3">
          {registering && (<div><label className="label" htmlFor="name">Name</label><input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} /></div>)}
          <div><label className="label" htmlFor="email">Email</label><input id="email" type="email" required autoComplete="username" className="input" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><label className="label" htmlFor="pw">Password</label><input id="pw" type="password" required minLength={registering ? 8 : 1} autoComplete={registering ? "new-password" : "current-password"} className="input" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          {error && <p role="alert" className="text-sm text-pain">{error}</p>}
          <button className="btn btn-primary w-full justify-center" disabled={busy}>{busy ? "Please wait…" : registering ? "Create account" : "Sign in"}</button>
        </form>
        {me?.signupOpen && !me.firstUser && (
          <button className="mt-3 text-sm text-brand" onClick={() => setMode(mode === "login" ? "register" : "login")}>
            {mode === "login" ? "Need an account? Register" : "Have an account? Sign in"}
          </button>
        )}
      </div>
    </main>
  );
}

export default function Page() {
  return <Suspense><LoginForm /></Suspense>;
}
