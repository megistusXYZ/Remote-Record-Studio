import { pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const participantsTable = pgTable(
  "participants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull(),
    pubkey: text("pubkey").notNull(),
    displayName: text("display_name").notNull(),
    role: text("role").notNull().default("guest"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
    // Set when the participant explicitly leaves the room via POST
    // /sessions/:id/leave. Null while the participant is still in the
    // room. The roster filters rows where this is non-null so a clean
    // exit removes the row across every participant's view immediately.
    // Re-joining the same room clears this back to null in the join
    // handler so a refresh after a clean leave behaves like a fresh
    // join, not a re-entry.
    leftAt: timestamp("left_at", { withTimezone: true }),
  },
  (t) => ({
    // Hard guarantee: a given (sessionId, pubkey) pair appears at most
    // once. Without this, two concurrent joins from the same client
    // (e.g. a fast double-click on "Join", or a retry after a network
    // blip) could read-then-insert in parallel and produce duplicate
    // rows, which then permanently inflate the live participant count
    // and prevent a clean leave from clearing the user out of the
    // roster. The join handler relies on this constraint as the
    // authoritative serialisation point: it issues a SELECT FOR UPDATE
    // on the session row first, but the unique index is the final
    // backstop for any race the lock missed (cross-replica writes,
    // retried statements, etc).
    sessionPubkeyUq: uniqueIndex("participants_session_pubkey_uq").on(
      t.sessionId,
      t.pubkey,
    ),
  }),
);

export const insertParticipantSchema = createInsertSchema(participantsTable).omit({ id: true, joinedAt: true, leftAt: true });
export type InsertParticipant = z.infer<typeof insertParticipantSchema>;
export type Participant = typeof participantsTable.$inferSelect;
