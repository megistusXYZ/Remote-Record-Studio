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
import {
  attachOptionalSignedAuth,
  getAuthPubkey,
  rejectIfPubkeyMismatch,
  requireSignedRequest,
} from "../middlewares/require-signed-request";

// Server-side bounds for the per-session participant cap. Keep in sync with
// the OpenAPI spec ({ minimum: 1, maximum: 25 }) and with the room-size
// picker on the create-session form. The default applies when the host
// omits maxParticipants on create.
const ROOM_SIZE_MIN = 1;
const ROOM_SIZE_MAX = 25;
const ROOM_SIZE_DEFAULT = 8;

function clampCap(value: number): number {
  if (!Number.isFinite(value)) return ROOM_SIZE_DEFAULT;
  return Math.max(ROOM_SIZE_MIN, Math.min(ROOM_SIZE_MAX, Math.floor(value)));
}

// RFC 4122 / 8-4-4-4-12 hex form. Used to distinguish a session UUID (private,
// must be auth-gated) from an invite code (public bearer secret) on the
// shared `GET /sessions/:sessionId` route.
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// Listing the sessions a host owns is identity-scoped, so it must be signed.
router.get("/sessions", requireSignedRequest(), async (req, res): Promise<void> => {
  const params = ListSessionsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  if (rejectIfPubkeyMismatch(req, res, params.data.pubkey)) return;

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

// Creating a session writes the caller's pubkey as the host — auth required.
router.post("/sessions", requireSignedRequest(), async (req, res): Promise<void> => {
  const parsed = CreateSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  if (rejectIfPubkeyMismatch(req, res, parsed.data.hostPubkey)) return;

  const inviteCode = nanoid(8);

  // Honor the host's room-size choice when present, default to 8 otherwise.
  // Always clamp into the allowed range so a hand-crafted request can't
  // bypass the OpenAPI bounds.
  const maxParticipants = clampCap(
    parsed.data.maxParticipants ?? ROOM_SIZE_DEFAULT,
  );

  const [session] = await db
    .insert(sessionsTable)
    .values({
      title: parsed.data.title,
      hostPubkey: parsed.data.hostPubkey,
      hostName: parsed.data.hostName,
      status: "waiting",
      inviteCode,
      participantCount: 1,
      maxParticipants,
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

// PUBLIC for invite-code lookups: guests need to resolve their meeting URL
// BEFORE they sign in, so a successful lookup by INVITE CODE returns the
// session unconditionally — the invite code itself is the bearer secret.
//
// PROTECTED for raw-UUID lookups: the session's UUID is private (only
// returned to the host on create, or to participants after join). We require
// a valid signed request whose pubkey is the host or an existing
// participant before disclosing anything when the path param looks like a
// UUID. This closes the metadata-leak path where someone with a leaked UUID
// could enumerate sessions without auth.
router.get(
  "/sessions/:sessionId",
  attachOptionalSignedAuth(),
  async (req, res): Promise<void> => {
    const params = GetSessionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const idOrInvite = params.data.sessionId;
    const looksLikeUuid = UUID_RE.test(idOrInvite);

    // Try invite code first — that path stays public.
    const [byInvite] = await db
      .select()
      .from(sessionsTable)
      .where(eq(sessionsTable.inviteCode, idOrInvite))
      .limit(1);

    let session = byInvite ?? null;

    if (!session && looksLikeUuid) {
      const [byId] = await db
        .select()
        .from(sessionsTable)
        .where(eq(sessionsTable.id, idOrInvite))
        .limit(1);
      if (byId) {
        const authPubkey = getAuthPubkey(req);
        if (!authPubkey) {
          // Hide the existence of this session from anonymous callers.
          res.status(404).json({ error: "Session not found" });
          return;
        }
        if (authPubkey !== byId.hostPubkey) {
          const [participant] = await db
            .select()
            .from(participantsTable)
            .where(
              and(
                eq(participantsTable.sessionId, byId.id),
                eq(participantsTable.pubkey, authPubkey),
              ),
            )
            .limit(1);
          if (!participant) {
            res.status(404).json({ error: "Session not found" });
            return;
          }
        }
        session = byId;
      }
    }

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
  },
);

router.patch("/sessions/:sessionId", requireSignedRequest(), async (req, res): Promise<void> => {
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

  // Only the session host may mutate the session.
  const [existing] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, params.data.sessionId))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  if (rejectIfPubkeyMismatch(req, res, existing.hostPubkey)) return;

  const updates: Record<string, unknown> = {};
  if (parsed.data.title) updates.title = parsed.data.title;
  if (parsed.data.status) {
    updates.status = parsed.data.status;
    if (parsed.data.status === "live") updates.startedAt = new Date();
    if (parsed.data.status === "ended") updates.endedAt = new Date();
  }
  if (typeof parsed.data.maxParticipants === "number") {
    // Clamp the requested cap to the global max, then floor at the
    // CURRENT live participant count so the host can never accidentally
    // shrink the room below the people already in it.
    const currentCount = await db
      .select()
      .from(participantsTable)
      .where(eq(participantsTable.sessionId, params.data.sessionId))
      .then((rows) => rows.length);
    const requested = clampCap(parsed.data.maxParticipants);
    updates.maxParticipants = Math.max(requested, currentCount);
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

router.delete("/sessions/:sessionId", requireSignedRequest(), async (req, res): Promise<void> => {
  const params = DeleteSessionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  // Only the session host may delete the session.
  const [existing] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, params.data.sessionId))
    .limit(1);
  if (!existing) {
    res.sendStatus(204);
    return;
  }
  if (rejectIfPubkeyMismatch(req, res, existing.hostPubkey)) return;

  await db
    .delete(participantsTable)
    .where(eq(participantsTable.sessionId, params.data.sessionId));

  await db
    .delete(sessionsTable)
    .where(eq(sessionsTable.id, params.data.sessionId));

  res.sendStatus(204);
});

router.post(
  "/sessions/:sessionId/join",
  requireSignedRequest(),
  async (req, res): Promise<void> => {
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

    // The guest must prove they hold the pubkey they're joining as.
    if (rejectIfPubkeyMismatch(req, res, parsed.data.guestPubkey)) return;

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
      // Enforce the per-session participant cap. Idempotent re-joins (the
      // branch above) always succeed regardless of cap so a refreshed
      // browser tab never gets locked out. New joiners get a structured
      // 409 with a public-safe slice of session info so the guest's
      // friendly "Room is full" page can name the host.
      const currentParticipants = await db
        .select()
        .from(participantsTable)
        .where(eq(participantsTable.sessionId, realSessionId));

      if (currentParticipants.length >= targetSession.maxParticipants) {
        res.status(409).json({
          error: "ROOM_FULL",
          message: "This room is full right now.",
          session: {
            title: targetSession.title,
            hostName: targetSession.hostName,
            participantCount: currentParticipants.length,
            maxParticipants: targetSession.maxParticipants,
          },
        });
        return;
      }

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
  },
);

export default router;
