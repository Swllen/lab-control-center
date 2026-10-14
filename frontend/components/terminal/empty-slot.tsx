"use client";

import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Plus, SquareTerminal } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { StatusDot } from "@/components/server/status-badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/misc";
import { terminalsApi } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useMetricsSummary, useTerminalAccounts } from "@/lib/hooks/queries";
import { setTmuxPref, useTmuxPref } from "@/lib/terminal/tmux-pref";
import type { PaneAccount, TmuxChoice } from "@/lib/terminal/workspace-store";
import type { Server } from "@/lib/types";
import { focusOpenTerminal, TmuxSwitch } from "./tmux";

interface Pick {
  serverId: number;
  login: PaneAccount | null;
}

export function EmptySlot({
  servers,
  onOpen,
}: {
  servers: Server[];
  onOpen: (serverId: number, login: PaneAccount | null, tmux: TmuxChoice) => void;
}) {
  const { data: summary } = useMetricsSummary();
  const { data: accounts } = useTerminalAccounts();
  const useTmux = useTmuxPref();
  // With tmux on, picking a login first lists its tmux sessions so an existing one can be reattached.
  const [picking, setPicking] = useState<Pick | null>(null);
  const state = new Map((summary ?? []).map((m) => [m.server_id, m.status.state]));
  const shells = servers.filter((s) => s.transport === "ssh");

  const choose = (serverId: number, login: PaneAccount | null = null) => {
    if (useTmux) setPicking({ serverId, login });
    else onOpen(serverId, login, false);
  };

  if (picking) {
    return (
      <TmuxPicker
        pick={picking}
        serverName={servers.find((s) => s.id === picking.serverId)?.name ?? `server ${picking.serverId}`}
        onBack={() => setPicking(null)}
        onOpen={(tmux) => onOpen(picking.serverId, picking.login, tmux)}
      />
    );
  }

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
              onClick={() => choose(s.id)}
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
                  onClick={() => choose(s.id, { account: a.account!, username: a.username })}
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
      {shells.length ? <TmuxSwitch on={useTmux} onChange={setTmuxPref} className="mt-4" /> : null}
    </div>
  );
}

/** Existing tmux sessions for one login: attach to one, or start a new one. Skipped when there are none. */
function TmuxPicker({
  pick,
  serverName,
  onBack,
  onOpen,
}: {
  pick: Pick;
  serverName: string;
  onBack: () => void;
  onOpen: (tmux: TmuxChoice) => void;
}) {
  const account = pick.login?.account ?? null;
  const { data, error } = useQuery({
    queryKey: ["tmux", pick.serverId, account, true],
    queryFn: () => terminalsApi.tmuxSessions(pick.serverId, account, true),
    staleTime: 0,
  });

  // Nothing to reattach (or no tmux at all, where the backend falls back to a shell): open straight away.
  const nothingToAttach = !!data && (!data.available || data.sessions.length === 0);
  const opened = useRef(false); // cached data can make this true on mount, where dev StrictMode runs effects twice
  useEffect(() => {
    if (!nothingToAttach || opened.current) return;
    opened.current = true;
    onOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nothingToAttach]);

  return (
    <div className="flex h-full min-h-0 flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-glass/60 p-6">
      <div className="flex w-full max-w-md min-h-0 flex-col">
        <div className="mb-3 flex items-center gap-2">
          <Button size="icon-sm" variant="ghost" onClick={onBack} aria-label="Back">
            <ArrowLeft />
          </Button>
          <div className="min-w-0">
            <p className="truncate text-[14px] font-semibold">tmux sessions on {serverName}</p>
            <p className="truncate text-[12px] text-muted">
              {pick.login ? `as ${pick.login.username ?? pick.login.account} · ` : ""}attach to one or start a new session
            </p>
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto rounded-2xl bg-track/60 p-1.5">
          {error ? (
            <p className="p-3 text-[13px] text-danger">{error instanceof Error ? error.message : "Could not list tmux sessions"}</p>
          ) : !data || nothingToAttach ? (
            <div className="space-y-1.5 p-1">
              <Skeleton className="h-11 rounded-xl" />
              <Skeleton className="h-11 rounded-xl" />
            </div>
          ) : (
            <ul className="space-y-1">
              {data.sessions.map((t) => (
                <li key={t.name} className="flex items-center gap-3 rounded-xl bg-glass px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-mono text-[13px] font-medium">{t.name}</span>
                      {t.terminal_ids.length ? (
                        <span className="shrink-0 rounded-md bg-primary-soft px-1.5 text-[11px] text-primary">open here</span>
                      ) : null}
                    </div>
                    <div className="truncate text-[11.5px] text-subtle">
                      {t.windows} window{t.windows === 1 ? "" : "s"} · created {formatRelative(new Date(t.created * 1000).toISOString())} ·{" "}
                      {t.attached ? `${t.attached} attached` : "detached"}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant={t.terminal_ids.length ? "ghost" : "primary"}
                    onClick={() => {
                      if (!focusOpenTerminal(t.terminal_ids)) onOpen(t.name);
                    }}
                  >
                    {t.terminal_ids.length ? "Show" : "Attach"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Button className="mt-3 self-center" onClick={() => onOpen(true)}>
          <Plus /> New tmux session
        </Button>
      </div>
    </div>
  );
}
