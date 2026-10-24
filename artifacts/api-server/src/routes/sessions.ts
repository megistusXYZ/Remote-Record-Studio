import { Router, type IRouter } from "express";
import { eq, desc, and, isNull } from "drizzle-orm";
import { deliveriesTable, db, sessionsTable, participantsTable } from "@workspace/db";
import {
  CreateSessionBody,
  ListSessionsQueryParams,
  GetSessionParams,
  UpdateSessionParams,
  UpdateSessionBody,
  DeleteSessionParams,
  JoinSessionParams,
  JoinSessionBody,
  LeaveSessionParams,
  LeaveSessionBody,
  LeaveSessionResponse,
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
import {
  sessionLookupIpLimiter,
  sessionsCreateQuota,
  sessionsJoinQuota,
} from "../middlewares/rate-limit";

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

  // Return ALL participant rows, including those who have left, so the
  // recording-aggregator side of the client can still address per-pubkey
  // tracks that arrived before the participant departed. The roster UI
  // filters on `leftAt === null` itself.
  const participants = await db
    .select()
    .from(participantsTable)
    .where(eq(participantsTable.sessionId, sessionId));

  // `participantCount` is the live, in-room count — it powers the room-cap
  // check on join and the participant pill on the lobby. People who have
  // explicitly left don't take a seat anymore.
  const liveCount = participants.reduce(
    (acc, p) => (p.leftAt == null ? acc + 1 : acc),
    0,
  );

  return {
    ...session,
    participantCount: liveCount,
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
      // Return the FULL participants list (including those who have
      // left) so historical context is preserved for the host's session
      // list — but expose `participantCount` as the LIVE count so the
      // "X people" pill on each card matches what the host would see
      // if they re-entered the room. Mirrors the same split that
      // `buildSessionResponse` applies for the single-session GET.
      const participants = await db
        .select()
        .from(participantsTable)
        .where(eq(participantsTable.sessionId, session.id));
      const liveCount = participants.reduce(
        (n, p) => n + (p.leftAt == null ? 1 : 0),
        0,
      );
      return {
        ...session,
        participantCount: liveCount,
        participants,
      };
    })
  );

  res.json(sessionsWithParticipants.map((s) => ListSessionsResponseItem.parse(s)));
});

