"use client";

import { GripVertical, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useState, type DragEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { NAV_ITEMS, navForPath } from "./nav";

export const TOOL_DRAG_TYPE = "application/x-lcc-tool";
type Pane = { id: string; href: string };
const PRIMARY_ID = "current-page";
const STORAGE_KEY = "lcc.docked-panes.v1";

export function DockLayout({ children, dragging, onDragFinished }: {
  children: ReactNode;
  dragging: boolean;
  onDragFinished: () => void;
}) {
  const pathname = usePathname();
  const [panes, setPanes] = useState<Pane[]>([{ id: PRIMARY_ID, href: "" }]);
  const [hovered, setHovered] = useState<"left" | "right" | null>(null);
  const [ready, setReady] = useState(false);
  const split = panes.length > 1;
  const primary = navForPath(pathname);

  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || "null");
      if (Array.isArray(saved) && saved.length > 0 && saved.length <= 4 &&
        saved.every((pane: Pane) => pane && typeof pane.id === "string" && /^[\w-]+$/.test(pane.id) &&
          (pane.id === PRIMARY_ID ? pane.href === "" : NAV_ITEMS.some((item) => item.href === pane.href))) &&
        saved.filter((pane: Pane) => pane.id === PRIMARY_ID).length === 1 &&
        new Set(saved.map((pane: Pane) => pane.id)).size === saved.length) setPanes(saved);
    } catch { /* Invalid or unavailable storage: keep the current page. */ }
    setReady(true);
  }, []);

  useEffect(() => {
    if (!ready) return;
    // Per-tab persistence keeps frame/session identities across a page refresh.
    try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(panes)); } catch { /* Storage unavailable. */ }
  }, [panes, ready]);

  const startDrag = (event: DragEvent, pane: Pane) => {
    event.dataTransfer.setData(TOOL_DRAG_TYPE, pane.href || pathname);
    event.dataTransfer.setData("application/x-lcc-pane-id", pane.id);
    event.dataTransfer.effectAllowed = "copyMove";
  };

  const drop = (event: DragEvent, side: "left" | "right") => {
    event.preventDefault();
    const href = event.dataTransfer.getData(TOOL_DRAG_TYPE);
    const id = event.dataTransfer.getData("application/x-lcc-pane-id");
    if (NAV_ITEMS.some((item) => item.href === href)) {
      setPanes((current) => {
        const existing = current.find((pane) => pane.id === id);
        if (!existing && current.length >= 4) return current;
        const pane = existing ?? { id: `tool-${Date.now()}-${Math.random().toString(36).slice(2)}`, href };
        const remaining = current.filter((p) => p.id !== pane.id);
        return side === "left" ? [pane, ...remaining] : [...remaining, pane];
      });
    }
    setHovered(null);
    onDragFinished();
  };

  const header = (pane: Pane, label: string, current = false) => (
    <div draggable onDragStart={(event) => startDrag(event, pane)} className={cn("flex h-10 shrink-0 cursor-grab items-center gap-2 border-b border-line px-3 active:cursor-grabbing", current && !split && "hidden")} title="Drag to move this pane">
      <GripVertical className="size-4 text-subtle" />
      <span className="flex-1 text-sm font-medium">{label}</span>
      <Button size="icon-sm" variant="ghost" aria-label={current ? "Close split view" : `Close ${label} pane`} onClick={() => setPanes((items) => current ? items.filter((item) => item.id === PRIMARY_ID) : items.filter((item) => item.id !== pane.id))}><X /></Button>
    </div>
  );

  return (
    <div className="relative" data-testid="dock-layout">
      <div className={cn("flex", split && "gap-3 overflow-x-auto")}>
        {/* This node never moves in the React tree: docking preserves the live page. */}
        <section aria-label={`${primary.label} current pane`} className={cn("min-w-0 flex-1", split && "glass flex min-w-[400px] flex-col overflow-hidden rounded-2xl")} style={{ order: panes.findIndex((pane) => pane.id === PRIMARY_ID) }} data-compact={pathname === "/files" || pathname === "/terminals"} data-primary-pane>
          {header({ id: PRIMARY_ID, href: "" }, primary.label, true)}
          <div className={cn("dock-tool-body @container", split && "h-[max(520px,calc(100dvh-200px))] overflow-auto p-3")} data-split={split}>
            {children}
          </div>
        </section>
        {/* CSS order changes placement; DOM order stays fixed so frames stay connected. */}
        {panes.filter((pane) => pane.id !== PRIMARY_ID).sort((a, b) => a.id.localeCompare(b.id)).map((pane) => {
          const tool = navForPath(pane.href);
          return (
            <section key={pane.id} aria-label={`${tool.label} docked pane`} className="glass flex min-w-[400px] flex-1 flex-col overflow-hidden rounded-2xl" style={{ order: panes.findIndex((item) => item.id === pane.id) }}>
              {header(pane, tool.label)}
              <iframe name={`lcc-window:${pane.id}`} src={pane.href} title={`${tool.label} docked pane`} className="block h-[max(520px,calc(100dvh-200px))] w-full border-0" />
            </section>
          );
        })}
      </div>
      {dragging ? (
        <div className="absolute inset-0 z-40 flex min-h-[350px] gap-3 rounded-2xl bg-bg/30 p-3 backdrop-blur-[2px]" onDragOver={(event) => event.preventDefault()}>
          {(["left", "right"] as const).map((side) => (
            <div key={side} data-testid={`dock-${side}`} onDragEnter={() => setHovered(side)} onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setHovered(side); }} onDrop={(event) => drop(event, side)} className={cn("flex flex-1 items-center justify-center rounded-2xl border-2 border-dashed border-primary/40 bg-primary-soft text-sm font-medium text-primary transition-colors", hovered === side && "border-primary bg-primary/20")}>
              {panes.length >= 4 ? "Drop a pane here to reorder · maximum 4 panes" : `Drop here to open on the ${side}`}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
