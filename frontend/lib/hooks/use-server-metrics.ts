"use client";

import { useCallback, useSyncExternalStore } from "react";
import { getServerSnapshot, getSnapshot, subscribe, type LiveMetrics } from "@/lib/metrics-store";

export function useServerMetrics(serverId: number): LiveMetrics {
  const sub = useCallback((listener: () => void) => subscribe(serverId, listener), [serverId]);
  const get = useCallback(() => getSnapshot(serverId), [serverId]);
  return useSyncExternalStore(sub, get, getServerSnapshot);
}
