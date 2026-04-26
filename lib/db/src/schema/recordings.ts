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
  // Audio-only sibling blob recorded in parallel by a second MediaRecorder.
  // Lets the vault offer an honest "Audio only" download — no transcoding —
  // alongside the combined V+A blob above. Always nullable: legacy rows and
  // single-stream guests (no camera) keep working with just the main blob.
  audioBlobHash: text("audio_blob_hash"),
  audioBlobUrl: text("audio_blob_url"),
  audioSizeBytes: integer("audio_size_bytes"),
  audioMimeType: text("audio_mime_type"),
  // Video-only sibling blob recorded in parallel by a third MediaRecorder.
  // Same rationale as the audio sibling: the vault can offer a real "Video
  // only" download (no audio bytes, no transcoding). Nullable for legacy
  // rows and audio-only sessions.
  videoBlobHash: text("video_blob_hash"),
  videoBlobUrl: text("video_blob_url"),
  videoSizeBytes: integer("video_size_bytes"),
  videoMimeType: text("video_mime_type"),
  // Screen-share blob, recorded in parallel by a separate ChunkedRecorder
  // when the participant pressed "Share screen" during the call. Captured
  // as a clean per-participant track — no compositing with camera/audio —
  // so the vault can offer "Screen", "Screen + Mic" and bundle it into the
  // selective-export zip alongside camera and audio tracks. Always
  // nullable: most rows won't have a screen-share.
  screenBlobHash: text("screen_blob_hash"),
  screenBlobUrl: text("screen_blob_url"),
  screenSizeBytes: integer("screen_size_bytes"),
  screenMimeType: text("screen_mime_type"),
  screenDurationSeconds: integer("screen_duration_seconds"),
  status: text("status").notNull().default("ready"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertRecordingSchema = createInsertSchema(recordingsTable).omit({ id: true, createdAt: true });
export type InsertRecording = z.infer<typeof insertRecordingSchema>;
export type Recording = typeof recordingsTable.$inferSelect;
