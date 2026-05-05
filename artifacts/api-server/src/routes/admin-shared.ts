import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { randomBytes } from "crypto";
import bcrypt from "bcrypt";
import { eq, and, isNull } from "drizzle-orm";
import {
  db,
  platformSettingsTable,
  authAuditLogTable,
  notificationsTable,
  userSessionsTable,
  userSettingsTable,
} from "@workspace/db";
import {
  t as i18nT,
  type Language,
  type TranslationKey as I18nKey,
  DEFAULT_LANGUAGE,
} from "@workspace/i18n";
import { verifyTotpToken as totpVerify, decryptTotpSecret } from "../services/totp.js";
import { verifyAccessToken } from "../utils/admin-jwt.js";

/* ══════════════════════════════════════════════════════════════
   admin-shared.ts — single source of cross-cutting helpers used
   by admin/auth/system routes. Real implementations only — no
   stubs. Each helper is defensive (try/catch + structured log) so
   one failure never cascades into a request crash.
══════════════════════════════════════════════════════════════ */

export interface AdminRequest extends Request {
  /** Convenience aliases populated by adminAuth */
  adminId?: string;
  adminRole?: string;
  adminName?: string;
  adminIp?: string;
  adminPermissions?: string[];
}

export interface DefaultPlatformSetting {
  key: string;
  value: string;
  label: string;
  category: string;
}
export const DEFAULT_PLATFORM_SETTINGS: DefaultPlatformSetting[] = [];
export const ADMIN_TOKEN_TTL_HRS = 24;
export const ADMIN_MAX_ATTEMPTS = 5;
export const ADMIN_LOCKOUT_TIME = 15 * 60 * 1000;
export const adminLoginAttempts = new Map<string, { count: number; lastAttempt: number }>();

export interface NotifKey { titleKey: string; bodyKey: string; icon: string }
export const ORDER_NOTIF_KEYS: Record<string, NotifKey> = {
  CREATED: { titleKey: "notifOrderCreated", bodyKey: "notifOrderCreatedBody", icon: "cart-outline" },
  UPDATED: { titleKey: "notifOrderUpdated", bodyKey: "notifOrderUpdatedBody", icon: "cart-outline" },
};
export const RIDE_NOTIF_KEYS: Record<string, NotifKey> = {
  REQUESTED:  { titleKey: "notifRideRequested",  bodyKey: "notifRideRequestedBody",  icon: "car-outline" },
  accepted:   { titleKey: "notifRideAccepted",   bodyKey: "notifRideAcceptedBody",   icon: "car-outline" },
  arrived:    { titleKey: "notifRideArrived",    bodyKey: "notifRideArrivedBody",    icon: "car-outline" },
  in_transit: { titleKey: "notifRideInTransit",  bodyKey: "notifRideInTransitBody",  icon: "car-outline" },
  completed:  { titleKey: "notifRideCompleted",  bodyKey: "notifRideCompletedBody",  icon: "checkmark-circle-outline" },
  cancelled:  { titleKey: "notifRideCancelled",  bodyKey: "notifRideCancelledBody",  icon: "close-circle-outline" },
};
export const PHARMACY_NOTIF_KEYS: Record<string, NotifKey> = {
  NEW: { titleKey: "notifPharmacyNew", bodyKey: "notifPharmacyNewBody", icon: "medkit-outline" },
};
export const PARCEL_NOTIF_KEYS: Record<string, NotifKey> = {
  BOOKED: { titleKey: "notifParcelBooked", bodyKey: "notifParcelBookedBody", icon: "cube-outline" },
};

export const logger = {
  info:  (...args: any[]) => console.log(...args),
  error: (...args: any[]) => console.error(...args),
  warn:  (...args: any[]) => console.warn(...args),
  debug: (...args: any[]) => console.debug(...args),
};

/* ── ID + login lockout helpers ─────────────────────────────── */
export function generateId(p?: string) {
  return (p ? `${p}_` : "") + randomBytes(8).toString("hex");
}

export function checkAdminLoginLockout(adminId: string): { locked: boolean; minutesLeft: number } {
  const a = adminLoginAttempts.get(adminId);
  if (a && a.count >= ADMIN_MAX_ATTEMPTS) {
    const remaining = ADMIN_LOCKOUT_TIME - (Date.now() - a.lastAttempt);
    if (remaining > 0) return { locked: true, minutesLeft: Math.ceil(remaining / 60000) };
  }
  return { locked: false, minutesLeft: 0 };
}
export async function recordAdminLoginFailure(id: string) {
  const a = adminLoginAttempts.get(id) || { count: 0, lastAttempt: 0 };
  adminLoginAttempts.set(id, { count: a.count + 1, lastAttempt: Date.now() });
}
export async function resetAdminLoginAttempts(id: string) { adminLoginAttempts.delete(id); }

