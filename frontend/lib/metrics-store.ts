/**
 * Ref-counted live metrics store: at most one WebSocket per server per browser tab, shared by
 * every component that renders that server. Consumed through `useServerMetrics`
 * (useSyncExternalStore), so frames cause minimal re-renders.
 */
import { wsUrl } from "@/lib/api/client";
import type { MetricsFrame, MetricsSnapshot, ServerStatic, ServerStatus } from "@/lib/types";

export const HISTORY_POINTS = 90;

export interface LiveMetrics {
  /** Is the browser <-> backend socket open (independent of the server's own status). */
  socket: "connecting" | "open" | "closed";
  status: ServerStatus | null;
  static: ServerStatic | null;
  latest: MetricsSnapshot | null;
  history: MetricsSnapshot[];
}

const EMPTY: LiveMetrics = { socket: "connecting", status: null, static: null, latest: null, history: [] };

interface Entry {
  state: LiveMetrics;
  listeners: Set<() => void>;
  ws: WebSocket | null;
  retry: number;
  timer: ReturnType<typeof setTimeout> | null;
  closing: ReturnType<typeof setTimeout> | null;
}

const entries = new Map<number, Entry>();
let onUnauthorized: (() => void) | null = null;

export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

function emit(entry: Entry, patch: Partial<LiveMetrics>): void {
  entry.state = { ...entry.state, ...patch };
  entry.listeners.forEach((l) => l());
}

function reduce(entry: Entry, frame: MetricsFrame): void {
  switch (frame.type) {
    case "hello":
      emit(entry, {
        status: frame.status,
        static: frame.static,
        history: frame.history.slice(-HISTORY_POINTS),
        latest: frame.history.at(-1) ?? null,
      });
      break;
    case "snapshot": {
      const history = [...entry.state.history, frame.snapshot];
      if (history.length > HISTORY_POINTS) history.splice(0, history.length - HISTORY_POINTS);
      emit(entry, { latest: frame.snapshot, history });
      break;
    }
    case "status":
      emit(entry, { status: frame.status });
      break;
    case "static":
      emit(entry, { static: frame.static });
      break;
  }
}

function connect(serverId: number, entry: Entry): void {
  const ws = new WebSocket(wsUrl(`/ws/servers/${serverId}/metrics`));
  entry.ws = ws;
  emit(entry, { socket: "connecting" });

  ws.onopen = () => {
    entry.retry = 0;
    emit(entry, { socket: "open" });
  };
  ws.onmessage = (ev: MessageEvent<string>) => {
    try {
      reduce(entry, JSON.parse(ev.data) as MetricsFrame);
    } catch {
      /* ignore malformed frame */
    }
  };
  ws.onclose = (ev) => {
    if (entry.ws !== ws) return; // superseded
    entry.ws = null;
    emit(entry, { socket: "closed" });
    if (ev.code === 4401) {
      onUnauthorized?.();
      return;
    }
    if (ev.code === 4404 || entry.listeners.size === 0) return;
    const delay = Math.min(1000 * 2 ** entry.retry, 15000);
    entry.retry += 1;
    entry.timer = setTimeout(() => connect(serverId, entry), delay);
  };
}

function teardown(serverId: number, entry: Entry): void {
  if (entry.timer) clearTimeout(entry.timer);
  const ws = entry.ws;
  entry.ws = null;
  ws?.close();
  entries.delete(serverId);
}

export function subscribe(serverId: number, listener: () => void): () => void {
  let entry = entries.get(serverId);
  if (!entry) {
    entry = { state: EMPTY, listeners: new Set(), ws: null, retry: 0, timer: null, closing: null };
    entries.set(serverId, entry);
    connect(serverId, entry);
  }
  if (entry.closing) {
    clearTimeout(entry.closing);
    entry.closing = null;
  }
  entry.listeners.add(listener);
  const e = entry;
  return () => {
    e.listeners.delete(listener);
    if (e.listeners.size === 0) {
      // Grace period: route changes / StrictMode remounts reuse the open socket.
      e.closing = setTimeout(() => teardown(serverId, e), 1500);
    }
  };
}

export function getSnapshot(serverId: number): LiveMetrics {
  return entries.get(serverId)?.state ?? EMPTY;
}

export function getServerSnapshot(): LiveMetrics {
  return EMPTY;
}
