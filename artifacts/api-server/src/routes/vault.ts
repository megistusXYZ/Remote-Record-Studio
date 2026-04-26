import { Router, type IRouter } from "express";
import { eq, desc } from "drizzle-orm";
import { db, recordingsTable, sessionsTable } from "@workspace/db";
import {
  GetVaultSummaryQueryParams,
  GetVaultSummaryResponse,
  GetRecentActivityQueryParams,
  GetRecentActivityResponse,
  ListRecordingsResponseItem,
  ListSessionsResponseItem,
} from "@workspace/api-zod";
import { participantsTable } from "@workspace/db";
import {
  rejectIfPubkeyMismatch,
  requireSignedRequest,
} from "../middlewares/require-signed-request";

const router: IRouter = Router();

router.get("/vault/summary", requireSignedRequest(), async (req, res): Promise<void> => {
  const params = GetVaultSummaryQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (rejectIfPubkeyMismatch(req, res, params.data.pubkey)) return;

  const recordings = await db
    .select()
    .from(recordingsTable)
    .where(eq(recordingsTable.ownerPubkey, params.data.pubkey));

  const sessions = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.hostPubkey, params.data.pubkey));

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const recentRecordings = recordings.filter(
    (r) => new Date(r.createdAt) >= startOfMonth
  );

  const totalDuration = recordings.reduce((sum, r) => sum + r.durationSeconds, 0);
  const totalSize = recordings.reduce((sum, r) => sum + r.sizeBytes, 0);

  const summary = {
    totalRecordings: recordings.length,
    totalDurationSeconds: totalDuration,
    totalSizeBytes: totalSize,
    totalSessions: sessions.length,
    recordingsThisMonth: recentRecordings.length,
  };

  res.json(GetVaultSummaryResponse.parse(summary));
});

router.get("/vault/recent", requireSignedRequest(), async (req, res): Promise<void> => {
  const params = GetRecentActivityQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (rejectIfPubkeyMismatch(req, res, params.data.pubkey)) return;

  const limit = params.data.limit ?? 5;

  const recentRecordings = await db
    .select()
    .from(recordingsTable)
    .where(eq(recordingsTable.ownerPubkey, params.data.pubkey))
    .orderBy(desc(recordingsTable.createdAt))
    .limit(limit);

  const recentSessions = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.hostPubkey, params.data.pubkey))
    .orderBy(desc(sessionsTable.createdAt))
    .limit(limit);

  const sessionsWithParticipants = await Promise.all(
    recentSessions.map(async (session) => {
      const participants = await db
        .select()
        .from(participantsTable)
        .where(eq(participantsTable.sessionId, session.id));
      return {
        ...session,
        participantCount: participants.length,
        participants,
      };
    })
  );

  const activity = {
    recentRecordings: recentRecordings.map((r) => ListRecordingsResponseItem.parse(r)),
    recentSessions: sessionsWithParticipants.map((s) => ListSessionsResponseItem.parse(s)),
  };

  res.json(GetRecentActivityResponse.parse(activity));
});

export default router;