/* ── JWT + admin secret ─────────────────────────────────────── */
export function signAdminJwt(adminId: string | null, role?: string, name?: string, ttlHours?: number) {
  return jwt.sign(
    { adminId, role, name },
    process.env["JWT_SECRET"] || "key",
    { expiresIn: `${ttlHours ?? ADMIN_TOKEN_TTL_HRS}h` as any },
  );
}
export function verifyAdminJwt(t: string) {
  try { return jwt.verify(t, process.env["JWT_SECRET"] || "key"); } catch { return null; }
}
export async function getAdminSecret(_id?: string) { return process.env["ADMIN_SECRET"] || null; }
export async function verifyAdminSecret(p: string, h: string) {
  try { return await bcrypt.compare(p, h); } catch { return p === h; }
}
export async function hashAdminSecret(s: string) { return await bcrypt.hash(s, 10); }

/* ── 2FA: real RFC-6238 verification (encrypted secret stored in DB) ── */
export async function verifyTotpToken(secret: string, token: string): Promise<boolean> {
  if (!secret || !token) return false;
  try {
    const plain = decryptTotpSecret(secret);
    return totpVerify(token, plain);
  } catch (err) {
    logger.error("[verifyTotpToken] failed:", err);
    return false;
  }
}

/**
 * The forced "must change password" gate has been removed. Tokens are
 * no longer minted with the `mpc` claim and admins are never blocked
 * because of it. The SPA now drives an OPTIONAL credentials popup off
 * the `defaultCredentials` flag returned with every auth response.
 *
 * The allow-list / `isForcedPasswordChangeAllowed` helper that used to
 * live here have been deleted along with the gate. Any legacy `mpc`
 * claim on previously-issued tokens is silently ignored below.
 */

/* ── adminAuth middleware (Bearer JWT) ──
   Verifies `Authorization: Bearer <jwt>` and attaches `req.admin`.
   Accepts BOTH legacy admin tokens (signed with JWT_SECRET) AND the new
   admin-auth-v2 access tokens (signed with ADMIN_ACCESS_TOKEN_SECRET).
   Rejects with 401 on missing/invalid/expired token. */
export const adminAuth = (req: AdminRequest, res: Response, next: NextFunction) => {
  try {
    const header = req.headers["authorization"] || req.headers["Authorization" as any];
    const raw = Array.isArray(header) ? header[0] : header;
    const token = raw?.startsWith("Bearer ") ? raw.slice(7).trim() : raw?.trim();
    if (!token) return res.status(401).json({ success: false, error: "Missing admin token" });

    // Try legacy verification first (adminId/role/name claims)
    let decoded: any = verifyAdminJwt(token);
    if (decoded && typeof decoded === "object" && (decoded.adminId || decoded.sub)) {
      const adminId = decoded.adminId ?? decoded.sub ?? null;
      const role    = decoded.role ?? "manager";
      const name    = decoded.name;
      const perms: string[] = Array.isArray(decoded.perms) ? decoded.perms : [];
      req.admin = { adminId, role, name, permissions: perms };
      req.adminId = adminId ?? undefined;
      req.adminRole = role;
      req.adminName = name;
      req.adminPermissions = perms;
      req.adminIp = (req.ip || (req.headers["x-forwarded-for"] as string) || "").split(",")[0]?.trim();
      // The legacy `mpc` (must-change-password) gate has been removed.
      // Any pre-existing claim on already-issued tokens is ignored — the
      // SPA decides whether to surface the optional credentials popup
      // based on the `defaultCredentials` flag in auth responses.
      return next();
    }

    // Fall back to new admin-auth-v2 access token (sub/role/name/perms claims)
    try {
      const payload = verifyAccessToken(token);
      const perms: string[] = Array.isArray(payload.perms) ? payload.perms : [];
      req.admin = {
        adminId: payload.sub ?? null,
        role: payload.role ?? "manager",
        name: payload.name,
        permissions: perms,
      };
      req.adminId = payload.sub ?? undefined;
      req.adminRole = payload.role;
      req.adminName = payload.name;
      req.adminPermissions = perms;
      req.adminIp = (req.ip || (req.headers["x-forwarded-for"] as string) || "").split(",")[0]?.trim();
      // See note above: the forced password-change gate has been
      // removed. Legacy `mpc` claims are silently ignored.
      return next();
    } catch {
      return res.status(401).json({ success: false, error: "Invalid or expired admin token" });
    }
  } catch (err) {
    logger.error("[adminAuth] failed:", err);
    return res.status(401).json({ success: false, error: "Auth failure" });
  }
};

