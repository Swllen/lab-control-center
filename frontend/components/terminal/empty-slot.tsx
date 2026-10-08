"use client";

import { SquareTerminal } from "lucide-react";
import { StatusDot } from "@/components/server/status-badge";
import { useMetricsSummary, useTerminalAccounts } from "@/lib/hooks/queries";
import type { PaneAccount } from "@/lib/terminal/workspace-store";
import type { Server } from "@/lib/types";

export function EmptySlot({
  servers,
  onOpen,
}: {
  servers: Server[];
  onOpen: (serverId: number, login?: PaneAccount | null) => void;
}) {
  const { data: summary } = useMetricsSummary();
  const { data: accounts } = useTerminalAccounts();
  const state = new Map((summary ?? []).map((m) => [m.server_id, m.status.state]));
  const shells = servers.filter((s) => s.transport === "ssh");
  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-glass/60 p-6 text-center">
      <div className="mb-3 grid size-11 place-items-center rounded-2xl bg-primary-soft text-primary">
        <SquareTerminal className="size-5" />
      </div>
      <p className="text-[14px] font-semibold">Open a terminal</p>
      <p className="mt-1 text-[12.5px] text-muted">Pick a server for this pane</p>
      <div className="mt-4 flex max-w-sm flex-wrap justify-center gap-2">
        {shells.length === 0 ? (
          <p className="text-[12.5px] text-subtle">No SSH servers configured.</p>
        ) : (
          shells.flatMap((s) => [
            <button
              key={s.id}
              type="button"
              onClick={() => onOpen(s.id)}
              className="tile flex h-9 items-center gap-2 rounded-xl px-3.5 text-[13px] font-medium transition hover:bg-tile-hover"
            >
              <StatusDot state={state.get(s.id)} />
              {s.name}
            </button>,
            ...(accounts ?? [])
              .filter((a) => a.server_id === s.id && !a.primary && a.account)
              .map((a) => (
                <button
                  key={`${s.id}-${a.account}`}
                  type="button"
                  onClick={() => onOpen(s.id, { account: a.account!, username: a.username })}
                  title={`${s.name} as ${a.username ?? a.account} (Host ${a.account})`}
                  className="tile flex h-9 items-center gap-2 rounded-xl px-3.5 text-[13px] font-medium transition hover:bg-tile-hover"
                >
                  <StatusDot state={state.get(s.id)} />
                  {a.account}
                  <span className="rounded-md bg-warning-soft px-1.5 font-mono text-[11px] text-warning">{a.username}</span>
                </button>
              )),
          ])
        )}
      </div>
    </div>
  );
}
