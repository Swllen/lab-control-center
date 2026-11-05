"use client";

import { Columns2, Grid2X2, Maximize2, Minimize2, Plus, Rows2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { NAV_ITEMS } from "@/components/layout/nav";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "lcc.tool-windows.v1";
const TOOLS = NAV_ITEMS.filter((item) => item.href !== "/workspace");
const MAX_WINDOWS = 4;
type Arrangement = "columns" | "rows" | "grid";
type ToolWindow = { id: string; href: string };

function newWindow(href: string): ToolWindow {
  return { id: `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`, href };
}

export default function WorkspacePage() {
  const [windows, setWindows] = useState<ToolWindow[]>([]);
  const [arrangement, setArrangement] = useState<Arrangement>("columns");
  const [maximized, setMaximized] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [nextTool, setNextTool] = useState("/files");

  useEffect(() => {
    let restored = false;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && Array.isArray(saved.windows) && saved.windows.length <= MAX_WINDOWS &&
        saved.windows.every((w: ToolWindow) => w && typeof w.id === "string" && /^[\w-]+$/.test(w.id) && TOOLS.some((t) => t.href === w.href)) &&
        new Set(saved.windows.map((w: ToolWindow) => w.id)).size === saved.windows.length) {
        setWindows(saved.windows);
        if (["columns", "rows", "grid"].includes(saved.arrangement)) setArrangement(saved.arrangement);
        restored = true;
      }
    } catch { /* Storage unavailable or invalid: use the default pair. */ }
    if (!restored) setWindows([newWindow("/files"), newWindow("/terminals")]);
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ windows, arrangement }));
    } catch { /* Keep working with in-memory state when storage is unavailable. */ }
  }, [windows, arrangement, ready]);

  const addWindow = () => {
    if (windows.length >= MAX_WINDOWS) return;
    setWindows((current) => [...current, newWindow(nextTool)]);
    setMaximized(null);
  };

  return (
    <div className="flex min-h-[600px] flex-col gap-3">
      <div className="glass flex flex-wrap items-center gap-2 rounded-2xl p-2">
        <select aria-label="Tool to open" value={nextTool} onChange={(e) => setNextTool(e.target.value)} className="h-9 rounded-xl border border-line bg-tile px-3 text-sm text-fg">
          {TOOLS.map((tool) => <option key={tool.href} value={tool.href}>{tool.label}</option>)}
        </select>
        <Button size="sm" onClick={addWindow} disabled={!ready || windows.length >= MAX_WINDOWS}><Plus /> Add window</Button>
        <div className="ml-auto flex items-center gap-1" role="group" aria-label="Window arrangement">
          {([
            ["columns", Columns2, "Side by side"],
            ["rows", Rows2, "Stacked"],
            ["grid", Grid2X2, "Grid"],
          ] as const).map(([value, Icon, label]) => (
            <Button key={value} size="icon-sm" variant={arrangement === value ? "secondary" : "ghost"} title={label} aria-label={label} aria-pressed={arrangement === value} onClick={() => { setArrangement(value); setMaximized(null); }}><Icon /></Button>
          ))}
        </div>
        <span className="px-2 text-xs text-muted">{windows.length} / {MAX_WINDOWS} windows</span>
      </div>

      {ready && windows.length === 0 ? (
        <div className="glass grid min-h-96 place-items-center rounded-2xl p-6 text-sm text-muted">Choose a tool and click Add window to get started.</div>
      ) : null}

      <div
        className={cn("grid gap-3", !maximized && arrangement === "columns" && "overflow-x-auto")}
        style={{
          gridTemplateColumns: maximized || arrangement === "rows" ? "minmax(0, 1fr)" : arrangement === "grid" ? "repeat(auto-fit, minmax(min(100%, 480px), 1fr))" : `repeat(${Math.max(windows.length, 1)}, minmax(420px, 1fr))`,
        }}
      >
        {windows.map((toolWindow, index) => {
          const tool = TOOLS.find((item) => item.href === toolWindow.href)!;
          const Icon = tool.icon;
          return (
            <section key={toolWindow.id} aria-label={`${tool.label} window ${index + 1}`} className={cn("glass min-w-0 overflow-hidden rounded-2xl", maximized && maximized !== toolWindow.id && "hidden")}>
              <div className="flex h-11 items-center gap-2 border-b border-line px-3">
                <Icon className="size-4 text-primary" />
                <h2 className="flex-1 text-sm font-medium">{tool.label}</h2>
                <Button size="icon-sm" variant="ghost" aria-label={maximized === toolWindow.id ? `Restore ${tool.label} window` : `Maximize ${tool.label} window`} onClick={() => setMaximized((current) => current === toolWindow.id ? null : toolWindow.id)}>
                  {maximized === toolWindow.id ? <Minimize2 /> : <Maximize2 />}
                </Button>
                <Button size="icon-sm" variant="ghost" aria-label={`Close ${tool.label} window`} onClick={() => { setWindows((current) => current.filter((w) => w.id !== toolWindow.id)); if (maximized === toolWindow.id) setMaximized(null); }}><X /></Button>
              </div>
              {/* Stable frame names also isolate terminal persistence across duplicate tools. */}
              <iframe name={`lcc-window:${toolWindow.id}`} src={toolWindow.href} title={`${tool.label} window ${index + 1}`} className="block h-[max(520px,calc(100dvh-250px))] w-full border-0" />
            </section>
          );
        })}
      </div>
      <p className="px-1 text-xs text-muted">Each window works independently. Layout changes and maximizing keep other windows running. Your window arrangement is saved automatically.</p>
    </div>
  );
}
