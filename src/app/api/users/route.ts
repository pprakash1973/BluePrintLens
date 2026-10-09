import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { requireRole, isResponse, hash } from "@/lib/auth";
import { newId } from "@/lib/bp";

const ROLES = ["author", "reviewer", "viewer"];

export async function GET() {
  const u = await requireRole("author");
  if (isResponse(u)) return u;
  const db = await getDb();
  const all = await db.select({ id: users.id, email: users.email, name: users.name, role: users.role }).from(users);
  return NextResponse.json({ users: all });
}

export async function POST(req: NextRequest) {
  const a = await requireRole("author");
  if (isResponse(a)) return a;
  const { email, name, password, role } = await req.json();
  if (!ROLES.includes(role)) return NextResponse.json({ error: "Bad role" }, { status: 400 });
  if (String(password ?? "").length < 8) return NextResponse.json({ error: "Password must be at least 8 characters" }, { status: 400 });
  const db = await getDb();
  try {
    await db.insert(users).values({ id: newId("u"), email: String(email).toLowerCase().trim(), name: String(name || email), passwordHash: await hash(password), role });
  } catch {
    return NextResponse.json({ error: "Email already exists" }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: NextRequest) {
  const a = await requireRole("author");
  if (isResponse(a)) return a;
  const { id, role } = await req.json();
  if (!ROLES.includes(role)) return NextResponse.json({ error: "Bad role" }, { status: 400 });
  if (id === a.id) return NextResponse.json({ error: "You cannot change your own role" }, { status: 400 });
  const db = await getDb();
  await db.update(users).set({ role }).where(eq(users.id, id));
  return NextResponse.json({ ok: true });
}
