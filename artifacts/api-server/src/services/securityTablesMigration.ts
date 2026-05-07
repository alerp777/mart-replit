import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

let _migrated = false;

export async function ensureSecurityTables(): Promise<void> {
  if (_migrated) return;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS data_export_logs (
      id           TEXT PRIMARY KEY,
      user_id      TEXT REFERENCES users(id) ON DELETE SET NULL,
      ip           TEXT NOT NULL DEFAULT 'unknown',
      user_agent   TEXT,
      masked_phone TEXT,
      requested_at TIMESTAMP NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMP,
      success      BOOLEAN NOT NULL DEFAULT FALSE
    )
  `);

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_data_export_logs_user_id ON data_export_logs (user_id)
  `);
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS idx_data_export_logs_requested_at ON data_export_logs (requested_at DESC)
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sentry_known_issues (
      fingerprint   TEXT PRIMARY KEY,
      title         TEXT NOT NULL,
      sentry_id     TEXT,
      first_seen_at TIMESTAMP NOT NULL DEFAULT NOW(),
      last_seen_at  TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  _migrated = true;
}
