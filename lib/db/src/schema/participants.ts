import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const participantsTable = pgTable("participants", {
  id: uuid("id").primaryKey().defaultRandom(),
  sessionId: uuid("session_id").notNull(),
  pubkey: text("pubkey").notNull(),
  displayName: text("display_name").notNull(),
  role: text("role").notNull().default("guest"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertParticipantSchema = createInsertSchema(participantsTable).omit({ id: true, joinedAt: true });
export type InsertParticipant = z.infer<typeof insertParticipantSchema>;
export type Participant = typeof participantsTable.$inferSelect;
