import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity, RefreshCw, Server, Satellite, ShieldCheck,
  ToggleLeft, ToggleRight, AlertTriangle, CheckCircle2,
  Info, Wifi, WifiOff, Cpu, Database, Clock,
  Navigation, Eye, EyeOff, MessageSquare, Zap,
} from "lucide-react";
import { PageHeader } from "@/components/shared";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useHealthDashboard } from "@/hooks/use-admin";
import { Link } from "wouter";

/* ── helpers ── */
function updatedAgo(ts: string | undefined): string {
  if (!ts) return "";
  const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
  if (diff < 5) return "just now";
  if (diff < 60) return `${diff}s ago`;
  const m = Math.floor(diff / 60);
  return `${m}m ago`;
}

/* ── sub-components ── */
function StatusDot({ ok, warning }: { ok: boolean; warning?: boolean }) {
  const color = ok ? "bg-emerald-500" : warning ? "bg-amber-500" : "bg-red-500";
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${color} ${ok ? "" : "animate-pulse"}`} />
  );
}

function Pill({ on }: { on: boolean }) {
  return on ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 text-xs font-medium">
      <ToggleRight size={12} /> ON
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-xs font-medium">
      <ToggleLeft size={12} /> OFF
    </span>
  );
}

function IssueRow({ level, message }: { level: "error" | "warning" | "info"; message: string }) {
  const cfg = {
    error:   { icon: AlertTriangle,  bg: "bg-red-500/10 border-red-500/30",   text: "text-red-400",   label: "Error" },
    warning: { icon: AlertTriangle,  bg: "bg-amber-500/10 border-amber-500/30", text: "text-amber-400", label: "Warning" },
    info:    { icon: Info,           bg: "bg-blue-500/10 border-blue-500/30",  text: "text-blue-400",  label: "Info" },
  }[level];
  const Icon = cfg.icon;
  return (
    <div className={`flex items-start gap-3 px-4 py-3 rounded-xl border ${cfg.bg}`}>
      <Icon size={16} className={`${cfg.text} mt-0.5 shrink-0`} />
      <p className="text-sm text-slate-300 leading-snug">{message}</p>
    </div>
  );
}

function Section({ title, icon: Icon, children }: {
  title: string; icon: React.ElementType; children: React.ReactNode;
}) {
  return (
    <Card className="bg-slate-800/60 border-slate-700/50">
      <CardContent className="p-5">
        <div className="flex items-center gap-2 mb-4">
          <Icon size={16} className="text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wide">{title}</h2>
        </div>
        {children}
      </CardContent>
    </Card>
  );
}

function StatRow({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-slate-700/40 last:border-0">
      <div>
        <span className="text-sm text-slate-400">{label}</span>
        {hint && <p className="text-xs text-slate-600 mt-0.5">{hint}</p>}
      </div>
      <div className="text-sm font-medium text-slate-200">{value}</div>
    </div>
  );
}

const FEATURE_META: Record<string, { label: string; defaultOn: boolean }> = {
  mart:         { label: "Mart / Shopping",      defaultOn: true },
  food:         { label: "Food Delivery",         defaultOn: true },
  rides:        { label: "Ride Hailing",          defaultOn: true },
  pharmacy:     { label: "Pharmacy",              defaultOn: true },
  parcel:       { label: "Parcel Delivery",       defaultOn: true },
  van:          { label: "Van / Inter-city",      defaultOn: true },
  wallet:       { label: "Wallet",                defaultOn: true },
  referral:     { label: "Referral Program",      defaultOn: true },
  newUsers:     { label: "New Registrations",     defaultOn: true },
  chat:         { label: "In-app Chat",           defaultOn: false },
  liveTracking: { label: "Live GPS Tracking",     defaultOn: true },
  reviews:      { label: "Reviews & Ratings",     defaultOn: true },
  sos:          { label: "SOS Alerts",            defaultOn: true },
  weather:      { label: "Weather Widget",        defaultOn: true },
};

/* ── skeleton ── */
function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div className={`relative overflow-hidden bg-slate-700/40 rounded-lg ${className}`}>
      <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" />
    </div>
  );
}

/* ── main page ── */
export default function HealthDashboard() {
  const qc = useQueryClient();
  const { data: raw, isLoading, isFetching, dataUpdatedAt } = useHealthDashboard();

  const handleRefresh = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["admin-health-dashboard"] });
  }, [qc]);

  const d = raw as any;
  const hasIssues = d?.issues?.length > 0;
  const errorCount = (d?.issues ?? []).filter((i: any) => i.level === "error").length;
  const warnCount = (d?.issues ?? []).filter((i: any) => i.level === "warning").length;

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        title="Health Dashboard"
        description="Real-time status of GPS tracking, content moderation rules, and service feature flags"
        icon={Activity}
      >
        <div className="flex items-center gap-3">
          {dataUpdatedAt > 0 && (
            <span className="text-xs text-slate-500 hidden sm:block">
              Updated {updatedAgo(new Date(dataUpdatedAt).toISOString())}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={isFetching}
            className="gap-2 border-slate-600 bg-slate-800 text-slate-300 hover:bg-slate-700"
          >
            <RefreshCw size={14} className={isFetching ? "animate-spin" : ""} />
            Refresh
          </Button>
        </div>
      </PageHeader>

      {/* Issues banner */}
      {!isLoading && hasIssues && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/5 p-4 space-y-2">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={16} className="text-red-400" />
            <span className="text-sm font-semibold text-red-300">
              {errorCount > 0 ? `${errorCount} error${errorCount > 1 ? "s" : ""}` : ""}
              {errorCount > 0 && warnCount > 0 ? " · " : ""}
              {warnCount > 0 ? `${warnCount} warning${warnCount > 1 ? "s" : ""}` : ""}
              {" "}detected — review below
            </span>
          </div>
          {d.issues.map((issue: any, idx: number) => (
            <IssueRow key={idx} level={issue.level} message={issue.message} />
          ))}
        </div>
      )}

      {!isLoading && !hasIssues && d && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 flex items-center gap-2">
          <CheckCircle2 size={16} className="text-emerald-400" />
          <span className="text-sm text-emerald-300 font-medium">All systems healthy — no issues detected</span>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* ── Server Health ── */}
        <Section title="Server" icon={Server}>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <SkeletonBlock key={i} className="h-9" />)}
            </div>
          ) : (
            <div>
              <StatRow
                label="Status"
                value={
                  <span className="flex items-center gap-2">
                    <StatusDot ok={true} />
                    <span className="text-emerald-400">Running</span>
                  </span>
                }
              />
              <StatRow
                label="Database"
                value={
                  <span className="flex items-center gap-2">
                    <StatusDot ok={d?.server?.db === "ok"} />
                    <span className={d?.server?.db === "ok" ? "text-emerald-400" : "text-red-400"}>
                      {d?.server?.db === "ok" ? "Connected" : "Error"}
                    </span>
                  </span>
                }
              />
              <StatRow
                label="Uptime"
                value={
                  <span className="flex items-center gap-1.5">
                    <Clock size={13} className="text-slate-500" />
                    {d?.server?.uptimeFormatted ?? "—"}
                  </span>
                }
              />
              <StatRow
                label="Memory usage"
                value={
                  <span className="flex items-center gap-1.5">
                    <Cpu size={13} className="text-slate-500" />
                    {d?.server?.memoryMb != null ? `${d.server.memoryMb} MB` : "—"}
                  </span>
                }
              />
              <StatRow label="Node.js" value={d?.server?.nodeVersion ?? "—"} />
            </div>
          )}
        </Section>

        {/* ── GPS Tracking ── */}
        <Section title="GPS Tracking" icon={Satellite}>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <SkeletonBlock key={i} className="h-9" />)}
            </div>
          ) : (
            <div>
              <StatRow
                label="Live tracking feature"
                value={<Pill on={d?.gps?.liveTrackingEnabled ?? true} />}
              />
              <StatRow
                label="Riders in live table"
                value={
                  <span className="flex items-center gap-1.5">
                    <Navigation size={13} className="text-slate-500" />
                    {d?.gps?.ridersInLiveTable ?? 0}
                  </span>
                }
                hint="Riders currently marked online"
              />
              <StatRow
                label="Active pings (last 5 min)"
                value={
                  <span className={`flex items-center gap-2`}>
                    <StatusDot
                      ok={(d?.gps?.ridersWithRecentPing ?? 0) >= (d?.gps?.ridersInLiveTable ?? 0) || d?.gps?.ridersInLiveTable === 0}
                      warning={(d?.gps?.staleRiders ?? 0) > 0}
                    />
                    {d?.gps?.ridersWithRecentPing ?? 0}
                    {(d?.gps?.staleRiders ?? 0) > 0 && (
                      <span className="text-xs text-amber-400">({d.gps.staleRiders} stale)</span>
                    )}
                  </span>
                }
              />
              <StatRow
                label="GPS spoof detection"
                value={<Pill on={d?.gps?.spoofDetectionEnabled ?? true} />}
              />
              <StatRow
                label="Max allowed speed"
                value={`${d?.gps?.maxSpeedKmh ?? 150} km/h`}
                hint="Pings exceeding this trigger spoof alert"
              />
            </div>
          )}
          {!isLoading && (
            <div className="mt-3 pt-3 border-t border-slate-700/40">
              <Link href="/live-riders-map">
                <Button variant="ghost" size="sm" className="text-xs text-slate-400 hover:text-slate-200 px-0">
                  Open live riders map →
                </Button>
              </Link>
            </div>
          )}
        </Section>

        {/* ── Content Moderation ── */}
        <Section title="Content Moderation" icon={ShieldCheck}>
          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <SkeletonBlock key={i} className="h-9" />)}
            </div>
          ) : (
            <div>
              <StatRow
                label="Custom regex patterns"
                value={
                  <span className="flex items-center gap-2">
                    {d?.moderation?.customPatternsCount > 0 || !d?.moderation?.customPatternsValid === false ? (
                      <StatusDot ok={d?.moderation?.customPatternsValid !== false} />
                    ) : null}
                    {d?.moderation?.customPatternsCount ?? 0} loaded
                    {d?.moderation?.customPatternsValid === false && (
                      <Badge variant="destructive" className="text-xs">Malformed JSON</Badge>
                    )}
                  </span>
                }
                hint="Admin-configured regex rules for chat/messages"
              />
              <StatRow
                label="Flag keywords"
                value={
                  <span className="flex items-center gap-1.5">
                    <MessageSquare size={13} className="text-slate-500" />
                    {d?.moderation?.flagKeywordsCount ?? 0} words
                  </span>
                }
              />
              <StatRow label="Mask phone numbers" value={
                <span className="flex items-center gap-1.5">
                  {d?.moderation?.hidePhone ? <Eye size={13} className="text-emerald-500" /> : <EyeOff size={13} className="text-red-500" />}
                  <Pill on={d?.moderation?.hidePhone ?? true} />
                </span>
              } />
              <StatRow label="Mask email addresses" value={<Pill on={d?.moderation?.hideEmail ?? true} />} />
              <StatRow label="Mask CNIC numbers" value={<Pill on={d?.moderation?.hideCnic ?? true} />} />
              <StatRow label="Mask bank accounts" value={<Pill on={d?.moderation?.hideBank ?? true} />} />
              <StatRow label="Mask addresses" value={<Pill on={d?.moderation?.hideAddress ?? false} />} />
            </div>
          )}
          {!isLoading && (
            <div className="mt-3 pt-3 border-t border-slate-700/40">
              <Link href="/settings/moderation">
                <Button variant="ghost" size="sm" className="text-xs text-slate-400 hover:text-slate-200 px-0">
                  Edit moderation settings →
                </Button>
              </Link>
            </div>
          )}
        </Section>

        {/* ── Feature Flags ── */}
        <Section title="Service Feature Flags" icon={Zap}>
          {isLoading ? (
            <div className="grid grid-cols-2 gap-2">
              {[...Array(14)].map((_, i) => <SkeletonBlock key={i} className="h-10" />)}
            </div>
          ) : (
            <>
              {d?.maintenanceMode && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center gap-2">
                  <AlertTriangle size={13} className="text-amber-400 shrink-0" />
                  <span className="text-xs text-amber-300">Maintenance mode is active — app is inaccessible to customers</span>
                </div>
              )}
              <div className="grid grid-cols-1 gap-0">
                {Object.entries(d?.features ?? {}).map(([key, enabled]) => {
                  const meta = FEATURE_META[key] ?? { label: key, defaultOn: true };
                  const isOn = enabled as boolean;
                  const isUnexpectedlyOff = meta.defaultOn && !isOn;
                  return (
                    <div
                      key={key}
                      className={`flex items-center justify-between py-2 px-0 border-b border-slate-700/30 last:border-0 ${isUnexpectedlyOff ? "opacity-80" : ""}`}
                    >
                      <span className={`text-sm ${isOn ? "text-slate-300" : "text-slate-500"}`}>
                        {meta.label}
                      </span>
                      <Pill on={isOn} />
                    </div>
                  );
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-700/40">
                <Link href="/app-management">
                  <Button variant="ghost" size="sm" className="text-xs text-slate-400 hover:text-slate-200 px-0">
                    Manage feature flags →
                  </Button>
                </Link>
              </div>
            </>
          )}
        </Section>
      </div>

      {/* auto-refresh notice */}
      <p className="text-center text-xs text-slate-600">
        Auto-refreshes every 30 seconds · Last updated {dataUpdatedAt > 0 ? updatedAgo(new Date(dataUpdatedAt).toISOString()) : "—"}
      </p>
    </div>
  );
}
