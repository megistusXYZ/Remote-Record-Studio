import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express from "express";
import request from "supertest";
import {
  buildLimiter,
  publicIpLimiter,
  pubkeyQuota,
  rateLimitConfig,
} from "../src/middlewares/rate-limit";
import {
  errorHandler,
  notFoundHandler,
} from "../src/middlewares/error-handler";

// We restore env on every test so flag flips don't leak between cases.
const ORIGINAL_ENV = { ...process.env };
afterEach(() => {
  // Reset to the snapshot — vi.unstubAllEnvs is for stubs only.
  for (const key of Object.keys(process.env)) {
    if (!(key in ORIGINAL_ENV)) delete process.env[key];
  }
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  vi.restoreAllMocks();
});

// All the rate-limit factories read mode from the `rateLimitConfig`
// snapshot taken at module load. To exercise mode behavior in tests we
// flip the snapshot directly. This mirrors how an operator would change
// the env var and restart the process.
function setRuntimeMode(mode: "enforce" | "observe" | "off") {
  rateLimitConfig.mode = mode;
}

function setEnabled(enabled: boolean) {
  rateLimitConfig.enabled = enabled;
}

function setQuotaEnabled(enabled: boolean) {
  rateLimitConfig.quotaEnabled = enabled;
}

beforeEach(() => {
  // Default to enforce so a single un-configured test doesn't accidentally
  // pass because the limiter was silently a no-op.
  setEnabled(true);
  setQuotaEnabled(true);
  setRuntimeMode("enforce");
});

describe("rate-limit middleware", () => {
  it("returns 429 + Retry-After + structured body after the limit", async () => {
    const app = express();
    app.use(
      buildLimiter({ name: "test-tight", windowMs: 60_000, limit: 2 }),
    );
    app.get("/probe", (_req, res) => res.json({ ok: true }));

    const agent = request(app);
    const r1 = await agent.get("/probe");
    const r2 = await agent.get("/probe");
    const r3 = await agent.get("/probe");

    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.body).toMatchObject({
      error: "rate_limited",
      retryAfterSeconds: expect.any(Number),
    });
    expect(r3.headers["retry-after"]).toBeDefined();
  });

  it("never blocks /api/healthz even when the limit is hit", async () => {
    const app = express();
    app.use(
      "/api",
      buildLimiter({ name: "test-skip-health", windowMs: 60_000, limit: 1 }),
    );
    app.get("/api/healthz", (_req, res) => res.json({ status: "ok" }));
    app.get("/api/other", (_req, res) => res.json({ ok: true }));

    const agent = request(app);
    // Burn the budget against `/api/other`.
    await agent.get("/api/other");
    const blocked = await agent.get("/api/other");
    expect(blocked.status).toBe(429);
    // Now slam health — should be 200 every time.
    for (let i = 0; i < 5; i++) {
      const r = await agent.get("/api/healthz");
      expect(r.status).toBe(200);
    }
  });

  it("observe mode logs a would-block but lets the request through", async () => {
    setRuntimeMode("observe");
    const app = express();
    app.use(
      buildLimiter({ name: "test-observe", windowMs: 60_000, limit: 1 }),
    );
    app.get("/probe", (_req, res) => res.json({ ok: true }));

    const agent = request(app);
    const r1 = await agent.get("/probe");
    const r2 = await agent.get("/probe");
    const r3 = await agent.get("/probe");
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    // Observe mode lets it through — but also doesn't let it 429.
    expect(r3.status).toBe(200);
  });

  it("off mode is a no-op even when limit=1", async () => {
    setRuntimeMode("off");
    const app = express();
    app.use(buildLimiter({ name: "test-off", windowMs: 60_000, limit: 1 }));
    app.get("/probe", (_req, res) => res.json({ ok: true }));

    const agent = request(app);
    for (let i = 0; i < 5; i++) {
      const r = await agent.get("/probe");
      expect(r.status).toBe(200);
    }
  });

  // The per-subsystem enable flag is OWNED by each public factory wrapper
  // (publicIpLimiter / sessionLookupIpLimiter / pubkeyQuota), NOT by
  // buildLimiter. This decoupling is what lets an operator turn off per-IP
  // limits without also turning off per-pubkey quotas (and vice versa).
  it("publicIpLimiter respects VESSEL_RATE_LIMIT_ENABLED=false even in enforce mode", async () => {
    setEnabled(false);
    setRuntimeMode("enforce");
    const app = express();
    // Force a tight limit via env so we'd definitely 429 if the flag were
    // honored. The flag should win.
    process.env.VESSEL_RATE_LIMIT_PUBLIC_PER_WINDOW = "1";
    app.use(publicIpLimiter());
    app.get("/probe", (_req, res) => res.json({ ok: true }));

    const agent = request(app);
    for (let i = 0; i < 5; i++) {
      const r = await agent.get("/probe");
      expect(r.status).toBe(200);
    }
  });
});

