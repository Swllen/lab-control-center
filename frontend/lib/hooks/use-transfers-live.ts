"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { wsUrl } from "@/lib/api";
import { useTransfers } from "@/lib/hooks/queries";
import type { LiveTransfer, Transfer } from "@/lib/types";

/** Live progress for active transfers (WebSocket), merged over the REST history. */
export function useTransfersLive(limit = 50) {
  const qc = useQueryClient();
  const query = useTransfers(limit);
  const [live, setLive] = useState<Map<number, LiveTransfer>>(new Map());

  useEffect(() => {
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retry = 0;
    let closed = false;
    const connect = () => {
      ws = new WebSocket(wsUrl("/ws/transfers"));
      ws.onopen = () => (retry = 0);
      ws.onmessage = (ev: MessageEvent<string>) => {
        const frame = JSON.parse(ev.data) as { type: "live" | "changed"; live: LiveTransfer[] };
        setLive(new Map(frame.live.map((l) => [l.id, l])));
        if (frame.type === "changed") void qc.invalidateQueries({ queryKey: ["transfers"] });
      };
      ws.onclose = () => {
        if (closed) return;
        retry += 1;
        timer = setTimeout(connect, Math.min(1000 * 2 ** retry, 15000));
      };
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      ws?.close();
    };
  }, [qc]);

  const data = useMemo<Transfer[] | undefined>(
    () =>
      query.data?.map((t) => {
        const l = live.get(t.id);
        return l
          ? { ...t, status: l.status, transferred_bytes: l.transferred_bytes, size_bytes: l.size_bytes, speed_bps: l.speed_bps, eta_s: l.eta_s }
          : t;
      }),
    [query.data, live],
  );

  return { ...query, data };
}
