import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { pool } from "@workspace/db";

const router: IRouter = Router();

/** How long the database gets to answer before the check reports degraded. */
const DB_TIMEOUT_MS = 1500;

/**
 * One trivial round trip to PostgreSQL, bounded in time. A health check that
 * only proves the process is up would keep a deployment "green" while every
 * real request fails on a lost database; this one goes red with it.
 */
async function databaseReachable(): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      pool.query("select 1"),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("database health check timed out")),
          DB_TIMEOUT_MS,
        );
      }),
    ]);
    return true;
  } catch {
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * GET /healthz: 200 `{ status: "ok" }` when the process and its database
 * both answer, 503 `{ status: "degraded" }` otherwise. Never rate-limited,
 * never cached. `nowMs` is the server clock clients align recordings to.
 */
router.get("/healthz", async (_req, res) => {
  const ok = await databaseReachable();
  const data = HealthCheckResponse.parse({
    status: ok ? "ok" : "degraded",
    nowMs: Date.now(),
  });
  res.setHeader("Cache-Control", "no-store");
  res.status(ok ? 200 : 503).json(data);
});

export default router;
