/**
 * Migration wrapper — runs drizzle-kit migrate against the DATABASE_URL.
 * Handles the case where the schema was already applied via `drizzle-kit push`
 * (idempotent — exits 0 if all types/tables already exist).
 *
 * Usage (from workspace root):
 *   pnpm db:migrate
 */
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_DIR = path.resolve(__dirname, "../lib/db");
const BIN =
  path.resolve(__dirname, "../lib/db/node_modules/.bin/drizzle-kit");

console.log("[db:migrate] Running Drizzle migrations…");
console.log(`[db:migrate] DB dir: ${DB_DIR}`);

try {
  const result = execSync(
    `"${BIN}" migrate --config ./drizzle.config.ts`,
    { cwd: DB_DIR, stdio: "pipe", encoding: "utf8" }
  );
  console.log("[db:migrate] ✅ Migrations applied successfully:");
  console.log(result);
} catch (err) {
  const msg = String(err.stderr || err.stdout || err.message || err);

  const alreadyApplied =
    msg.includes("already exists") ||
    msg.includes("No migrations to run") ||
    msg.includes("nothing to migrate");

  if (alreadyApplied) {
    console.log("[db:migrate] ✅ Schema already up-to-date — no migrations needed.");
    process.exit(0);
  }

  console.error("[db:migrate] ❌ Migration failed:\n" + msg);
  process.exit(1);
}
