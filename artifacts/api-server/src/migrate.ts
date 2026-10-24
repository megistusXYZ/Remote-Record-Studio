/**
 * Apply pending database migrations, then exit.
 *
 * Built into `dist/migrate.mjs` next to the server bundle and run once per
 * deploy, before the API starts (the `migrate` service in
 * deploy/compose.yaml). The SQL files come from `lib/db/drizzle`
 * (`pnpm db:generate` writes them from schema changes); the image copies
 * them to `dist/migrations`, and MIGRATIONS_DIR overrides that location.
 *
 * Idempotent: drizzle records applied migrations in `__drizzle_migrations`
 * and skips them next time. Exits non-zero on failure so the API never
 * starts against a schema it does not expect.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "@workspace/db";
import { logger } from "./lib/logger";

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder =
  process.env["MIGRATIONS_DIR"] ?? path.resolve(here, "migrations");

// The database may still be starting when this runs (compose waits for the
// health check, but a bare `docker run` or a slow disk may not). Retry
// connection-level failures for a while; anything else is a real error.
const MAX_ATTEMPTS = 15;
const RETRY_DELAY_MS = 2000;

function isConnectionError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return (
    code === "ECONNREFUSED" ||
    code === "ENOTFOUND" ||
    code === "EAI_AGAIN" ||
    code === "ETIMEDOUT" ||
    code === "57P03" // the database system is starting up
  );
}

async function main(): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      logger.info(
        { migrationsFolder, attempt },
        "Applying database migrations",
      );
      await migrate(db, { migrationsFolder });
      logger.info("Database migrations applied");
      return;
    } catch (err) {
      if (attempt < MAX_ATTEMPTS && isConnectionError(err)) {
        logger.warn({ err, attempt }, "Database not reachable yet; retrying");
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }
      throw err;
    }
  }
}

main()
  .then(() => pool.end())
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, "Database migration failed");
    process.exit(1);
  });
