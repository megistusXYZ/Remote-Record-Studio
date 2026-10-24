import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

// The health route touches the database through the shared pool. Replace it
// so the suite needs no PostgreSQL and can make the database "fail".
const hoisted = vi.hoisted(() => ({
  query: vi.fn<(sql: string) => Promise<unknown>>(),
}));
vi.mock("@workspace/db", () => ({ pool: { query: hoisted.query } }));

import healthRouter from "../src/routes/health";

function app() {
  const a = express();
  a.use("/api", healthRouter);
  return a;
}

beforeEach(() => {
  hoisted.query.mockReset();
});

describe("GET /healthz", () => {
  it("reports ok and the server clock so clients can align recording start times", async () => {
    hoisted.query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    const before = Date.now();
    const res = await request(app()).get("/api/healthz");
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.nowMs).toBe("number");
    expect(res.body.nowMs).toBeGreaterThanOrEqual(before);
    expect(res.body.nowMs).toBeLessThanOrEqual(after);
    expect(hoisted.query).toHaveBeenCalledWith("select 1");
    expect(res.headers["cache-control"]).toBe("no-store");
  });

  it("goes red when the database does not answer", async () => {
    hoisted.query.mockRejectedValue(new Error("connection refused"));
    const res = await request(app()).get("/api/healthz");
    expect(res.status).toBe(503);
    expect(res.body.status).toBe("degraded");
    expect(typeof res.body.nowMs).toBe("number");
  });
});
