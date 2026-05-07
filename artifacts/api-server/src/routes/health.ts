import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { adminAuth } from "./admin-shared.js";
import { checkSchemaDrift } from "../services/schemaDrift.service.js";
import { redisClient } from "../lib/redis.js";

const router = Router();

const SERVER_EPOCH = Math.round(Date.now() / 1000 - process.uptime());

router.get("/", async (_req, res) => {
  let dbStatus: "ok" | "error" = "ok";
  let redisStatus: "ok" | "error" | "unavailable" = "unavailable";

  const DB_TIMEOUT_MS = 2000;
  const REDIS_TIMEOUT_MS = 2000;

  await Promise.allSettled([
    (async () => {
      try {
        await Promise.race([
          db.execute(sql`SELECT 1`),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("DB timeout")), DB_TIMEOUT_MS)
          ),
        ]);
        dbStatus = "ok";
      } catch {
        dbStatus = "error";
      }
    })(),
    (async () => {
      if (!redisClient) {
        redisStatus = "unavailable";
        return;
      }
      try {
        await Promise.race([
          redisClient.ping(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Redis timeout")), REDIS_TIMEOUT_MS)
          ),
        ]);
        redisStatus = "ok";
      } catch {
        redisStatus = "error";
      }
    })(),
  ]);

  const db2 = dbStatus as "ok" | "error";
  const redis2 = redisStatus as "ok" | "error" | "unavailable";
  const overallStatus: "ok" | "degraded" | "down" =
    db2 === "error" ? "down" : redis2 === "error" ? "degraded" : "ok";

  const httpStatus = (db2 === "error" || redis2 === "error") ? 503 : 200;

  res.status(httpStatus).json({
    status: overallStatus,
    db: db2,
    redis: redis2,
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    serverEpoch: SERVER_EPOCH,
  });
});

/**
 * GET /api/health/schema-drift
 * Admin-only endpoint that compares the Drizzle schema definition against the
 * live PostgreSQL database and reports any tables or columns that are defined
 * in code but missing from the database (crash risk), as well as extra tables
 * and columns that exist only in the database (informational).
 *
 * Returns HTTP 200 with { ok: true } when the DB fully matches the schema.
 * Returns HTTP 200 with { ok: false, ... } when drift is detected so callers
 * can distinguish "endpoint reachable" from "schema is clean" without relying
 * on HTTP status codes for alerting.
 */
router.get("/schema-drift", adminAuth, async (_req, res) => {
  try {
    const report = await checkSchemaDrift();
    res.json(report);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ ok: false, error: message });
  }
});

export default router;