// Creating a session writes the caller's pubkey as the host — auth required.
// Per-account quota runs after auth so it's keyed by the verified identity,
// not by IP (so a podcaster behind a NAT isn't penalized by their roommate).
router.post("/sessions", requireSignedRequest(), sessionsCreateQuota(), async (req, res): Promise<void> => {
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
  // Tight per-IP cap on JUST this GET — the only unauthenticated
  // DB-touching endpoint, and the obvious target for invite-code
  // enumeration. Other methods on the same path (POST .../join,
  // PATCH, DELETE) are not subject to this stricter limit; they
  // have their own per-pubkey quotas.
  sessionLookupIpLimiter(),
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

    // Anyone holding an invite code can look a session up before joining.
    // They need the title, host and head count, not every participant's
    // key. Keys are returned once the caller has joined (signed lookup).
    if (!getAuthPubkey(req)) {
      res.json(
        GetSessionResponse.parse({
          ...full,
          participants: full.participants.map((p) => ({ ...p, pubkey: "" })),
        }),
      );
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
    // shrink the room below the people already in it. We filter on
    // `leftAt IS NULL` because a participant who has cleanly left no
    // longer occupies a seat — counting them would falsely block the
    // host from tightening the cap after a guest exits.
    const currentLiveCount = await db
      .select()
      .from(participantsTable)
      .where(and(
        eq(participantsTable.sessionId, params.data.sessionId),
        isNull(participantsTable.leftAt),
      ))
      .then((rows) => rows.length);
    const requested = clampCap(parsed.data.maxParticipants);
    updates.maxParticipants = Math.max(requested, currentLiveCount);
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

  // Sealed delivery notes belong to the session; they go with it.
  await db
    .delete(deliveriesTable)
    .where(eq(deliveriesTable.sessionId, params.data.sessionId));

  await db
    .delete(sessionsTable)
    .where(eq(sessionsTable.id, params.data.sessionId));

  res.sendStatus(204);
});

router.post(
  "/sessions/:sessionId/join",
  requireSignedRequest(),
  sessionsJoinQuota(),
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

    // A session that has ended is over for everyone; a late join would
    // start a recorder with no host to deliver to.
    if (targetSession.status === "ended") {
      res.status(410).json({ error: "This session has ended" });
      return;
    }

    // Two concurrent joiners (a fast double-click; a retried request)
    // must not be able to slip past the cap check together, nor produce
    // duplicate participant rows. We serialise contention on this room
    // by taking a row-level lock on the session row inside a
    // transaction (`SELECT ... FOR UPDATE`). Inside the lock, the read
    // → cap-check → insert is effectively atomic, and the unique
    // index `(session_id, pubkey)` is the final backstop for any
    // races the lock missed (e.g. read-replica reads, retried
    // statements). The handler returns a `roomFull` flag from the
    // transaction so we can craft the 409 response after the lock is
    // released — keeping the transaction body tight.
    type JoinTxResult =
      | { roomFull: true; liveCount: number; cap: number }
      | { roomFull: false };
    const txResult: JoinTxResult = await db.transaction(async (tx) => {
      // Lock the session row so any other transaction touching this
      // room queues behind us, and re-read `maxParticipants` from
      // INSIDE the lock. Reading the cap from the pre-transaction
      // `targetSession` snapshot would race with a concurrent PATCH
      // that lowered the cap, letting one extra joiner squeak in
      // against a freshly-tightened limit.
      const [lockedSession] = await tx
        .select({
          id: sessionsTable.id,
          maxParticipants: sessionsTable.maxParticipants,
        })
        .from(sessionsTable)
        .where(eq(sessionsTable.id, realSessionId))
        .for("update")
        .limit(1);

      // The session row was confirmed to exist before we entered the
      // transaction (`targetSession` above), so the lock SELECT should
      // always return a row. If it doesn't, something deleted the
      // session in the gap — surface as room-full=false / no-op rather
      // than crashing.
      const cap = lockedSession?.maxParticipants ?? targetSession.maxParticipants;

      const [existingTx] = await tx
        .select()
        .from(participantsTable)
        .where(and(
          eq(participantsTable.sessionId, realSessionId),
          eq(participantsTable.pubkey, parsed.data.guestPubkey),
        ))
        .limit(1);

      if (existingTx) {
        // Idempotent re-join. If the participant had previously left
        // cleanly, clear the `leftAt` stamp so they show up in the
        // live roster again immediately rather than waiting for
        // cleanup. Also refresh `displayName` in case the user
        // updated their profile between sessions.
        if (
          existingTx.leftAt != null ||
          existingTx.displayName !== parsed.data.guestName
        ) {
          await tx
            .update(participantsTable)
            .set({ leftAt: null, displayName: parsed.data.guestName })
            .where(eq(participantsTable.id, existingTx.id));
        }
        return { roomFull: false };
      }

      // New joiner. Count LIVE participants — people who have cleanly
      // left don't take a seat — and enforce the cap inside the lock
      // so two parallel joiners can't both see "1 < 2" and both get in.
      // The cap value is the freshly-locked one (`cap`), not the
      // pre-transaction snapshot.
      const liveParticipants = await tx
        .select()
        .from(participantsTable)
        .where(and(
          eq(participantsTable.sessionId, realSessionId),
          isNull(participantsTable.leftAt),
        ));

      if (liveParticipants.length >= cap) {
        return {
          roomFull: true,
          liveCount: liveParticipants.length,
          cap,
        };
      }

      // Use ON CONFLICT DO UPDATE keyed on the unique
      // `(session_id, pubkey)` index as a final atomicity guarantee:
      // if a sibling transaction somehow sneaked an insert past us,
      // we transparently fall through to the same "clear leftAt + refresh
      // name" semantics as the explicit re-join branch above instead of
      // erroring out on the constraint.
      await tx
        .insert(participantsTable)
        .values({
          sessionId: realSessionId,
          pubkey: parsed.data.guestPubkey,
          displayName: parsed.data.guestName,
          role: "guest",
        })
        .onConflictDoUpdate({
          target: [participantsTable.sessionId, participantsTable.pubkey],
          set: {
            leftAt: null,
            displayName: parsed.data.guestName,
          },
        });

      return { roomFull: false };
    });

    if (txResult.roomFull) {
      // New joiners get a structured 409 with a public-safe slice of
      // session info so the guest's friendly "Room is full" page can
      // name the host.
      res.status(409).json({
        error: "ROOM_FULL",
        message: "This room is full right now.",
        session: {
          title: targetSession.title,
          hostName: targetSession.hostName,
          participantCount: txResult.liveCount,
          maxParticipants: txResult.cap,
        },
      });
      return;
    }

    // Recompute the live count after the join transaction commits and
    // persist it on the session so other readers (lobby pill, host's
    // session list) see the correct number without having to recount.
    const liveAfter = await db
      .select()
      .from(participantsTable)
      .where(and(
        eq(participantsTable.sessionId, realSessionId),
        isNull(participantsTable.leftAt),
      ));

    await db
      .update(sessionsTable)
      .set({ participantCount: liveAfter.length })
      .where(eq(sessionsTable.id, realSessionId));

    const full = await buildSessionResponse(realSessionId);
    if (!full) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json(JoinSessionResponse.parse(full));
  },
);

