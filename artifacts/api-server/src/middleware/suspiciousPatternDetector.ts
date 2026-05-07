import type { Request, Response, NextFunction } from "express";
import { addSecurityEvent, getClientIp } from "./security.js";
import { getCachedSettings } from "../routes/admin-shared.js";
import { sendAdminAlert } from "../services/email.js";
import { logger } from "../lib/logger.js";

/* ═══════════════════════════════════════════════════════════════
   suspiciousPatternDetector.ts
   In-memory sliding-window rate tracker for sensitive path prefixes.
   When an IP exceeds the configured threshold on sensitive paths
   within a 1-minute window, a security event is recorded and an
   email + Slack alert is fired (rate-limited by the snooze period).
═══════════════════════════════════════════════════════════════ */

// These prefixes are matched against req.originalUrl (full path including /api mount prefix).
const SENSITIVE_PREFIXES = [
  "/api/auth",
  "/api/users/lookup",
  "/api/admin",
];

interface WindowEntry {
  count: number;
  windowStart: number;
}

const ipWindows = new Map<string, WindowEntry>();

const lastAlertMs = new Map<string, number>();

let cleanupTimer: ReturnType<typeof setInterval> | null = null;

function ensureCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const cutoff = Date.now() - 5 * 60 * 1000;
    for (const [ip, entry] of ipWindows.entries()) {
      if (entry.windowStart < cutoff) ipWindows.delete(ip);
    }
  }, 60_000);
  if (cleanupTimer && typeof cleanupTimer === "object" && "unref" in cleanupTimer) {
    (cleanupTimer as NodeJS.Timeout).unref();
  }
}

async function firePatternAlert(ip: string, count: number, threshold: number, settings: Record<string, string>) {
  const snoozeMin = Math.max(1, parseInt(settings["health_monitor_snooze_min"] ?? "60", 10));
  const snoozeMs  = snoozeMin * 60 * 1000;
  const now = Date.now();

  const lastSent = lastAlertMs.get(ip) ?? 0;
  if (now - lastSent < snoozeMs) return;
  lastAlertMs.set(ip, now);

  const appName    = settings["app_name"] ?? "AJKMart";
  const adminUrl   = (settings["admin_base_url"] ?? settings["app_base_url"] ?? "").replace(/\/$/, "");
  // Build the dashboard link once — do NOT append /security again in the href below.
  const dashLink   = adminUrl ? `${adminUrl}/admin/security` : "";

  const subject  = `Suspicious API Pattern Detected — IP ${ip}`;
  const htmlBody = `
    <h3 style="color:#dc2626;margin:0 0 12px;">🚨 Suspicious API Enumeration Detected</h3>
    <p style="color:#374151;margin:0 0 16px;">
      A single IP address has made <strong>${count} requests</strong> to sensitive API endpoints
      within one minute — exceeding the threshold of <strong>${threshold} req/min</strong>.
    </p>
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr><td style="padding:6px 0;color:#6b7280;width:140px;">IP Address</td>
          <td style="padding:6px 0;font-weight:bold;font-family:monospace;">${ip}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Request count</td>
          <td style="padding:6px 0;font-weight:bold;color:#dc2626;">${count} in 1 min</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Threshold</td>
          <td style="padding:6px 0;">${threshold} req/min</td></tr>
      <tr><td style="padding:6px 0;color:#6b7280;">Detected at</td>
          <td style="padding:6px 0;">${new Date().toUTCString()}</td></tr>
    </table>
    ${dashLink ? `<p style="margin:0 0 16px;">
      <a href="${dashLink}" style="background:#1e40af;color:#fff;padding:10px 18px;
         border-radius:6px;text-decoration:none;font-size:14px;font-weight:600;display:inline-block;">
        View Security Dashboard →
      </a></p>` : ""}
    <p style="color:#6b7280;font-size:12px;margin:0;">
      This alert will not repeat for ${snoozeMin} minute${snoozeMin === 1 ? "" : "s"} for this IP.
    </p>
  `;

  try {
    await sendAdminAlert("security_pattern", subject, htmlBody, settings);
  } catch (err: any) {
    logger.warn({ ip, err: err.message }, "[pattern-detector] Alert send failed");
  }

  const slackWebhook = settings["health_alert_slack_webhook"]?.trim() ?? "";
  if (slackWebhook) {
    const payload = {
      text: `🚨 ${appName} — Suspicious API Pattern: IP ${ip} sent ${count} requests to sensitive endpoints in 1 min (threshold: ${threshold})`,
    };
    fetch(slackWebhook, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(payload),
    }).catch((e: Error) => logger.warn({ err: e.message }, "[pattern-detector] Slack webhook failed"));
  }
}

export function suspiciousPatternDetector(req: Request, _res: Response, next: NextFunction): void {
  // Use originalUrl so matching works regardless of where this middleware is mounted.
  // req.path is stripped of the mount prefix (/api), so "/api/auth" would not match.
  const urlPath = req.originalUrl.split("?")[0];
  const isSensitive = SENSITIVE_PREFIXES.some(prefix => urlPath.startsWith(prefix));
  if (!isSensitive) { next(); return; }

  const ip  = getClientIp(req);
  const now = Date.now();

  let entry = ipWindows.get(ip);
  if (!entry || now - entry.windowStart > 60_000) {
    entry = { count: 1, windowStart: now };
    ipWindows.set(ip, entry);
  } else {
    entry.count++;
  }

  getCachedSettings().then(settings => {
    const threshold = Math.max(1, parseInt(settings["security_suspicious_pattern_threshold"] ?? "60", 10));
    if (entry!.count === threshold + 1) {
      const details = `IP ${ip} exceeded sensitive endpoint threshold: ${entry!.count} req/min (threshold: ${threshold})`;
      addSecurityEvent({
        type:     "suspicious_pattern",
        ip,
        details,
        severity: "high",
      });
      logger.warn({ ip, count: entry!.count, threshold }, "[pattern-detector] Suspicious pattern detected");
      firePatternAlert(ip, entry!.count, threshold, settings).catch(() => {});
    }
  }).catch(() => {});

  ensureCleanup();
  next();
}
