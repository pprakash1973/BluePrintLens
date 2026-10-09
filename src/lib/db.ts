import * as schema from "./schema";
import { sql } from "drizzle-orm";
import type { NeonHttpDatabase } from "drizzle-orm/neon-http";

export type DB = NeonHttpDatabase<typeof schema>;

const DDL = [
  `CREATE TABLE IF NOT EXISTS users (
    id text PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
    password_hash text NOT NULL, role text NOT NULL DEFAULT 'viewer', created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS blueprints (
    id text PRIMARY KEY, name text NOT NULL, description text NOT NULL DEFAULT '',
    created_by text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS documents (
    id text PRIMARY KEY, blueprint_id text NOT NULL, filename text NOT NULL, mime text NOT NULL,
    storage_key text NOT NULL, size_bytes integer NOT NULL DEFAULT 0, page_count integer NOT NULL DEFAULT 0,
    content jsonb NOT NULL DEFAULT '[]', created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS jobs (
    id text PRIMARY KEY, blueprint_id text NOT NULL, document_id text NOT NULL,
    status text NOT NULL DEFAULT 'pending', chunks jsonb NOT NULL DEFAULT '[]', next_chunk integer NOT NULL DEFAULT 0,
    partial jsonb NOT NULL, log jsonb NOT NULL DEFAULT '[]', error text, mode text NOT NULL DEFAULT 'ai',
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE TABLE IF NOT EXISTS versions (
    id text PRIMARY KEY, blueprint_id text NOT NULL, version_no integer NOT NULL DEFAULT 0,
    status text NOT NULL, model jsonb NOT NULL, change_summary text NOT NULL DEFAULT '',
    published_by text, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS versions_bp ON versions (blueprint_id)`,
  `CREATE TABLE IF NOT EXISTS comments (
    id text PRIMARY KEY, blueprint_id text NOT NULL, step_id text NOT NULL, user_id text NOT NULL,
    user_name text NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS comments_bp ON comments (blueprint_id, step_id)`,
  `CREATE TABLE IF NOT EXISTS approvals (
    id text PRIMARY KEY, blueprint_id text NOT NULL, step_id text NOT NULL, user_id text NOT NULL,
    user_name text NOT NULL, status text NOT NULL, note text NOT NULL DEFAULT '', created_at timestamptz NOT NULL DEFAULT now())`,
  `CREATE INDEX IF NOT EXISTS approvals_bp ON approvals (blueprint_id, step_id)`,
];

const g = globalThis as unknown as { __bl_db?: Promise<DB> };

async function create(): Promise<DB> {
  if (process.env.DATABASE_URL) {
    const { neon } = await import("@neondatabase/serverless");
    const { drizzle } = await import("drizzle-orm/neon-http");
    const db = drizzle(neon(process.env.DATABASE_URL), { schema }) as DB;
    for (const stmt of DDL) await db.execute(sql.raw(stmt));
    return db;
  }
  // Zero-install local Postgres (WASM), persisted on disk.
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const dir = process.env.PGLITE_DIR ?? ".data/pglite";
  (await import("node:fs")).mkdirSync(dir, { recursive: true });
  const client = new PGlite(dir);
  for (const stmt of DDL) await client.exec(stmt);
  return drizzle(client, { schema }) as unknown as DB;
}

export function getDb(): Promise<DB> {
  if (!g.__bl_db) g.__bl_db = create().catch((e) => { g.__bl_db = undefined; throw e; });
  return g.__bl_db;
}
