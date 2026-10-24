import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  db,
  deliveriesTable,
  participantsTable,
  sessionsTable,
} from "@workspace/db";
import {
  ListDeliveriesParams,
  RecordDeliveryBody,
  RecordDeliveryParams,
} from "@workspace/api-zod";
import {
  getAuthPubkey,
  requireSignedRequest,
} from "../middlewares/require-signed-request";

/**
 * Guest-to-host track deliveries (see lib/db/src/schema/deliveries.ts).
 *
 * POST: a participant records a note sealed to the host's key. The server
 *       never sees inside it.
 * GET:  the host lists them, whenever they come back, so a reload or a late
 *       upload no longer loses a guest's track.
 */
const router: IRouter = Router();

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function findSession(sessionId: string) {
  if (!UUID_RE.test(sessionId)) return null;
  const [session] = await db
    .select()
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .limit(1);
  return session ?? null;
}

function toWire(row: typeof deliveriesTable.$inferSelect) {
  return {
    id: row.id,
    senderPubkey: row.senderPubkey,
    sealed: row.sealed,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

router.post(
  "/sessions/:sessionId/deliveries",
  requireSignedRequest(),
  async (req, res): Promise<void> => {
    const params = RecordDeliveryParams.safeParse(req.params);
    const body = RecordDeliveryBody.safeParse(req.body);
    if (!params.success || !body.success) {
      res.status(400).json({ error: "Invalid delivery" });
      return;
    }
    const session = await findSession(params.data.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const sender = getAuthPubkey(req)!;
    if (sender !== session.hostPubkey) {
      const [participant] = await db
        .select({ id: participantsTable.id })
        .from(participantsTable)
        .where(
          and(
            eq(participantsTable.sessionId, session.id),
            eq(participantsTable.pubkey, sender),
          ),
        )
        .limit(1);
      if (!participant) {
        res
          .status(403)
          .json({ error: "Only people in this session can deliver to it" });
        return;
      }
    }
    const now = new Date();
    const [row] = await db
      .insert(deliveriesTable)
      .values({
        sessionId: session.id,
        senderPubkey: sender,
        sealed: body.data.sealed,
      })
      .onConflictDoUpdate({
        target: [deliveriesTable.sessionId, deliveriesTable.senderPubkey],
        set: { sealed: body.data.sealed, updatedAt: now },
      })
      .returning();
    res.status(201).json(toWire(row!));
  },
);

router.get(
  "/sessions/:sessionId/deliveries",
  requireSignedRequest(),
  async (req, res): Promise<void> => {
    const params = ListDeliveriesParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Invalid session" });
      return;
    }
    const session = await findSession(params.data.sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (getAuthPubkey(req) !== session.hostPubkey) {
      res.status(403).json({ error: "Only the host can list deliveries" });
      return;
    }
    const rows = await db
      .select()
      .from(deliveriesTable)
      .where(eq(deliveriesTable.sessionId, session.id))
      .orderBy(desc(deliveriesTable.updatedAt));
    res.setHeader("Cache-Control", "no-store");
    res.json(rows.map(toWire));
  },
);

export default router;
