import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Guest-to-host track deliveries.
 *
 * When a participant's recording is uploaded, their device seals the share
 * link to their archive with the host's public key (NIP-44) and records it
 * here. The server stores the sealed note and can never open it; only the
 * host's key can. One row per sender per session, latest wins, so a guest
 * who re-uploads replaces their earlier delivery.
 */
export const deliveriesTable = pgTable(
  "deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sessionId: uuid("session_id").notNull(),
    senderPubkey: text("sender_pubkey").notNull(),
    sealed: text("sealed").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    sessionSenderUq: uniqueIndex("deliveries_session_sender_uq").on(
      t.sessionId,
      t.senderPubkey,
    ),
  }),
);

export type Delivery = typeof deliveriesTable.$inferSelect;
