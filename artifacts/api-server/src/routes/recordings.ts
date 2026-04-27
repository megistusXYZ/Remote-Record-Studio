import { Router, type IRouter } from "express";
import { eq, and, desc } from "drizzle-orm";
import { db, recordingsTable } from "@workspace/db";
import {
  CreateRecordingBody,
  ListRecordingsQueryParams,
  GetRecordingParams,
  DeleteRecordingParams,
  GetRecordingResponse,
  ListRecordingsResponseItem,
} from "@workspace/api-zod";
import {
  getAuthPubkey,
  rejectIfPubkeyMismatch,
  requireSignedRequest,
} from "../middlewares/require-signed-request";
import { recordingsWriteQuota } from "../middlewares/rate-limit";

const router: IRouter = Router();

router.get("/recordings", requireSignedRequest(), async (req, res): Promise<void> => {
  const params = ListRecordingsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (rejectIfPubkeyMismatch(req, res, params.data.pubkey)) return;

  const conditions = [eq(recordingsTable.ownerPubkey, params.data.pubkey)];
  if (params.data.sessionId) {
    conditions.push(eq(recordingsTable.sessionId, params.data.sessionId));
  }

  const recordings = await db
    .select()
    .from(recordingsTable)
    .where(and(...conditions))
    .orderBy(desc(recordingsTable.createdAt));

  res.json(recordings.map((r) => ListRecordingsResponseItem.parse(r)));
});

// Recording metadata writes are gated by a per-pubkey quota so a runaway
// client (or a malicious one with a leaked key) can't fill the table.
router.post("/recordings", requireSignedRequest(), recordingsWriteQuota(), async (req, res): Promise<void> => {
  const parsed = CreateRecordingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (rejectIfPubkeyMismatch(req, res, parsed.data.ownerPubkey)) return;

  const [recording] = await db
    .insert(recordingsTable)
    .values({
      sessionId: parsed.data.sessionId ?? null,
      sessionTitle: parsed.data.sessionTitle ?? null,
      ownerPubkey: parsed.data.ownerPubkey,
      participantName: parsed.data.participantName,
      durationSeconds: parsed.data.durationSeconds,
      sizeBytes: parsed.data.sizeBytes,
      mimeType: parsed.data.mimeType,
      blobHash: parsed.data.blobHash ?? null,
      blobUrl: parsed.data.blobUrl ?? null,
      audioBlobHash: parsed.data.audioBlobHash ?? null,
      audioBlobUrl: parsed.data.audioBlobUrl ?? null,
      audioSizeBytes: parsed.data.audioSizeBytes ?? null,
      audioMimeType: parsed.data.audioMimeType ?? null,
      videoBlobHash: parsed.data.videoBlobHash ?? null,
      videoBlobUrl: parsed.data.videoBlobUrl ?? null,
      videoSizeBytes: parsed.data.videoSizeBytes ?? null,
      videoMimeType: parsed.data.videoMimeType ?? null,
      screenBlobHash: parsed.data.screenBlobHash ?? null,
      screenBlobUrl: parsed.data.screenBlobUrl ?? null,
      screenSizeBytes: parsed.data.screenSizeBytes ?? null,
      screenMimeType: parsed.data.screenMimeType ?? null,
      screenDurationSeconds: parsed.data.screenDurationSeconds ?? null,
      status: parsed.data.status,
    })
    .returning();

  res.status(201).json(GetRecordingResponse.parse(recording));
});

router.get("/recordings/:recordingId", requireSignedRequest(), async (req, res): Promise<void> => {
  const params = GetRecordingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [recording] = await db
    .select()
    .from(recordingsTable)
    .where(eq(recordingsTable.id, params.data.recordingId))
    .limit(1);

  if (!recording) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }

  // Only the owner may read recording metadata. We return 404 for non-owners
  // to avoid leaking the existence of a recording id to outsiders.
  if (recording.ownerPubkey !== getAuthPubkey(req)) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }

  res.json(GetRecordingResponse.parse(recording));
});

router.delete("/recordings/:recordingId", requireSignedRequest(), async (req, res): Promise<void> => {
  const params = DeleteRecordingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [recording] = await db
    .select()
    .from(recordingsTable)
    .where(eq(recordingsTable.id, params.data.recordingId))
    .limit(1);

  if (recording && recording.ownerPubkey !== getAuthPubkey(req)) {
    res.status(404).json({ error: "Recording not found" });
    return;
  }

  await db
    .delete(recordingsTable)
    .where(eq(recordingsTable.id, params.data.recordingId));

  res.sendStatus(204);
});

export default router;
