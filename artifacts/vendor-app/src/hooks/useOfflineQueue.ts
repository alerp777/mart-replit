import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";

interface QueuedStatusUpdate {
  id: string;
  orderId: string;
  status: string;
  queuedAt: number;
}

interface QueuedProductAction {
  id: string;
  action: "create" | "update";
  productId?: string;
  payload: Record<string, unknown>;
  queuedAt: number;
  retries: number;
}

export interface ProductQueueError {
  id: string;
  action: "create" | "update";
  productId?: string;
  message: string;
}

const QUEUE_KEY = "ajkmart_vendor_offline_queue";
const PRODUCT_QUEUE_KEY = "ajkmart_vendor_product_queue";
const PRODUCT_FAILURES_KEY = "ajkmart_vendor_product_failures";
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 800;

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

function loadProductQueue(): QueuedProductAction[] {
  try {
    const raw = localStorage.getItem(PRODUCT_QUEUE_KEY);
    return raw ? (JSON.parse(raw) as QueuedProductAction[]) : [];
  } catch {
    return [];
  }
}

function saveProductQueue(q: QueuedProductAction[]): void {
  try {
    localStorage.setItem(PRODUCT_QUEUE_KEY, JSON.stringify(q));
  } catch {}
}

function loadProductFailures(): ProductQueueError[] {
  try {
    const raw = localStorage.getItem(PRODUCT_FAILURES_KEY);
    return raw ? (JSON.parse(raw) as ProductQueueError[]) : [];
  } catch {
    return [];
  }
}

function saveProductFailures(f: ProductQueueError[]): void {
  try {
    localStorage.setItem(PRODUCT_FAILURES_KEY, JSON.stringify(f));
  } catch {}
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState(() => navigator.onLine);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncToast, setSyncToast] = useState("");
  const [pendingProductCount, setPendingProductCount] = useState<number>(() => loadProductQueue().length);
  const [productQueueErrors, setProductQueueErrors] = useState<ProductQueueError[]>(() => loadProductFailures());
  const qc = useQueryClient();
  const flushingRef = useRef(false);
  const flushingProductsRef = useRef(false);

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

  const flushProductQueue = useCallback(async () => {
    if (flushingProductsRef.current) return;
    const queue = loadProductQueue();
    if (queue.length === 0) return;
    flushingProductsRef.current = true;

    const stillPending: QueuedProductAction[] = [];
    const newFailures: ProductQueueError[] = [];

    for (const item of queue) {
      let success = false;
      let lastError = "";
      let attempts = item.retries;

      while (attempts < MAX_RETRIES) {
        try {
          if (item.action === "create") {
            await api.createProduct(item.payload as Parameters<typeof api.createProduct>[0]);
          } else if (item.action === "update" && item.productId) {
            await api.updateProduct(item.productId, item.payload as Parameters<typeof api.updateProduct>[1]);
          }
          success = true;
          break;
        } catch (e) {
          lastError = e instanceof Error ? e.message : "Unknown error";
          attempts++;
          if (attempts < MAX_RETRIES) await sleep(RETRY_DELAY_MS);
        }
      }

      if (!success) {
        newFailures.push({
          id: item.id,
          action: item.action,
          productId: item.productId,
          message: lastError || "Failed after maximum retries",
        });
      }
    }

    saveProductQueue(stillPending);
    setPendingProductCount(0);

    const existingFailures = loadProductFailures();
    const existingIds = new Set(existingFailures.map(f => f.id));
    const mergedFailures = [
      ...existingFailures,
      ...newFailures.filter(f => !existingIds.has(f.id)),
    ];
    saveProductFailures(mergedFailures);
    setProductQueueErrors(mergedFailures);

    flushingProductsRef.current = false;

    if (newFailures.length === 0 && queue.length > 0) {
      await qc.invalidateQueries({ queryKey: ["vendor-products"] });
      await qc.invalidateQueries({ queryKey: ["vendor-products-all"] });
    }
  }, [qc]);

  useEffect(() => {
    const onOnline = () => {
      setIsOnline(true);
      flushQueue();
      flushProductQueue();
    };
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [flushQueue, flushProductQueue]);

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

  const enqueueProductAction = useCallback((
    action: "create" | "update",
    payload: Record<string, unknown>,
    productId?: string,
  ): boolean => {
    if (isOnline) return false;
    const queue = loadProductQueue();
    const item: QueuedProductAction = {
      id: `product_${action}_${Date.now()}`,
      action,
      productId,
      payload,
      queuedAt: Date.now(),
      retries: 0,
    };
    queue.push(item);
    saveProductQueue(queue);
    setPendingProductCount(queue.length);
    return true;
  }, [isOnline]);

  return {
    isOnline,
    isSyncing,
    syncToast,
    enqueueStatusUpdate,
    flushQueue,
    pendingProductCount,
    productQueueErrors,
    enqueueProductAction,
    flushProductQueue,
  };
}
