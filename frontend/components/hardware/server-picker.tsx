"use client";

import { StatusDot } from "@/components/server/status-badge";
import { useMetricsSummary } from "@/lib/hooks/queries";
import type { Server } from "@/lib/types";
import { cn } from "@/lib/utils";

export function ServerPicker({
  servers,
  value,
  onChange,
}: {
  servers: Server[];
  value: number | null;
  onChange: (id: number) => void;
}) {
  const { data: summary } = useMetricsSummary();
  const state = new Map((summary ?? []).map((m) => [m.server_id, m.status.state]));
  return (
    <div role="tablist" aria-label="Server" className="glass inline-flex flex-wrap gap-1 self-start rounded-2xl p-1 shadow-none">
      {servers.map((s) => (
        <button
          key={s.id}
          role="tab"
          aria-selected={value === s.id}
          onClick={() => onChange(s.id)}
          className={cn(
            "flex h-9 items-center gap-2 rounded-xl px-3.5 text-[13.5px] font-medium transition",
            value === s.id ? "bg-glass-strong text-fg shadow-tile" : "text-muted hover:text-fg",
          )}
        >
          <StatusDot state={state.get(s.id)} />
          {s.name}
        </button>
      ))}
    </div>
  );
}
