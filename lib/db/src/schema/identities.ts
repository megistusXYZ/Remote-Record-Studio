import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const identitiesTable = pgTable("identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  pubkey: text("pubkey").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertIdentitySchema = createInsertSchema(identitiesTable).omit({ id: true, createdAt: true });
export type InsertIdentity = z.infer<typeof insertIdentitySchema>;
export type Identity = typeof identitiesTable.$inferSelect;
