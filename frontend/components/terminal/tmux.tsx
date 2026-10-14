"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Layers, RotateCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { StatusDot } from "@/components/server/status-badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/misc";
import { terminalsApi } from "@/lib/api";
import { formatRelative } from "@/lib/format";
import { useMetricsSummary, useTerminalAccounts } from "@/lib/hooks/queries";
import { getWorkspace, workspace, type PaneAccount, type PaneState } from "@/lib/terminal/workspace-store";
import type { Server } from "@/lib/types";
import { cn } from "@/lib/utils";

/** Close a pane's backend terminal. tmux panes only detach unless `killTmux` is set. */
export async function closePaneSession(pane: PaneState, killTmux: boolean): Promise<void> {
  if (pane.sessionId) return terminalsApi.close(pane.sessionId, killTmux && !!pane.tmux);
  // No live terminal (exited or detached with prefix-d), but its tmux session may still be running.
  if (killTmux && pane.tmuxSession) return terminalsApi.killTmux(pane.serverId, pane.account ?? null, pane.tmuxSession);
}

/**
 * If one of these backend terminals is already open in a pane, show that pane (rather than
 * mirroring the same tmux session in a second one) and return true.
 */
export function focusOpenTerminal(terminalIds: string[]): boolean {
  const w = getWorkspace();
  const pane = Object.values(w.panes).find((p) => p.sessionId && terminalIds.includes(p.sessionId));
  const tab = pane && w.tabs.find((t) => t.slots.includes(pane.id));
  if (!pane || !tab) return false;
  workspace.activateTab(tab.id);
  workspace.focusPane(pane.id);
  return true;
}

/** Whether closing this pane should ask to keep or kill its tmux session. */
export const hasTmux = (pane: PaneState) => !!pane.tmux && !!(pane.sessionId || pane.tmuxSession);

export function TmuxSwitchVisual({ on }: { on: boolean }) {
  return (
    <span className={cn("relative inline-block h-4 w-7 shrink-0 rounded-full transition", on ? "bg-primary" : "bg-track ring-1 ring-line")}>
      <span className={cn("absolute top-0.5 size-3 rounded-full bg-white shadow transition-all", on ? "left-3.5" : "left-0.5")} />
    </span>
  );
}

export function TmuxSwitch({ on, onChange, className }: { on: boolean; onChange: (on: boolean) => void; className?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      title="Run new terminals inside tmux so they keep running on the server after you close them"
      className={cn("flex items-center gap-2 text-[12.5px] text-muted transition hover:text-fg", className)}
    >
      <TmuxSwitchVisual on={on} />
      Use tmux
    </button>
  );
}

interface Login {
  serverId: number;
  account: string | null;
  username: string | null;
}

