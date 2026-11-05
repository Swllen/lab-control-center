"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api";
import { useMe } from "@/lib/hooks/queries";
import { setUnauthorizedHandler } from "@/lib/metrics-store";
import { UploadPanel } from "@/components/files/upload-panel";
import { Button } from "@/components/ui/button";
import { CommandPalette } from "./command-palette";
import { DockLayout, TOOL_DRAG_TYPE } from "./dock-layout";
import { NAV_ITEMS } from "./nav";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

function isTypingTarget(el: EventTarget | null): boolean {
  return el instanceof HTMLElement && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function AppShell({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [embedded, setEmbedded] = useState<boolean | null>(null);
  const { data: user, error, isLoading, isFetching, refetch } = useMe();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [draggingTool, setDraggingTool] = useState(false);
  const chord = useRef<number>(0);

  useEffect(() => {
    setEmbedded(window.parent !== window && window.name.startsWith("lcc-window:"));
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => router.replace("/login"));
  }, [router]);

  useEffect(() => {
    if (error instanceof ApiError && error.status === 401) {
      router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  }, [error, router]);

  // Keyboard: ⌘K / Ctrl+K palette, "g <key>" chords for navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "g") {
        chord.current = Date.now();
        return;
      }
      if (Date.now() - chord.current < 1200) {
        const item = NAV_ITEMS.find((n) => n.shortcut === e.key);
        chord.current = 0;
        if (item) router.push(item.href);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router]);

  // A non-401 failure (backend down, proxy error) would otherwise leave the spinner up forever.
  if (error && !(error instanceof ApiError && error.status === 401) && !isFetching) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="space-y-3 text-center">
          <p className="text-sm text-muted">Cannot reach the backend: {error.message}</p>
          <Button variant="primary" onClick={() => refetch()}>Retry</Button>
        </div>
      </div>
    );
  }

  if (isLoading || !user || embedded === null) {
    return (
      <div className="grid min-h-screen place-items-center">
        <div className="size-8 animate-spin rounded-full border-2 border-primary/25 border-t-primary" />
      </div>
    );
  }

  if (embedded) {
    return (
      <main className="embedded-shell @container p-3" data-compact={pathname === "/files" || pathname === "/terminals"}>
        {children}
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        <UploadPanel />
      </main>
    );
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[3200px] gap-6 p-5"
      onDragStart={(event) => { if (event.dataTransfer.types.includes(TOOL_DRAG_TYPE)) setDraggingTool(true); }}
      onDragEnd={() => setDraggingTool(false)}>
      <Sidebar />
      <main className="min-w-0 flex-1 pb-6">
        <Topbar onOpenPalette={() => setPaletteOpen(true)} />
        <DockLayout dragging={draggingTool} onDragFinished={() => setDraggingTool(false)}>{children}</DockLayout>
      </main>
      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      <UploadPanel />
    </div>
  );
}
