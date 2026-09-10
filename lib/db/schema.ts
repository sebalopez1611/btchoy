import { date, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core"

export const dailySnapshots = pgTable("daily_snapshots", {
  id: serial("id").primaryKey(),
  snapshotDate: date("snapshot_date").notNull().unique(),
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export type DailySnapshotPayload = Record<string, unknown>

export type DailySnapshot = typeof dailySnapshots.$inferSelect
export type NewDailySnapshot = typeof dailySnapshots.$inferInsert

export const dailySources = pgTable("daily_sources", {
  sourceKey: text("source_key").primaryKey(),
  payload: jsonb("payload").notNull(),
  sourceAsOf: timestamp("source_as_of", { withTimezone: true }),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  status: text("status").notNull().default("valid"),
  provenance: jsonb("provenance").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const editorialEditions = pgTable("editorial_editions", {
  editionKey: text("edition_key").primaryKey(),
  editionDate: date("edition_date").notNull(),
  payload: jsonb("payload").notNull(),
  generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  marketAsOf: timestamp("market_as_of", { withTimezone: true }),
  status: text("status").notNull().default("valid"),
  generationMode: text("generation_mode").notNull().default("deterministic"),
  promptVersion: text("prompt_version"),
  model: text("model"),
  inputHash: text("input_hash"),
  tokenUsage: jsonb("token_usage"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export const jobExecutions = pgTable("job_executions", {
  jobKey: text("job_key").primaryKey(),
  status: text("status").notNull(),
  lockedUntil: timestamp("locked_until", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
  attempts: integer("attempts").notNull().default(0),
  inputHash: text("input_hash"),
  error: text("error"),
  metadata: jsonb("metadata").notNull().default({}),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
})

export type EditorialEdition = typeof editorialEditions.$inferSelect
