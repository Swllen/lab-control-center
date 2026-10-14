"use client";

import type { CSSProperties } from "react";
import type { TabState, Workspace } from "@/lib/terminal/workspace-store";
import { workspace } from "@/lib/terminal/workspace-store";
import type { Server } from "@/lib/types";
import { cn } from "@/lib/utils";
import { EmptySlot } from "./empty-slot";
import { TerminalPane } from "./terminal-pane";

const GRID: Record<TabState["layout"], string> = {
  "1x1": "grid-cols-1 grid-rows-1",
  "1x2": "grid-cols-1 grid-rows-2 lg:grid-cols-2 lg:grid-rows-1",
  "2x2": "grid-cols-2 grid-rows-2",
};

const FULL: CSSProperties = { gridArea: "1 / 1 / -1 / -1" };

/**
 * One tab's split layout. Panes stay mounted in a stable order (keyed by pane id) so
 * maximizing or switching tabs never tears down a live xterm instance.
 */
export function TabGrid({
  tab,
  ws,
  servers,
  visible,
  focusedPane,
  onFocusPane,
}: {
  tab: TabState;
  ws: Workspace;
  servers: Map<number, Server>;
  visible: boolean;
  focusedPane: string | null;
  onFocusPane: (id: string) => void;
}) {
  const serverList = [...servers.values()];
  return (
    <div className={cn("absolute inset-0 grid gap-3", GRID[tab.layout], !visible && "invisible pointer-events-none")} aria-hidden={!visible}>
      {tab.slots.map((paneId, slot) => {
        const pane = paneId ? ws.panes[paneId] : undefined;
        const isMax = !!pane && tab.maximized === pane.id;
        const hiddenByMax = !!tab.maximized && !isMax;
        return (
          <div key={pane?.id ?? `empty-${slot}`} className={cn("min-h-0 min-w-0", hiddenByMax && "hidden")} style={isMax ? FULL : undefined}>
            {pane ? (
              <TerminalPane
                pane={pane}
                serverName={servers.get(pane.serverId)?.name ?? `server ${pane.serverId}`}
                tabId={tab.id}
                maximized={isMax}
                focused={focusedPane === pane.id}
                onFocus={() => onFocusPane(pane.id)}
              />
            ) : (
              <EmptySlot servers={serverList} onOpen={(serverId, login, tmux) => workspace.openInSlot(tab.id, slot, serverId, login, tmux)} />
            )}
          </div>
        );
      })}
    </div>
  );
}
