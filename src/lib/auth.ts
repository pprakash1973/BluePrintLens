import { SignJWT, jwtVerify } from "jose";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { users } from "./schema";

export type Role = "author" | "reviewer" | "viewer";
export type SessionUser = { id: string; email: string; name: string; role: Role };

export const COOKIE = "bl_session";
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "dev-only-secret-change-me-please-32chars");

export const hash = (pw: string) => bcrypt.hash(pw, 10);
export const verifyPw = (pw: string, h: string) => bcrypt.compare(pw, h);

export async function signSession(u: SessionUser) {
  return new SignJWT({ ...u }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("7d").sign(secret());
}

export async function readToken(token?: string): Promise<SessionUser | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { id: payload.id as string, email: payload.email as string, name: payload.name as string, role: payload.role as Role };
  } catch {
    return null;
  }
}

export function setSessionCookie(res: NextResponse, token: string) {
  const prod = process.env.NODE_ENV === "production";
  res.cookies.set(COOKIE, token, {
    httpOnly: true,
    path: "/",
    maxAge: 7 * 86400,
    // SameSite=None so the viewer works inside a Teams/SharePoint iframe.
    sameSite: prod ? "none" : "lax",
    secure: prod,
  });
}

/** Current user, re-checked against the DB so role changes apply immediately. */
export async function currentUser(): Promise<SessionUser | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  const s = await readToken(t);
  if (!s) return null;
  const db = await getDb();
  const [u] = await db.select().from(users).where(eq(users.id, s.id));
  if (!u) return null;
  return { id: u.id, email: u.email, name: u.name, role: u.role as Role };
}

const rank: Record<Role, number> = { viewer: 0, reviewer: 1, author: 2 };

/** Returns the user, or a NextResponse error to return straight from the handler. */
export async function requireRole(min: Role): Promise<SessionUser | NextResponse> {
  const u = await currentUser();
  if (!u) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  if (rank[u.role] < rank[min]) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return u;
}
export const isResponse = (x: unknown): x is NextResponse => x instanceof NextResponse;