// Mark a participant as having cleanly left a session. Signed by the
// leaving participant's pubkey so a participant can only mark themselves
// as gone — never each other. The session row stays put and the host
// keeps control of its lifecycle (PATCH status=ended); leaving just
// drops the participant from the live roster everyone else is polling.
router.post(
  "/sessions/:sessionId/leave",
  requireSignedRequest(),
  async (req, res): Promise<void> => {
    const params = LeaveSessionParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = LeaveSessionBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    if (rejectIfPubkeyMismatch(req, res, parsed.data.pubkey)) return;

    // Resolve invite-code form too so a guest who only knows the invite
    // code in their URL bar can still cleanly leave. The invite-code
    // path stays public — possession of the invite code IS the
    // bearer-secret that authorises a participant to interact with the
    // session, so it does not need an additional membership gate.
    const idOrInvite = params.data.sessionId;
    const looksLikeUuid = UUID_RE.test(idOrInvite);
    const targetSession = await findSessionByIdOrInvite(idOrInvite);
    if (!targetSession) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const realSessionId = targetSession.id;

    // For raw-UUID lookups, mirror the GET /sessions/:id authorisation
    // model: the UUID is private, so we only confirm the session
    // exists (or return any session metadata) to callers who are
    // either the host or someone who has already been admitted. A
    // signed-but-unaffiliated caller who happens to know the UUID
    // gets a 404, identical to a non-existent session — they cannot
    // probe membership or harvest the host's display name.
    //
    // Membership lookup matches participants regardless of `leftAt`
    // so that a participant who already cleanly left can still issue
    // a redundant leave (e.g. on tab close after the keepalive POST
    // already fired) and receive a normal 200 response.
    if (looksLikeUuid && idOrInvite === realSessionId) {
      const isHost = parsed.data.pubkey === targetSession.hostPubkey;
      if (!isHost) {
        const [member] = await db
          .select({ id: participantsTable.id })
          .from(participantsTable)
          .where(and(
            eq(participantsTable.sessionId, realSessionId),
            eq(participantsTable.pubkey, parsed.data.pubkey),
          ))
          .limit(1);
        if (!member) {
          res.status(404).json({ error: "Session not found" });
          return;
        }
      }
    }

    // Mark every still-live row matching (session, pubkey) as left.
    // The unique index makes "every" mean "exactly one" in practice,
    // but updating by the composite key (rather than by `id` from a
    // prior SELECT) is defensive: it can't miss a row that was
    // concurrently created between our read and our write, and it's
    // a single round-trip instead of two. Returning the affected
    // rows lets us tell a no-op leave (caller never joined / already
    // left) from a real one — both are 200 OK responses, but only the
    // real one needs the live-count refresh below.
    const justLeft = await db
      .update(participantsTable)
      .set({ leftAt: new Date() })
      .where(and(
        eq(participantsTable.sessionId, realSessionId),
        eq(participantsTable.pubkey, parsed.data.pubkey),
        isNull(participantsTable.leftAt),
      ))
      .returning({ id: participantsTable.id });

    if (justLeft.length === 0) {
      // Idempotent: caller never joined or already left. Still 200
      // with the current session state so a hard-refresh-then-leave
      // flow doesn't produce a confusing 404 in the client log.
      const full = await buildSessionResponse(realSessionId);
      if (!full) {
        res.status(404).json({ error: "Session not found" });
        return;
      }
      res.json(LeaveSessionResponse.parse(full));
      return;
    }

    const liveAfter = await db
      .select()
      .from(participantsTable)
      .where(and(
        eq(participantsTable.sessionId, realSessionId),
        isNull(participantsTable.leftAt),
      ));

    await db
      .update(sessionsTable)
      .set({ participantCount: liveAfter.length })
      .where(eq(sessionsTable.id, realSessionId));

    const full = await buildSessionResponse(realSessionId);
    if (!full) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    res.json(LeaveSessionResponse.parse(full));
  },
);

export default router;
