import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import request from "supertest";
import {
  finalizeEvent,
  generateSecretKey,
  getPublicKey,
} from "nostr-tools/pure";
import {
  __resetReplayCacheForTests,
  attachOptionalSignedAuth,
  getAuthPubkey,
  requireSignedRequest,
} from "../src/middlewares/require-signed-request";

const sk = generateSecretKey();
const pk = getPublicKey(sk);

let server: ReturnType<express.Express["listen"]>;
let base = "";

function authHeader(opts: {
  method: string;
  url: string;
  body?: string;
  createdAt?: number;
  omitPayload?: boolean;
  payload?: string;
}): string {
  const tags: string[][] = [
    ["u", opts.url],
    ["method", opts.method],
  ];
  if (opts.body && !opts.omitPayload) {
    tags.push([
      "payload",
      opts.payload ?? createHash("sha256").update(opts.body).digest("hex"),
    ]);
  }
  const ev = finalizeEvent(
    {
      kind: 27235,
      created_at: opts.createdAt ?? Math.floor(Date.now() / 1000),
      content: "",
      tags,
    },
    sk,
  );
  return `Nostr ${Buffer.from(JSON.stringify(ev)).toString("base64")}`;
}

beforeAll(async () => {
  const app = express();
  app.use(
    express.json({
      verify: (req, _res, buf) => {
        (req as express.Request & { rawBody?: Buffer }).rawBody = buf;
      },
    }),
  );
  app.get("/t", requireSignedRequest(), (req, res) =>
    res.json({ pubkey: getAuthPubkey(req) }),
  );
  app.post("/t", requireSignedRequest(), (req, res) =>
    res.json({ pubkey: getAuthPubkey(req), body: req.body }),
  );
  app.get("/opt", attachOptionalSignedAuth(), (req, res) =>
    res.json({ pubkey: getAuthPubkey(req) ?? null }),
  );
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
});

beforeEach(() => __resetReplayCacheForTests());

describe("signed requests", () => {
  it("accepts a fresh, correctly bound GET", async () => {
    const res = await request(server)
      .get("/t")
      .set("Authorization", authHeader({ method: "GET", url: `${base}/t` }));
    expect(res.status).toBe(200);
    expect(res.body.pubkey).toBe(pk);
  });

  it("rejects a signature for another URL", async () => {
    const res = await request(server)
      .get("/t")
      .set(
        "Authorization",
        authHeader({ method: "GET", url: `${base}/other` }),
      );
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/does not match request URL/);
  });

  it("accepts a POST whose payload tag matches the body", async () => {
    const body = JSON.stringify({ title: "Episode 1" });
    const res = await request(server)
      .post("/t")
      .set("Content-Type", "application/json")
      .set(
        "Authorization",
        authHeader({ method: "POST", url: `${base}/t`, body }),
      )
      .send(body);
    expect(res.status).toBe(200);
    expect(res.body.body).toEqual({ title: "Episode 1" });
  });

  it("rejects a POST whose body differs from what was signed", async () => {
    const signedBody = JSON.stringify({ title: "Episode 1" });
    const sentBody = JSON.stringify({ title: "Something else" });
    const res = await request(server)
      .post("/t")
      .set("Content-Type", "application/json")
      .set(
        "Authorization",
        authHeader({ method: "POST", url: `${base}/t`, body: signedBody }),
      )
      .send(sentBody);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/payload.*does not match/);
  });

  it("rejects a POST that has a body but no payload tag", async () => {
    const body = JSON.stringify({ title: "Episode 1" });
    const res = await request(server)
      .post("/t")
      .set("Content-Type", "application/json")
      .set(
        "Authorization",
        authHeader({
          method: "POST",
          url: `${base}/t`,
          body,
          omitPayload: true,
        }),
      )
      .send(body);
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/missing 'payload'/);
  });

  it("rejects the same auth event a second time", async () => {
    const header = authHeader({ method: "GET", url: `${base}/t` });
    const first = await request(server).get("/t").set("Authorization", header);
    expect(first.status).toBe(200);
    const second = await request(server).get("/t").set("Authorization", header);
    expect(second.status).toBe(401);
    expect(second.body.error).toMatch(/already used/);
  });

  it("rejects an event outside the freshness window", async () => {
    const res = await request(server)
      .get("/t")
      .set(
        "Authorization",
        authHeader({
          method: "GET",
          url: `${base}/t`,
          createdAt: Math.floor(Date.now() / 1000) - 600,
        }),
      );
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/freshness/);
  });

  it("optional auth ignores a bad header and keeps a good one", async () => {
    const bad = await request(server)
      .get("/opt")
      .set("Authorization", "Nostr nope");
    expect(bad.status).toBe(200);
    expect(bad.body.pubkey).toBeNull();
    const good = await request(server)
      .get("/opt")
      .set("Authorization", authHeader({ method: "GET", url: `${base}/opt` }));
    expect(good.status).toBe(200);
    expect(good.body.pubkey).toBe(pk);
  });
});