describe("per-pubkey quota middleware", () => {
  // Tiny middleware that fakes the auth step by stamping a verified pubkey
  // onto the request — the same shape `requireSignedRequest` produces.
  function fakeAuthAs(pubkey: string) {
    return (req: express.Request, _res: express.Response, next: express.NextFunction) => {
      (req as unknown as { authPubkey: string }).authPubkey = pubkey;
      next();
    };
  }

  it("returns 429 with quota_exceeded body after N writes from the same pubkey", async () => {
    const app = express();
    app.use(fakeAuthAs("alice"));
    app.use(
      pubkeyQuota({
        name: "test-quota",
        windowMs: 60_000,
        limit: 2,
      }),
    );
    app.post("/write", (_req, res) => res.json({ ok: true }));

    const agent = request(app);
    const r1 = await agent.post("/write");
    const r2 = await agent.post("/write");
    const r3 = await agent.post("/write");
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
    expect(r3.status).toBe(429);
    expect(r3.body).toMatchObject({
      error: "quota_exceeded",
      retryAfterSeconds: expect.any(Number),
    });
  });

  it("disabled quota flag bypasses enforcement", async () => {
    setQuotaEnabled(false);
    const app = express();
    app.use(fakeAuthAs("bob"));
    app.use(
      pubkeyQuota({ name: "test-quota-off", windowMs: 60_000, limit: 1 }),
    );
    app.post("/write", (_req, res) => res.json({ ok: true }));

    const agent = request(app);
    for (let i = 0; i < 5; i++) {
      const r = await agent.post("/write");
      expect(r.status).toBe(200);
    }
  });
});

describe("global error handler", () => {
  it("returns generic JSON shape, no stack trace", async () => {
    const app = express();
    app.get("/boom", (_req, _res, next) =>
      next(new Error("internal stack with /home/runner/workspace path")),
    );
    app.use(errorHandler);

    const r = await request(app).get("/boom");
    expect(r.status).toBe(500);
    expect(r.body).toMatchObject({ error: "internal_error" });
    // The body MUST NOT carry the original message, stack frame, or path.
    const serialized = JSON.stringify(r.body);
    expect(serialized).not.toContain("internal stack");
    expect(serialized).not.toContain("/home/runner");
    expect(serialized).not.toContain("Error:");
    expect(serialized).not.toContain("at ");
  });

  it("does not surface forbidden internal vocabulary in error bodies", async () => {
    const app = express();
    // A library throwing with one of the forbidden internal terms should NOT
    // leak it through the generic error body.
    app.get("/leaky", (_req, _res, next) =>
      next(new Error("nostr relay mediarecorder webtransport")),
    );
    app.use(errorHandler);

    const r = await request(app).get("/leaky");
    const lower = JSON.stringify(r.body).toLowerCase();
    for (const term of [
      "nostr",
      "relay",
      "mediarecorder",
      "webtransport",
      "indexeddb",
    ]) {
      expect(lower, `error body leaked forbidden term "${term}"`).not.toContain(
        term,
      );
    }
  });
});

describe("404 handler", () => {
  it("returns generic not_found JSON for unknown routes", async () => {
    const app = express();
    app.get("/known", (_req, res) => res.json({ ok: true }));
    app.use(notFoundHandler);

    const r = await request(app).get("/definitely-not-a-route");
    expect(r.status).toBe(404);
    expect(r.body).toEqual({ error: "not_found" });
  });

  it("returns no body for HEAD per RFC 7231", async () => {
    const app = express();
    app.use(notFoundHandler);

    const r = await request(app).head("/missing");
    expect(r.status).toBe(404);
    // RFC 7231 forbids a body on HEAD responses. supertest exposes that as
    // an undefined `text` and an empty body — assert no payload of either
    // shape leaked through.
    expect(r.text === undefined || r.text === "").toBe(true);
    expect(r.body).toEqual({});
  });
});
