/**
 * envValidation — startup audit of the `import.meta.env` values the
 * admin assumes exist. Logs (does not throw) so a missing value falls
 * back to its default but is observable in the browser console. Called
 * once from App.tsx on mount.
 *
 * Vite always injects `BASE_URL`, `MODE`, `DEV`, `PROD`, `SSR` so they
 * are checked unconditionally. `VITE_*` keys are scanned dynamically:
 * the admin currently exposes none, but if any future code adds one and
 * forgets to populate it in `.env`, the audit will surface it as a
 * single grouped warning instead of a runtime `undefined`.
 */

interface EnvAuditResult {
  baseUrl: string;
  mode: string;
  warnings: string[];
}

export function auditAdminEnv(): EnvAuditResult {
  const warnings: string[] = [];
  const env = import.meta.env as Record<string, unknown>;

  /* ── Built-in Vite keys ─────────────────────────────────────────── */
  const baseUrl =
    typeof env.BASE_URL === "string" && (env.BASE_URL as string).length > 0
      ? (env.BASE_URL as string)
      : "/";
  if (env.BASE_URL == null) {
    warnings.push("BASE_URL missing — defaulting to '/'");
  } else if (typeof env.BASE_URL !== "string") {
    warnings.push(
      `BASE_URL has unexpected type ${typeof env.BASE_URL} — defaulting to '/'`,
    );
  }

  const mode = typeof env.MODE === "string" ? (env.MODE as string) : "production";
  if (typeof env.MODE !== "string") {
    warnings.push("MODE missing or non-string — defaulting to 'production'");
  }
  if (env.DEV !== undefined && typeof env.DEV !== "boolean") {
    warnings.push("DEV has unexpected type — expected boolean");
  }
  if (env.PROD !== undefined && typeof env.PROD !== "boolean") {
    warnings.push("PROD has unexpected type — expected boolean");
  }

  /* ── User-defined VITE_* keys ───────────────────────────────────── */
  // Walk every VITE_-prefixed entry and warn if any is declared in
  // `.env*` but resolved to an empty / non-string value at build time.
  // Optional keys (consumed via fallbacks) are skipped from the warning
  // sweep — only declared but malformed keys surface.
  const OPTIONAL_VITE_KEYS = new Set([
    /* `error-reporter.ts#getApiBase()` falls back to
       `window.location.origin/api` when this is not set. */
    "VITE_API_BASE_URL",
  ]);
  const viteKeys = Object.keys(env).filter(k => k.startsWith("VITE_"));
  for (const key of viteKeys) {
    const v = env[key];
    if (v === undefined || v === null || v === "") {
      if (!OPTIONAL_VITE_KEYS.has(key)) {
        warnings.push(`${key} is empty — consumers may receive undefined`);
      }
    } else if (typeof v !== "string") {
      warnings.push(`${key} has unexpected type ${typeof v} — expected string`);
    }
  }

  /* `VITE_API_BASE_URL` validation: when present it must be an absolute URL. */
  const apiBase = env.VITE_API_BASE_URL;
  if (typeof apiBase === "string" && apiBase.trim()) {
    try {
      new URL(apiBase.trim());
    } catch {
      warnings.push(
        `VITE_API_BASE_URL is not a valid absolute URL — falling back to window.location.origin/api`,
      );
    }
  }

  /* ── Single grouped warning ─────────────────────────────────────── */
  if (warnings.length > 0) {
    console.groupCollapsed(
      `[envValidation] ${warnings.length} environment issue(s) detected`,
    );
    for (const w of warnings) console.warn(w);
    console.groupEnd();
  }

  return { baseUrl, mode, warnings };
}
