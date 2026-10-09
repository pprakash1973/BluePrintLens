import { NextRequest, NextResponse } from "next/server";
import { count } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { signSession, setSessionCookie, hash, type Role } from "@/lib/auth";
import { newId } from "@/lib/bp";

export async function POST(req: NextRequest) {
  const { email, password, name } = await req.json();
  const e = String(email ?? "").toLowerCase().trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
  if (String(password ?? "").length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(users);
  // Registration is open only for the first user (becomes author) unless ALLOW_SIGNUP=true.
  if (n > 0 && process.env.ALLOW_SIGNUP !== "true") {
    return NextResponse.json({ error: "Sign-up is closed. Ask an author to create your account." }, { status: 403 });
  }
  const role: Role = n === 0 ? "author" : "viewer";
  const id = newId("u");
  try {
    await db.insert(users).values({ id, email: e, name: String(name || e.split("@")[0]), passwordHash: await hash(password), role });
  } catch {
    return NextResponse.json({ error: "That email is already registered" }, { status: 409 });
  }
  const res = NextResponse.json({ ok: true, role });
  setSessionCookie(res, await signSession({ id, email: e, name: String(name || e.split("@")[0]), role }));
  return res;
}
