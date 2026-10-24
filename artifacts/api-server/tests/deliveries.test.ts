import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import { databaseAvailable, setUpDatabase, truncateAll } from "./support/db";

/**
 * Guest-to-host delivery, recorded by the API instead of a short-lived relay
 * message. A guest posts a sealed note (the share link to their archive,
 * encrypted to the host's key on the guest's device); only the host can list
 * them, at any time after the session.
 */

const available = await databaseAvailable();

type Person = { sk: Uint8Array; pk: string };
const person = (): Person => {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
};

let base = "";
let server: { close: () => void } | null = null;
let dbm: Awaited<ReturnType<typeof setUpDatabase>>;

function auth(who: Person, method: string, url: string, body?: string): string {
  const tags = [
    ["u", url],
    ["method", method],
  ];
  if (body)
    tags.push(["payload", createHash("sha256").update(body).digest("hex")]);
  const ev = finalizeEvent(
    {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      content: "",
      tags,
    },
    who.sk,
  );
  return `Nostr ${Buffer.from(JSON.stringify(ev)).toString("base64")}`;
}

async function call(
  who: Person | null,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
) {
  const url = `${base}${path}`;
  const text = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (text) headers["content-type"] = "application/json";
  if (who) headers["authorization"] = auth(who, method, url, text);
  const res = await fetch(url, { method, headers, body: text });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
}

async function seedSession(host: Person, guests: Person[]) {
  const { db, sessionsTable, participantsTable } = dbm;
  const [session] = await db
    .insert(sessionsTable)
    .values({
      title: "Ep 1",
      hostPubkey: host.pk,
      hostName: "Host",
      inviteCode: `inv${Math.random().toString(36).slice(2, 10)}`,
      status: "ended",
    })
    .returning();
  await db
    .insert(participantsTable)
    .values([
      {
        sessionId: session!.id,
        pubkey: host.pk,
        displayName: "Host",
        role: "host",
      },
      ...guests.map((g) => ({
        sessionId: session!.id,
        pubkey: g.pk,
        displayName: "Guest",
        role: "guest",
      })),
    ]);
  return session!.id;
}

describe.skipIf(!available)("deliveries", () => {
  beforeAll(async () => {
    dbm = await setUpDatabase();
    const { default: app } = await import("../src/app");
    await new Promise<void>((resolve) => {
      const s = app.listen(0, "127.0.0.1", () => resolve());
      server = s;
    });
    const { port } = (
      server as unknown as { address: () => AddressInfo }
    ).address();
    base = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    server?.close();
    await dbm?.pool.end();
  });

  beforeEach(async () => {
    await truncateAll(dbm.pool);
  });

  it("lets the host list what a guest delivered, after any delay", async () => {
    const host = person();
    const guest = person();
    const sessionId = await seedSession(host, [guest]);

    const posted = await call(
      guest,
      "POST",
      `/api/sessions/${sessionId}/deliveries`,
      { sealed: "sealed-for-host" },
    );
    expect(posted.status).toBe(201);

    const listed = await call(
      host,
      "GET",
      `/api/sessions/${sessionId}/deliveries`,
    );
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({
        senderPubkey: guest.pk,
        sealed: "sealed-for-host",
      }),
    ]);
  });

  it("refuses deliveries from people who are not in the session", async () => {
    const host = person();
    const stranger = person();
    const sessionId = await seedSession(host, []);
    const res = await call(
      stranger,
      "POST",
      `/api/sessions/${sessionId}/deliveries`,
      { sealed: "x" },
    );
    expect(res.status).toBe(403);
  });

  it("shows deliveries to the host only", async () => {
    const host = person();
    const guest = person();
    const sessionId = await seedSession(host, [guest]);
    await call(guest, "POST", `/api/sessions/${sessionId}/deliveries`, {
      sealed: "x",
    });
    expect(
      (await call(guest, "GET", `/api/sessions/${sessionId}/deliveries`))
        .status,
    ).toBe(403);
    expect(
      (await call(null, "GET", `/api/sessions/${sessionId}/deliveries`)).status,
    ).toBe(401);
  });

  it("keeps only the latest delivery from each guest", async () => {
    const host = person();
    const guest = person();
    const sessionId = await seedSession(host, [guest]);
    await call(guest, "POST", `/api/sessions/${sessionId}/deliveries`, {
      sealed: "first upload",
    });
    await call(guest, "POST", `/api/sessions/${sessionId}/deliveries`, {
      sealed: "re-upload",
    });
    const listed = await call(
      host,
      "GET",
      `/api/sessions/${sessionId}/deliveries`,
    );
    expect(listed.body).toHaveLength(1);
    expect(listed.body[0].sealed).toBe("re-upload");
  });

  it("answers 404 for unknown sessions and 400 for empty notes", async () => {
    const host = person();
    const guest = person();
    const sessionId = await seedSession(host, [guest]);
    expect(
      (
        await call(
          guest,
          "POST",
          `/api/sessions/00000000-0000-4000-8000-000000000000/deliveries`,
          { sealed: "x" },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await call(guest, "POST", `/api/sessions/${sessionId}/deliveries`, {
          sealed: "",
        })
      ).status,
    ).toBe(400);
  });
});
