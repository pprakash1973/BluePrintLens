"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Me } from "@/lib/client";

export function Header({ me }: { me: Me | null }) {
  const router = useRouter();
  const u = me?.user;
  return (
    <header className="no-print flex items-center justify-between border-b border-line bg-panel px-5 py-2.5">
      <Link href="/" className="flex items-center gap-2 font-semibold text-ink">
        <span className="inline-block h-6 w-6 rounded-md bg-brand" aria-hidden />
        BlueprintLens
      </Link>
      <nav className="flex items-center gap-3 text-sm">
        {u?.role === "author" && <Link href="/admin/users" className="text-muted hover:text-ink">Users</Link>}
        {u && <span className="text-muted">{u.name} · {u.role}</span>}
        {u && (
          <button className="btn" onClick={async () => { await api("/api/auth/logout", { method: "POST" }); router.push("/login"); router.refresh(); }}>
            Sign out
          </button>
        )}
      </nav>
    </header>
  );
}
