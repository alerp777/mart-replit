import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

interface QueuedStatusUpdate {
  id: string;
  orderId: string;
  status: string;
  queuedAt: number;
}

const QUEUE_KEY = "ajkmart_vendor_offline_queue";

function loadQueue(): QueuedStatusUpdate[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedStatusUpdate[]) : [];
  } catch {
    return [];
  }
}

function saveQueue(q: QueuedStatusUpdate[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
  } catch {}
}

export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState("");
  const qc = useQueryClient();
  const flushingRef = useRef(false);

  const showSyncToast = (msg: string) => {
    setSyncToast(msg);
    setTimeout(() => setSyncToast(""), 3000);
  };

  const flushQueue = useCallback(async () => {
    if (flushingRef.current) return;
    const queue = loadQueue();
    if (queue.length === 0) return;
    flushingRef.current = true;
    setIsSyncing(true);
    showSyncToast("Syncing...");
    const failed: QueuedStatusUpdate[] = [];
    for (const item of queue) {
      try {
        await api.updateOrder(item.orderId, item.status);
      } catch {
        failed.push(item);
      }
    }
    saveQueue(failed);
    await qc.invalidateQueries({ queryKey: ["vendor-orders"] });
    await qc.invalidateQueries({ queryKey: ["vendor-stats"] });
    setIsSyncing(false);
    flushingRef.current = false;
    if (failed.length === 0) {
      showSyncToast(`✅ Synced ${queue.length} pending update${queue.length > 1 ? "s" : ""}`);
    } else {
      showSyncToast(`⚠️ ${failed.length} update${failed.length > 1 ? "s" : ""} failed to sync`);
    }
  }, [qc]);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      flushQueue();
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flushQueue]);

  const enqueueStatusUpdate = useCallback((orderId: string, status: string): boolean => {
    if (isOnline) return false;
    const queue = loadQueue();
    const existing = queue.findIndex(q => q.orderId === orderId);
    const item: QueuedStatusUpdate = { id: `${orderId}_${Date.now()}`, orderId, status, queuedAt: Date.now() };
    if (existing >= 0) {
      queue[existing] = item;
    } else {
      queue.push(item);
    }
    saveQueue(queue);
    return true;
  }, [isOnline]);

  return { isOnline, isSyncing, syncToast, enqueueStatusUpdate, flushQueue };
}
