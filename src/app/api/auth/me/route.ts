import { NextResponse } from "next/server";
import { count } from "drizzle-orm";
import { currentUser } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { users } from "@/lib/schema";
import { aiConfigured } from "@/lib/extract";
import { blobEnabled } from "@/lib/storage";

export async function GET() {
  const user = await currentUser();
  const db = await getDb();
  const [{ n }] = await db.select({ n: count() }).from(users);
  return NextResponse.json({
    user,
    firstUser: n === 0,
    signupOpen: n === 0 || process.env.ALLOW_SIGNUP === "true",
    ai: aiConfigured(),
    blob: blobEnabled(),
  });
}