/** Lists tmux sessions on a server (per login) and reattaches a new pane to one. */
export function TmuxSessionsDialog({
  open,
  onOpenChange,
  servers,
  defaultServerId,
  onAttach,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  servers: Server[];
  defaultServerId?: number | null;
  onAttach: (serverId: number, login: PaneAccount | null, tmuxSession: string) => void;
}) {
  const qc = useQueryClient();
  const { data: summary } = useMetricsSummary();
  const { data: accounts } = useTerminalAccounts();
  const state = new Map((summary ?? []).map((m) => [m.server_id, m.status.state]));
  const shells = servers.filter((s) => s.transport === "ssh");
  const logins: Login[] = shells.flatMap((s) => [
    { serverId: s.id, account: null, username: s.username },
    ...(accounts ?? [])
      .filter((a) => a.server_id === s.id && !a.primary && a.account)
      .map((a) => ({ serverId: s.id, account: a.account, username: a.username })),
  ]);
  const [target, setTarget] = useState<Login | null>(null);
  const [all, setAll] = useState(false);
  const [confirmKill, setConfirmKill] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setConfirmKill(null);
    setTarget((t) => {
      if (t && shells.some((s) => s.id === t.serverId)) return t;
      const id = shells.some((s) => s.id === defaultServerId) ? defaultServerId : shells[0]?.id;
      return id != null ? { serverId: id, account: null, username: null } : null;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultServerId, shells.length]);

  const queryKey = ["tmux", target?.serverId, target?.account, all] as const;
  const { data, error, isFetching, refetch } = useQuery({
    queryKey,
    queryFn: () => terminalsApi.tmuxSessions(target!.serverId, target!.account, all),
    enabled: open && !!target,
    staleTime: 0,
  });

  const serverName = (id: number) => servers.find((s) => s.id === id)?.name ?? `server ${id}`;

  const kill = async (name: string) => {
    if (!target) return;
    if (confirmKill !== name) return setConfirmKill(name);
    setConfirmKill(null);
    try {
      await terminalsApi.killTmux(target.serverId, target.account, name);
      toast.success(`Killed tmux session ${name}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not kill the tmux session");
    }
    void qc.invalidateQueries({ queryKey: ["tmux", target.serverId] });
  };

  const attach = (name: string, terminalIds: string[]) => {
    if (!target) return;
    if (!focusOpenTerminal(terminalIds)) {
      onAttach(target.serverId, target.account ? { account: target.account, username: target.username } : null, name);
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader
          icon={<Layers />}
          title="Reattach a tmux session"
          description="tmux sessions keep running on the server after a terminal is closed or the control center restarts."
        />
        {logins.length === 0 ? (
          <p className="text-[13px] text-muted">No SSH servers configured.</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-1.5">
              {logins.map((l) => {
                const active = target?.serverId === l.serverId && (target?.account ?? null) === l.account;
                return (
                  <button
                    key={`${l.serverId}-${l.account ?? ""}`}
                    type="button"
                    onClick={() => {
                      setTarget(l);
                      setConfirmKill(null);
                    }}
                    aria-pressed={active}
                    className={cn(
                      "flex h-8 items-center gap-2 rounded-xl px-3 text-[12.5px] font-medium transition",
                      active ? "bg-primary-soft text-primary ring-1 ring-primary/40" : "tile hover:bg-tile-hover",
                    )}
                  >
                    <StatusDot state={state.get(l.serverId)} />
                    {serverName(l.serverId)}
                    {l.account ? <span className="rounded-md bg-warning-soft px-1.5 font-mono text-[11px] text-warning">{l.username ?? l.account}</span> : null}
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
                <input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} className="accent-[rgb(47_107_255)]" />
                Include sessions not started here
              </label>
              <Button size="sm" variant="ghost" onClick={() => void refetch()} disabled={!target || isFetching}>
                <RotateCw className={cn(isFetching && "animate-spin")} /> Refresh
              </Button>
            </div>

            <div className="mt-2 min-h-24 rounded-2xl bg-track/60 p-1.5">
              {!target ? null : error ? (
                <p className="p-3 text-[13px] text-danger">{error instanceof Error ? error.message : "Could not list tmux sessions"}</p>
              ) : !data ? (
                <div className="space-y-1.5 p-1">
                  <Skeleton className="h-11 rounded-xl" />
                  <Skeleton className="h-11 rounded-xl" />
                </div>
              ) : !data.available ? (
                <p className="p-3 text-[13px] text-muted">tmux is not installed for this login. Terminals opened with “Use tmux” fall back to a plain shell.</p>
              ) : data.sessions.length === 0 ? (
                <p className="p-3 text-[13px] text-muted">
                  No {all ? "" : "control-center "}tmux sessions on {serverName(target.serverId)}.
                </p>
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
                        <div className="text-[11.5px] text-subtle">
                          {t.windows} window{t.windows === 1 ? "" : "s"} · created {formatRelative(new Date(t.created * 1000).toISOString())} ·{" "}
                          {t.attached ? `${t.attached} client${t.attached === 1 ? "" : "s"} attached` : "detached"}
                        </div>
                      </div>
                      <Button size="sm" variant={confirmKill === t.name ? "danger-solid" : "ghost"} onClick={() => void kill(t.name)}>
                        <Trash2 /> {confirmKill === t.name ? "Confirm kill" : "Kill"}
                      </Button>
                      <Button size="sm" variant="primary" onClick={() => attach(t.name, t.terminal_ids)}>
                        {t.terminal_ids.length ? "Show" : "Attach"}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
