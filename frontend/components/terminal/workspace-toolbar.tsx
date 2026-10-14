"use client";

import { Layers, Plus, SquareTerminal, X } from "lucide-react";
import { useState } from "react";
import { StatusDot } from "@/components/server/status-badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMetricsSummary, useTerminalAccounts } from "@/lib/hooks/queries";
import { setTmuxPref, useTmuxPref } from "@/lib/terminal/tmux-pref";
import { TmuxSwitchVisual } from "./tmux";
import type { PaneAccount } from "@/lib/terminal/workspace-store";
import type { Layout, TabState, Workspace } from "@/lib/terminal/workspace-store";
import type { Server } from "@/lib/types";
import { cn } from "@/lib/utils";

function LayoutGlyph({ layout }: { layout: Layout }) {
  const cells = layout === "1x1" ? 1 : layout === "1x2" ? 2 : 4;
  return (
    <span className={cn("grid size-4 gap-[2px]", layout === "1x1" ? "grid-cols-1" : "grid-cols-2", layout === "2x2" && "grid-rows-2")}>
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} className="rounded-[2px] border-[1.5px] border-current" />
      ))}
    </span>
  );
}

export function LayoutSwitcher({ value, onChange }: { value: Layout; onChange: (l: Layout) => void }) {
  return (
    <div role="radiogroup" aria-label="Layout" className="flex rounded-xl bg-track p-0.5">
      {(["1x1", "1x2", "2x2"] as const).map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={value === l}
          title={`${l.replace("x", "×")} layout`}
          onClick={() => onChange(l)}
          className={cn(
            "grid h-8 w-9 place-items-center rounded-[10px] transition",
            value === l ? "bg-glass-strong text-primary shadow-tile" : "text-muted hover:text-fg",
          )}
        >
          <LayoutGlyph layout={l} />
        </button>
      ))}
    </div>
  );
}

export function NewTerminalMenu({
  servers,
  onOpen,
  onReattach,
}: {
  servers: Server[];
  onOpen: (serverId: number, login?: PaneAccount | null) => void;
  onReattach: () => void;
}) {
  const { data: summary } = useMetricsSummary();
  const { data: accounts } = useTerminalAccounts();
  const useTmux = useTmuxPref();
  const state = new Map((summary ?? []).map((m) => [m.server_id, m.status.state]));
  const shells = servers.filter((s) => s.transport === "ssh");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="primary" size="sm" className="h-9 px-3.5">
          <SquareTerminal /> New terminal
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="min-w-[220px]">
        <DropdownMenuLabel>Open a shell on</DropdownMenuLabel>
        {shells.length === 0 ? (
          <div className="px-2.5 py-2 text-[12.5px] text-muted">No SSH servers configured</div>
        ) : (
          shells.flatMap((s) => [
            <DropdownMenuItem key={s.id} onSelect={() => onOpen(s.id)}>
              <StatusDot state={state.get(s.id)} />
              <span className="flex-1">{s.name}</span>
              <span className="font-mono text-[11.5px] text-subtle">{s.username}</span>
            </DropdownMenuItem>,
            ...(accounts ?? [])
              .filter((a) => a.server_id === s.id && !a.primary && a.account)
              .map((a) => (
                <DropdownMenuItem key={`${s.id}-${a.account}`} onSelect={() => onOpen(s.id, { account: a.account!, username: a.username })}>
                  <span className="w-2.5" />
                  <span className="flex-1 text-muted">{s.name} <span className="text-subtle">as</span> {a.account}</span>
                  <span className="rounded-md bg-warning-soft px-1.5 font-mono text-[11px] text-warning">{a.username}</span>
                </DropdownMenuItem>
              )),
          ])
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onSelect={(e) => {
            e.preventDefault(); // keep the menu open while toggling
            setTmuxPref(!useTmux);
          }}
          role="menuitemcheckbox"
          aria-checked={useTmux}
          title="New terminals run inside tmux and keep running on the server after you close them"
        >
          <TmuxSwitchVisual on={useTmux} />
          <span className="flex-1">Use tmux</span>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onReattach}>
          <Layers />
          <span className="flex-1">Reattach tmux session…</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function TabStrip({
  ws,
  onActivate,
  onAdd,
  onClose,
  onRename,
}: {
  ws: Workspace;
  onActivate: (id: string) => void;
  onAdd: () => void;
  onClose: (tab: TabState) => void;
  onRename: (id: string, title: string) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" role="tablist">
      {ws.tabs.map((tab) => {
        const active = tab.id === ws.activeTabId;
        const count = tab.slots.filter(Boolean).length;
        return (
          <div
            key={tab.id}
            role="tab"
            aria-selected={active}
            onClick={() => onActivate(tab.id)}
            onDoubleClick={() => setEditing(tab.id)}
            className={cn(
              "group flex h-9 shrink-0 cursor-default items-center gap-2 rounded-xl pl-3.5 pr-1.5 text-[13px] font-medium transition",
              active ? "bg-glass-strong text-fg shadow-tile" : "text-muted hover:bg-tile hover:text-fg",
            )}
          >
            {editing === tab.id ? (
              <input
                autoFocus
                defaultValue={tab.title}
                onClick={(e) => e.stopPropagation()}
                onBlur={(e) => {
                  if (e.target.value.trim()) onRename(tab.id, e.target.value.trim());
                  setEditing(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  if (e.key === "Escape") setEditing(null);
                }}
                className="h-6 w-28 rounded-md bg-track px-1.5 outline-none ring-1 ring-primary/50"
              />
            ) : (
              <span className="max-w-40 truncate">{tab.title}</span>
            )}
            {count ? <span className="tabular rounded-md bg-track px-1.5 text-[11px] text-muted">{count}</span> : null}
            <button
              type="button"
              aria-label={`Close ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onClose(tab);
              }}
              className="grid size-6 place-items-center rounded-md text-subtle opacity-0 transition hover:bg-track hover:text-fg group-hover:opacity-100 aria-selected:opacity-100"
            >
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onAdd}
        aria-label="New tab"
        title="New tab"
        className="grid size-9 shrink-0 place-items-center rounded-xl text-muted transition hover:bg-tile hover:text-fg"
      >
        <Plus className="size-4" />
      </button>
    </div>
  );
}
