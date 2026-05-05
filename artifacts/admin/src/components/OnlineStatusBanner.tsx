import { useEffect, useState } from "react";
import { WifiOff } from "lucide-react";

/**
 * OnlineStatusBanner — explicit "you are offline" indicator that watches
 * `navigator.onLine` and the `online` / `offline` window events.
 *
 * The admin panel is intentionally an online-only product (it operates on
 * live moderation data, see the explanation under "Offline/PWA Issues" in
 * `bugs.md`). Rather than ship an offline cache, we surface a clear
 * banner so admins immediately understand why writes are failing.
 *
 * Renders nothing when online — zero layout impact in the happy path.
 */
export function OnlineStatusBanner() {
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );

  useEffect(() => {
    if (typeof window === "undefined") return;
    const goOnline = () => setIsOnline(true);
    const goOffline = () => setIsOnline(false);
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, []);

  if (isOnline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="online-status-banner"
      className="fixed inset-x-0 top-0 z-[var(--z-toast,90)] flex items-center justify-center gap-2 border-b border-amber-300 bg-amber-100 px-3 py-2 text-sm font-medium text-amber-900 shadow-sm"
    >
      <WifiOff className="h-4 w-4" aria-hidden="true" />
      <span>
        You are offline. Admin actions need a live connection — your changes
        will fail until the network is restored.
      </span>
    </div>
  );
}
