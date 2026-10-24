import { describe, it, expect } from "vitest";
import express from "express";
import request from "supertest";
import healthRouter from "../src/routes/health";

describe("GET /healthz", () => {
  it("reports ok and the server clock so clients can align recording start times", async () => {
    const app = express();
    app.use("/api", healthRouter);
    const before = Date.now();
    const res = await request(app).get("/api/healthz");
    const after = Date.now();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(typeof res.body.nowMs).toBe("number");
    expect(res.body.nowMs).toBeGreaterThanOrEqual(before);
    expect(res.body.nowMs).toBeLessThanOrEqual(after);
  });
});
