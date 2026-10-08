"use client";

import { Sparkles, SquareTerminal, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { toast } from "sonner";
import { AssistantPanel, type AssistantMode } from "@/components/terminal/assistant-panel";
import { TabGrid } from "@/components/terminal/tab-grid";
import { LayoutSwitcher, NewTerminalMenu, TabStrip } from "@/components/terminal/workspace-toolbar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { terminalsApi } from "@/lib/api";
import { useServerMap, useServers } from "@/lib/hooks/queries";
import { useWorkspace, workspace, type PaneAccount, type TabState } from "@/lib/terminal/workspace-store";
import { cn } from "@/lib/utils";

// Guards the ?server=&new=1 deep link against StrictMode's double effect run.
let pendingDeepLink = false;

const ASSISTANT_KEY = "lcc.assistant.open";
const ASSISTANT_MODE_KEY = "lcc.assistant.mode";

function TerminalsWorkspace() {
  const router = useRouter();
  const params = useSearchParams();
  const ws = useWorkspace();
  const { data: servers } = useServers();
  const serverMap = useServerMap();
  const [closingTab, setClosingTab] = useState<TabState | null>(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMode, setAssistantMode] = useState<AssistantMode>("docked");
  const activeTab = ws.tabs.find((t) => t.id === ws.activeTabId) ?? ws.tabs[0]!;
  const focusedPane = ws.focusedPaneId ? ws.panes[ws.focusedPaneId] ?? null : null;

  useEffect(() => {
    try {
      setAssistantOpen(window.localStorage.getItem(ASSISTANT_KEY) === "1");
      setAssistantMode(window.localStorage.getItem(ASSISTANT_MODE_KEY) === "floating" ? "floating" : "docked");
    } catch {
      /* storage unavailable */
    }
  }, []);
  const changeAssistantMode = (mode: AssistantMode) => {
    setAssistantMode(mode);
    try {
      window.localStorage.setItem(ASSISTANT_MODE_KEY, mode);
    } catch {
      /* storage unavailable */
    }
  };
  const toggleAssistant = (open: boolean) => {
    setAssistantOpen(open);
    try {
      window.localStorage.setItem(ASSISTANT_KEY, open ? "1" : "0");
    } catch {
      /* storage unavailable */
    }
  };

  // Dashboard "SSH" button / palette: /terminals?server=<id>&new=1
  useEffect(() => {
    const serverId = Number(params.get("server"));
    if (params.get("new") !== "1" || !serverId) {
      pendingDeepLink = false;
      return;
    }
    if (pendingDeepLink) return;
    pendingDeepLink = true;
    workspace.openPane(serverId);
    router.replace("/terminals");
  }, [params, router]);

  const open = (serverId: number, login?: PaneAccount | null) => workspace.openPane(serverId, undefined, undefined, login);

  const changeLayout = (layout: TabState["layout"]) => {
    const moved = workspace.setLayout(activeTab.id, layout);
    if (moved) toast(`Moved ${moved} terminal${moved > 1 ? "s" : ""} to a new tab`);
  };

  const closeTab = (tab: TabState) => {
    if (tab.slots.some(Boolean)) setClosingTab(tab);
    else workspace.closeTab(tab.id);
  };

  const confirmCloseTab = () => {
    if (!closingTab) return;
    for (const pane of workspace.closeTab(closingTab.id)) {
      if (pane.sessionId) void terminalsApi.close(pane.sessionId).catch(() => undefined);
    }
    setClosingTab(null);
  };

  return (
    <div className="flex h-[calc(100vh-150px)] min-h-[520px] flex-col gap-3">
      <div className="glass flex items-center gap-3 rounded-2xl p-1.5 shadow-none">
        <TabStrip
          ws={ws}
          onActivate={workspace.activateTab}
          onAdd={workspace.addTab}
          onClose={closeTab}
          onRename={workspace.renameTab}
        />
        <LayoutSwitcher value={activeTab.layout} onChange={changeLayout} />
        <NewTerminalMenu servers={servers ?? []} onOpen={open} />
        <Button
          size="sm"
          variant={assistantOpen ? "secondary" : "ghost"}
          className={cn("h-9", assistantOpen && "text-primary")}
          onClick={() => toggleAssistant(!assistantOpen)}
          aria-pressed={assistantOpen}
        >
          <Sparkles /> AI 助手
        </Button>
      </div>

      <div className="flex min-h-0 flex-1 gap-3">
        <div className="relative min-h-0 min-w-0 flex-1">
          {ws.tabs.map((tab) => (
            <TabGrid
              key={tab.id}
              tab={tab}
              ws={ws}
              servers={serverMap}
              visible={tab.id === activeTab.id}
              focusedPane={ws.focusedPaneId ?? null}
              onFocusPane={workspace.focusPane}
            />
          ))}
        </div>
        {assistantOpen ? (
          <AssistantPanel
            pane={focusedPane}
            serverName={focusedPane ? serverMap.get(focusedPane.serverId)?.name ?? null : null}
            mode={assistantMode}
            onModeChange={changeAssistantMode}
            onClose={() => toggleAssistant(false)}
          />
        ) : null}
      </div>

      <p className="flex items-center gap-1.5 px-1 text-[12px] text-subtle">
        <SquareTerminal className="size-3.5" />
        Double-click a tab or session name to rename · Ctrl+C copies a selection (otherwise interrupts) · Ctrl+V pastes · sessions survive
        page refreshes for 15 minutes
      </p>

      <Dialog open={!!closingTab} onOpenChange={(o) => !o && setClosingTab(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader
            tone="danger"
            icon={<X />}
            title={`Close “${closingTab?.title}”?`}
            description="All terminals in this tab will be closed and their shell processes ended."
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setClosingTab(null)}>Cancel</Button>
            <Button variant="danger-solid" onClick={confirmCloseTab}>Close tab</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function TerminalsPage() {
  return (
    <Suspense>
      <TerminalsWorkspace />
    </Suspense>
  );
}