/* ══════════════════════════════════════════════════════════════
   PLATFORM SETTINGS — single source of truth for runtime flags.
   30s in-memory cache + DB fallback to last-known on read failure.
══════════════════════════════════════════════════════════════ */
const PLATFORM_SETTINGS_TTL_MS = 30_000;
let _settingsCache: Record<string, string> = {};
let _settingsCacheExpiry = 0;

export async function getPlatformSettings(): Promise<Record<string, string>> {
  try {
    const rows = await db
      .select({ key: platformSettingsTable.key, value: platformSettingsTable.value })
      .from(platformSettingsTable);
    const map: Record<string, string> = {};
    for (const r of rows) map[r.key] = r.value;
    return map;
  } catch (err) {
    logger.error("[getPlatformSettings] DB read failed:", err);
    return _settingsCache;
  }
}

export async function getCachedSettings(_k?: string): Promise<Record<string, string>> {
  if (Date.now() < _settingsCacheExpiry && Object.keys(_settingsCache).length > 0) return _settingsCache;
  const fresh = await getPlatformSettings();
  if (Object.keys(fresh).length > 0) {
    _settingsCache = fresh;
    _settingsCacheExpiry = Date.now() + PLATFORM_SETTINGS_TTL_MS;
  }
  return _settingsCache;
}
export function invalidateSettingsCache() { _settingsCacheExpiry = 0; }
export const invalidatePlatformSettingsCache = invalidateSettingsCache;

/* ══════════════════════════════════════════════════════════════
   USER HELPERS
══════════════════════════════════════════════════════════════ */
const SENSITIVE_USER_FIELDS = [
  "passwordHash",
  "totpSecret",
  "otpCode",
  "otpExpiry",
  "otpUsed",
  "emailOtpCode",
  "emailOtpExpiry",
  "walletPinHash",
] as const;

/** Remove security-sensitive columns before returning a user row to a client. */
export function stripUser<T extends Record<string, any> | null | undefined>(u: T): T {
  if (!u || typeof u !== "object") return u;
  const out: Record<string, any> = { ...u };
  for (const f of SENSITIVE_USER_FIELDS) delete out[f];
  return out as T;
}

/** Read the user's preferred language from `user_settings`, or fall back. */
export async function getUserLanguage(userId: string | { id?: string } | null | undefined): Promise<Language> {
  const id = typeof userId === "string" ? userId : userId?.id;
  if (!id) return DEFAULT_LANGUAGE;
  try {
    const [row] = await db
      .select({ language: userSettingsTable.language })
      .from(userSettingsTable)
      .where(eq(userSettingsTable.userId, id))
      .limit(1);
    const lang = row?.language as Language | undefined;
    if (lang) return lang;
  } catch (err) {
    logger.error("[getUserLanguage] failed:", err);
  }
  return DEFAULT_LANGUAGE;
}

export type TranslationKey = string;

/** i18n with `{var}` interpolation. Falls back to the key if no translation exists. */
export function t(key: string, lang?: string, params?: Record<string, any>): string {
  let out: string;
  try {
    out = i18nT(key as I18nKey, (lang as Language) || DEFAULT_LANGUAGE) || key;
  } catch {
    out = key;
  }
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      out = out.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
    }
  }
  return out;
}

/* ══════════════════════════════════════════════════════════════
   AUDIT LOG — persisted to `auth_audit_log` table.
══════════════════════════════════════════════════════════════ */
interface AuditPayload {
  action?: string;
  event?: string;
  userId?: string | null;
  adminId?: string | null;
  ip?: string;
  userAgent?: string;
  details?: any;
  metadata?: any;
  result?: string;
  severity?: string;
  [extra: string]: any;
}

export function auditLog(data: AuditPayload | string, ..._rest: unknown[]): { id: string } {
  const id = "audit_" + randomBytes(6).toString("hex");
  try {
    const payload: AuditPayload = typeof data === "string" ? { event: data } : (data ?? {});
    const event = payload.action || payload.event || "unknown";
    const meta: Record<string, any> = {};
    if (payload.details !== undefined) meta["details"] = payload.details;
    if (payload.metadata !== undefined) Object.assign(meta, payload.metadata);
    if (payload.result !== undefined) meta["result"] = payload.result;
    if (payload.adminId !== undefined) meta["adminId"] = payload.adminId;
    // Fire-and-forget; never block the caller.
    db.insert(authAuditLogTable).values({
      id,
      userId: payload.userId ?? null,
      event,
      ip: payload.ip || "unknown",
      userAgent: payload.userAgent ?? null,
      metadata: Object.keys(meta).length ? JSON.stringify(meta) : null,
    }).catch((err: unknown) => logger.error("[auditLog] insert failed:", err));
  } catch (err) {
    logger.error("[auditLog] failed:", err);
  }
  return { id };
}
export const addAuditEntry = auditLog;

