import { Router, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, sessionsTable, participantsTable } from "@workspace/db";
import {
  CreateSessionBody,
  ListSessionsQueryParams,
  GetSessionParams,
  UpdateSessionParams,
  UpdateSessionBody,
  DeleteSessionParams,
  JoinSessionParams,
  JoinSessionBody,
  GetSessionResponse,
  ListSessionsResponseItem,
  UpdateSessionResponse,
  JoinSessionResponse,
} from "@workspace/api-zod";
import { nanoid } from "../lib/nanoid";

const router: IRouter = Router();

async function buildSessionResponse(sessionId: string) {
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);

  if (!session) return null;

  const participants = await db
    .select()
    .from(participantsTable)
    .where(eq(participantsTable.sessionId, sessionId));

  return {
    ...session,
    participantCount: participants.length,
    participants,
  };
}

router.get("/sessions", async (req, res): Promise<void> => {
  const params = ListSessionsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const sessions = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.hostPubkey, params.data.pubkey))
    .orderBy(desc(sessionsTable.createdAt));

  const sessionsWithParticipants = await Promise.all(
    sessions.map(async (session) => {
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

  res.json(sessionsWithParticipants.map((s) => ListSessionsResponseItem.parse(s)));
});

router.post("/sessions", async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const inviteCode = nanoid(8);

  const [session] = await db
    .insert(sessionsTable)
    .values({
      title: parsed.data.title,
      hostPubkey: parsed.data.hostPubkey,
      hostName: parsed.data.hostName,
      status: "waiting",
      inviteCode,
      participantCount: 1,
    })
    .returning();

  await db.insert(participantsTable).values({
    sessionId: session.id,
    pubkey: parsed.data.hostPubkey,
    displayName: parsed.data.hostName,
    role: "host",
  });

  const full = await buildSessionResponse(session.id);
  res.status(201).json(GetSessionResponse.parse(full));
});

async function findSessionByIdOrInvite(idOrInvite: string) {
  const [byInvite] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.inviteCode, idOrInvite))
    .limit(1);
  if (byInvite) return byInvite;
  const [byId] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, idOrInvite))
    .limit(1);
  return byId ?? null;
}

router.get("/sessions/:sessionId", async (req, res): Promise<void> => {
  const params = GetSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const session = await findSessionByIdOrInvite(params.data.sessionId);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  const full = await buildSessionResponse(session.id);
  if (!full) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(GetSessionResponse.parse(full));
});

router.patch("/sessions/:sessionId", async (req, res): Promise<void> => {
  const params = UpdateSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.title) updates.title = parsed.data.title;
  if (parsed.data.status) {
    updates.status = parsed.data.status;
    if (parsed.data.status === "live") updates.startedAt = new Date();
    if (parsed.data.status === "ended") updates.endedAt = new Date();
  }

  await db
    .update(sessionsTable)
    .set(updates)
    .where(eq(sessionsTable.id, params.data.sessionId));

  const full = await buildSessionResponse(params.data.sessionId);
  if (!full) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(UpdateSessionResponse.parse(full));
});

router.delete("/sessions/:sessionId", async (req, res): Promise<void> => {
  const params = DeleteSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  await db
    .delete(participantsTable)
    .where(eq(participantsTable.sessionId, params.data.sessionId));

  await db
    .delete(sessionsTable)
    .where(eq(sessionsTable.id, params.data.sessionId));

  res.sendStatus(204);
});

router.post("/sessions/:sessionId/join", async (req, res): Promise<void> => {
  const params = JoinSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = JoinSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Resolve invite code → real session UUID (guests join via invite code in the URL)
  const targetSession = await findSessionByIdOrInvite(params.data.sessionId);
  if (!targetSession) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  const realSessionId = targetSession.id;

  const existing = await db
    .select()
    .from(participantsTable)
    .where(and(
      eq(participantsTable.sessionId, realSessionId),
      eq(participantsTable.pubkey, parsed.data.guestPubkey)
    ))
    .limit(1);

  if (existing.length === 0) {
    await db.insert(participantsTable).values({
      sessionId: realSessionId,
      pubkey: parsed.data.guestPubkey,
      displayName: parsed.data.guestName,
      role: "guest",
    });

    const participants = await db
      .select()
      .from(participantsTable)
      .where(eq(participantsTable.sessionId, realSessionId));

    await db
      .update(sessionsTable)
      .set({ participantCount: participants.length })
      .where(eq(sessionsTable.id, realSessionId));
  }

  const full = await buildSessionResponse(realSessionId);
  if (!full) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  res.json(JoinSessionResponse.parse(full));
});

export default router;
