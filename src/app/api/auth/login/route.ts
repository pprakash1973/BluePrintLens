import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { signSession, setSessionCookie, verifyPw, type Role } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const { email, password } = await req.json();
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.email, String(email ?? "").toLowerCase().trim()));
  if (!u || !(await verifyPw(String(password ?? ""), u.passwordHash))) {
    return NextResponse.json({ error: "Invalid email or password" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  setSessionCookie(res, await signSession({ id: u.id, email: u.email, name: u.name, role: u.role as Role }));
  return res;
}
