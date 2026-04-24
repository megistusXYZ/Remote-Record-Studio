import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, identitiesTable } from "@workspace/db";
import { CreateIdentityBody, CreateIdentityResponse } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/identity", async (req, res): Promise<void> => {
  const parsed = CreateIdentityBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const existing = await db
    .select()
    .from(identitiesTable)
    .where(eq(identitiesTable.pubkey, parsed.data.pubkey))
    .limit(1);

  if (existing.length > 0) {
    res.json(CreateIdentityResponse.parse(existing[0]));
    return;
  }

  const [identity] = await db
    .insert(identitiesTable)
    .values({
      pubkey: parsed.data.pubkey,
      displayName: parsed.data.displayName,
      email: parsed.data.email ?? null,
    })
    .returning();

  res.json(CreateIdentityResponse.parse(identity));
});

export default router;