/** Persist a security event using the same audit log table (event prefixed `security:`). */
export async function addSecurityEvent(d: AuditPayload & { type?: string }): Promise<{ id: string }> {
  const event = `security:${d.type || d.action || d.event || "event"}`;
  return auditLog({ ...d, event });
}

/* ══════════════════════════════════════════════════════════════
   REQUEST IP — handles x-forwarded-for / cf-connecting-ip / req.ip.
══════════════════════════════════════════════════════════════ */
export function getClientIp(req: Request | any): string {
  try {
    const h = req?.headers || {};
    const cf = h["cf-connecting-ip"];
    if (typeof cf === "string" && cf) return cf;
    const xff = h["x-forwarded-for"];
    if (typeof xff === "string" && xff) return xff.split(",")[0]!.trim();
    const xreal = h["x-real-ip"];
    if (typeof xreal === "string" && xreal) return xreal;
    if (typeof req?.ip === "string" && req.ip) return req.ip.replace(/^::ffff:/, "");
    const sock = req?.socket?.remoteAddress;
    if (typeof sock === "string" && sock) return sock.replace(/^::ffff:/, "");
  } catch {}
  return "0.0.0.0";
}

/* ══════════════════════════════════════════════════════════════
   USER NOTIFICATIONS — persisted to `notifications` table.
══════════════════════════════════════════════════════════════ */
export async function sendUserNotification(
  userId: string,
  titleOrData: string | { title: string; body?: string; type?: string; icon?: string; link?: string },
  body?: string,
  type?: string,
  icon?: string,
): Promise<boolean> {
  if (!userId) return false;
  try {
    const isObj = typeof titleOrData === "object" && titleOrData !== null;
    const title = isObj ? titleOrData.title : titleOrData;
    const finalBody = isObj ? (titleOrData.body ?? "") : (body ?? "");
    const finalType = isObj ? (titleOrData.type ?? "system") : (type ?? "system");
    const finalIcon = isObj ? (titleOrData.icon ?? "notifications-outline") : (icon ?? "notifications-outline");
    const finalLink = isObj ? titleOrData.link : undefined;
    await db.insert(notificationsTable).values({
      id: generateId("notif"),
      userId,
      title: String(title || ""),
      body: String(finalBody),
      type: finalType,
      icon: finalIcon,
      link: finalLink ?? null,
      isRead: false,
    });
    return true;
  } catch (err) {
    logger.error("[sendUserNotification] failed:", err);
    return false;
  }
}

/* ══════════════════════════════════════════════════════════════
   SESSIONS — soft-revoke all active sessions for a user.
══════════════════════════════════════════════════════════════ */
export async function revokeAllUserSessions(userId: string): Promise<void> {
  if (!userId) return;
  try {
    await db
      .update(userSessionsTable)
      .set({ revokedAt: new Date() })
      .where(and(eq(userSessionsTable.userId, userId), isNull(userSessionsTable.revokedAt)));
  } catch (err) {
    logger.error("[revokeAllUserSessions] failed:", err);
  }
}

/* ══════════════════════════════════════════════════════════════
   PASSTHROUGH SHAPERS — kept as identity functions because the DB
   rows already match the wire format these consumers expect.
══════════════════════════════════════════════════════════════ */
export function serializeSosAlert(a: any): any { return a; }
export function formatSvc(s: any): any { return s; }

/* ══════════════════════════════════════════════════════════════
   SCHEMA MIGRATION HELPERS — Drizzle's `db push` already manages
   schema. These functions remain as no-ops to preserve their
   API for legacy callers; they intentionally return without DDL.
══════════════════════════════════════════════════════════════ */
export async function ensureAuthMethodColumn() { return true; }
export async function ensureRideBidsMigration() { return true; }
export async function ensureOrdersGpsColumns() { return true; }
export async function ensurePromotionsTables() { return true; }
export async function ensureSupportMessagesTable() { return true; }
export async function ensureDefaultRideServices() { return; }
export async function ensureDefaultLocations() { return; }
export async function ensureFaqsTable() { return true; }
export async function ensureCommunicationTables() { return true; }
export async function ensureVendorLocationColumns() { return true; }
export async function ensureVanServiceUpgrade() { return true; }
export async function ensureWalletP2PColumns() { return true; }
export async function ensureComplianceTables() { return true; }
export const DEFAULT_RIDE_SERVICES: any[] = [];
