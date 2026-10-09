import { pgTable, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import type { ProcessModel } from "./model";

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("viewer"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const blueprints = pgTable("blueprints", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type DocSection = { ref: string; title: string; text: string };
export const documents = pgTable("documents", {
  id: text("id").primaryKey(),
  blueprintId: text("blueprint_id").notNull(),
  filename: text("filename").notNull(),
  mime: text("mime").notNull(),
  storageKey: text("storage_key").notNull(),
  sizeBytes: integer("size_bytes").notNull().default(0),
  pageCount: integer("page_count").notNull().default(0),
  content: jsonb("content").$type<DocSection[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Chunk = { label: string; kind: "pdf" | "text"; pages?: [number, number]; text?: string; imageKeys?: string[] };
export const jobs = pgTable("jobs", {
  id: text("id").primaryKey(),
  blueprintId: text("blueprint_id").notNull(),
  documentId: text("document_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | running | done | error
  chunks: jsonb("chunks").$type<Chunk[]>().notNull().default([]),
  nextChunk: integer("next_chunk").notNull().default(0),
  partial: jsonb("partial").$type<ProcessModel>().notNull(),
  log: jsonb("log").$type<string[]>().notNull().default([]),
  error: text("error"),
  mode: text("mode").notNull().default("ai"), // ai | offline
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const versions = pgTable("versions", {
  id: text("id").primaryKey(),
  blueprintId: text("blueprint_id").notNull(),
  versionNo: integer("version_no").notNull().default(0),
  status: text("status").notNull(), // draft | published
  model: jsonb("model").$type<ProcessModel>().notNull(),
  changeSummary: text("change_summary").notNull().default(""),
  publishedBy: text("published_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const comments = pgTable("comments", {
  id: text("id").primaryKey(),
  blueprintId: text("blueprint_id").notNull(),
  stepId: text("step_id").notNull(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  body: text("body").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const approvals = pgTable("approvals", {
  id: text("id").primaryKey(),
  blueprintId: text("blueprint_id").notNull(),
  stepId: text("step_id").notNull(),
  userId: text("user_id").notNull(),
  userName: text("user_name").notNull(),
  status: text("status").notNull(), // approved | changes_requested
  note: text("note").notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const evidence = pgTable("evidence", {
  id: text("id").primaryKey(),
  blueprintId: text("blueprint_id").notNull(),
  stats: jsonb("stats").$type<import("./evidence").EvidenceStats>().notNull(),
  uploadedBy: text("uploaded_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
