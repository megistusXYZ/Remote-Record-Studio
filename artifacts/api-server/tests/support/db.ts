/**
 * A real PostgreSQL for route tests.
 *
 * Uses TEST_DATABASE_URL, defaulting to a `vessel_test` database on the dev
 * container from compose.yaml. The schema is created by the same SQL
 * migrations production runs, and every test starts from empty tables.
 *
 * Locally, when no database answers, suites that need one are skipped with
 * a note (start it with `pnpm dev:db`). In CI a missing database fails.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

export const TEST_DATABASE_URL =
  process.env["TEST_DATABASE_URL"] ??
  "postgresql://vessel:vessel@127.0.0.1:5434/vessel_test";

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS = path.resolve(here, "../../../../lib/db/drizzle");

export async function databaseAvailable(): Promise<boolean> {
  const client = new pg.Client({
    connectionString: TEST_DATABASE_URL,
    connectionTimeoutMillis: 1500,
  });
  try {
    await client.connect();
    await client.end();
    return true;
  } catch (err) {
    if (process.env["CI"]) throw err;
    console.warn(
      `[tests] No database at TEST_DATABASE_URL; skipping database suites. Start one with: pnpm dev:db`,
    );
    return false;
  }
}

/** Point the app at the test database, apply migrations, return the db module. */
export async function setUpDatabase() {
  process.env["DATABASE_URL"] = TEST_DATABASE_URL;
  const dbModule = await import("@workspace/db");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  await migrate(dbModule.db, { migrationsFolder: MIGRATIONS });
  return dbModule;
}

export async function truncateAll(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ tablename: string }>(
    "select tablename from pg_tables where schemaname = 'public'",
  );
  if (rows.length === 0) return;
  await pool.query(
    `truncate ${rows.map((r) => `"${r.tablename}"`).join(", ")} restart identity cascade`,
  );
}
