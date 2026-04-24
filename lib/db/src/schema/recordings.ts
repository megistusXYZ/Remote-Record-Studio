import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const recordingsTable = pgTable("recordings", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id"),
  sessionTitle: text("session_title"),
  ownerPubkey: text("owner_pubkey").notNull(),
  participantName: text("participant_name").notNull(),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  sizeBytes: integer("size_bytes").notNull().default(0),
  mimeType: text("mime_type").notNull().default("audio/webm"),
  blobHash: text("blob_hash"),
  blobUrl: text("blob_url"),
  status: text("status").notNull().default("ready"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRecordingSchema = createInsertSchema(recordingsTable).omit({ id: true, createdAt: true });
export type InsertRecording = z.infer<typeof insertRecordingSchema>;
export type Recording = typeof recordingsTable.$inferSelect;
