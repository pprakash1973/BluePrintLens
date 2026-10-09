"use client";
import { useEffect, useState } from "react";
import type { SessionUser } from "./auth";

export async function api<T = unknown>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(url, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json", ...(rest.headers ?? {}) } : rest.headers,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export type Me = { user: SessionUser | null; ai: boolean; blob: boolean; signupOpen: boolean; firstUser: boolean };

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { api<Me>("/api/auth/me").then(setMe).catch(() => setMe(null)); }, []);
  return me;
}

export const roleRank = { viewer: 0, reviewer: 1, author: 2 } as const;
