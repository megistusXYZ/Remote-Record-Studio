import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  // Generated SQL migrations. Production applies these (`pnpm db:migrate`,
  // or the `migrate` service in deploy/compose.yaml); `db:push` stays a
  // development shortcut.
  // Relative on purpose: drizzle-kit mangles absolute paths ("./" + abs).
  // Scripts run with lib/db as the working directory.
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
