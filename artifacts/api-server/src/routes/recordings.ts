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

const router: IRouter = Router();

router.get("/recordings", async (req, res): Promise<void> => {
  const params = ListRecordingsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

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

router.post("/recordings", async (req, res): Promise<void> => {
  const parsed = CreateRecordingBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

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
      status: parsed.data.status,
    })
    .returning();

  res.status(201).json(GetRecordingResponse.parse(recording));
});

router.get("/recordings/:recordingId", async (req, res): Promise<void> => {
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

  res.json(GetRecordingResponse.parse(recording));
});

router.delete("/recordings/:recordingId", async (req, res): Promise<void> => {
  const params = DeleteRecordingParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db
    .delete(recordingsTable)
    .where(eq(recordingsTable.id, params.data.recordingId));

  res.sendStatus(204);
});

export default router;
